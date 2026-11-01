import { config } from '../config/env.js';
import { CHECK_SOURCE } from '../config/monitoring.js';
import { Monitor } from '../models/Monitor.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { claimDueMonitor, claimMonitorById, recordCheckOutcome } from './checkService.js';
import { performHttpCheck } from './httpCheck.js';

/**
 * Runs checks within a concurrency limit. Scheduled and manual checks both go through
 * this one class and one code path, so they get identical SSRF protections and limits.
 * The limit applies per worker process.
 */
export class CheckRunner {
  constructor({
    maxConcurrent = config.checkMaxConcurrency,
    httpCheck = performHttpCheck,
    timeoutMs = config.checkTimeoutMs,
    maxBytes = config.checkMaxResponseBytes,
  } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.httpCheck = httpCheck;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.activeSlots = 0;
    this.inFlight = new Set();
  }

  async execute(monitor, source) {
    const checkedAt = new Date();
    const outcome = await this.httpCheck(monitor.url, {
      timeoutMs: this.timeoutMs,
      maxBytes: this.maxBytes,
    });
    return recordCheckOutcome(monitor, outcome, { checkedAt, source });
  }

  // Claims and starts due monitors until none are left or all slots are in use.
  // Monitors that do not fit stay due and are claimed by a later tick or another worker.
  async runDueChecks() {
    while (this.activeSlots < this.maxConcurrent) {
      // Reserve the slot before awaiting so a concurrent manual check cannot take it too.
      this.activeSlots += 1;

      let monitor;
      try {
        monitor = await claimDueMonitor();
      } catch (error) {
        this.activeSlots -= 1;
        throw error;
      }
      if (!monitor) {
        this.activeSlots -= 1;
        return;
      }

      // Not awaited: checks run in parallel while this loop claims the next monitor.
      const running = this.execute(monitor, CHECK_SOURCE.SCHEDULED)
        .catch((error) => {
          // The lease will expire and the monitor will be retried.
          logger.error('Scheduled check failed to save', { monitorId: monitor.id, error: error.message });
        })
        .finally(() => {
          this.activeSlots -= 1;
          this.inFlight.delete(running);
        });
      this.inFlight.add(running);
    }
  }

  async runManualCheck(monitorId) {
    if (this.activeSlots >= this.maxConcurrent) {
      throw new AppError(503, 'CHECK_CAPACITY_REACHED', 'The check queue is full. Try again shortly.');
    }
    this.activeSlots += 1;

    const running = (async () => {
      const monitor = await claimMonitorById(monitorId);
      if (!monitor) await this.throwWhyNotClaimable(monitorId);

      const result = await this.execute(monitor, CHECK_SOURCE.MANUAL);
      if (!result.applied) {
        throw new AppError(409, 'CHECK_DISCARDED', 'The monitor changed during the check, so the result was discarded.');
      }
      return result;
    })().finally(() => {
      this.activeSlots -= 1;
      this.inFlight.delete(tracked);
    });

    const tracked = running.catch(() => {});
    this.inFlight.add(tracked);
    return running;
  }

  async throwWhyNotClaimable(monitorId) {
    const monitor = await Monitor.findById(monitorId);
    if (!monitor) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found.');
    if (monitor.paused) throw new AppError(409, 'MONITOR_PAUSED', 'Resume this monitor before checking it.');
    throw new AppError(409, 'CHECK_IN_PROGRESS', 'A check for this monitor is already running.');
  }

  // Waits for running checks so a shutdown does not cut them off mid-save.
  async drain() {
    await Promise.allSettled([...this.inFlight]);
  }
}

// The one runner shared by the scheduler and the manual-check endpoint.
export const checkRunner = new CheckRunner();
