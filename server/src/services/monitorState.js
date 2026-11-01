import {
  FAILURES_BEFORE_DOWN,
  MONITOR_STATUS,
  STATE_TRANSITION,
  SUCCESSES_BEFORE_UP,
} from '../config/monitoring.js';

/**
 * The monitoring rules as a pure function: same input, same output, no database.
 * That makes every DOWN/UP edge case easy to test.
 */
export function nextMonitorState(current, { success, checkedAt }) {
  const next = {
    status: current.status,
    consecutiveFailures: success ? 0 : current.consecutiveFailures + 1,
    consecutiveSuccesses: success ? current.consecutiveSuccesses + 1 : 0,
    failureStreakStartedAt: null,
    successStreakStartedAt: null,
  };

  if (success) {
    next.successStreakStartedAt =
      current.consecutiveSuccesses === 0 ? checkedAt : current.successStreakStartedAt;
    if (next.consecutiveSuccesses >= SUCCESSES_BEFORE_UP) next.status = MONITOR_STATUS.UP;
  } else {
    next.failureStreakStartedAt =
      current.consecutiveFailures === 0 ? checkedAt : current.failureStreakStartedAt;
    if (next.consecutiveFailures >= FAILURES_BEFORE_DOWN) next.status = MONITOR_STATUS.DOWN;
  }

  let transition = null;
  if (next.status === MONITOR_STATUS.DOWN && current.status !== MONITOR_STATUS.DOWN) {
    transition = STATE_TRANSITION.DOWN;
  } else if (next.status === MONITOR_STATUS.UP && current.status === MONITOR_STATUS.DOWN) {
    // PENDING to UP is not a recovery: nothing was down, so nobody gets an alert.
    transition = STATE_TRANSITION.RECOVERED;
  }

  return { next, transition, statusChanged: next.status !== current.status };
}

// The state of a monitor with no history. Used when it is paused, resumed or re-pointed.
export function freshMonitorState(now) {
  return {
    status: MONITOR_STATUS.PENDING,
    lastStatusChangeAt: now,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    failureStreakStartedAt: null,
    successStreakStartedAt: null,
    lastCheckedAt: null,
    lastResponseTimeMs: null,
    lastHttpStatus: null,
    lastErrorCode: null,
    nextCheckAt: now,
    // Clearing the lock makes any check still in flight discard its result.
    lockToken: null,
    lockedUntil: null,
  };
}
