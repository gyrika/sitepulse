import { describe, expect, it } from 'vitest';
import { MONITOR_STATUS, STATE_TRANSITION } from '../src/config/monitoring.js';
import { nextMonitorState } from '../src/services/monitorState.js';

const start = (status = MONITOR_STATUS.PENDING) => ({
  status,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  failureStreakStartedAt: null,
  successStreakStartedAt: null,
});

// Plays a sequence such as "FFS" and returns the state and transition after each step.
function play(sequence, initial = start()) {
  let state = initial;
  return [...sequence].map((symbol, index) => {
    const { next, transition } = nextMonitorState(state, {
      success: symbol === 'S',
      checkedAt: new Date(index * 60_000),
    });
    state = next;
    return { ...next, transition };
  });
}

describe('nextMonitorState', () => {
  it('stays UP through 1 and 2 failures, and goes DOWN on the 3rd', () => {
    const steps = play('FFF', start(MONITOR_STATUS.UP));
    expect(steps.map((step) => step.status)).toEqual(['UP', 'UP', 'DOWN']);
    expect(steps.map((step) => step.transition)).toEqual([null, null, STATE_TRANSITION.DOWN]);
  });

  it('stays DOWN after 1 success, and recovers on the 2nd', () => {
    const steps = play('SS', start(MONITOR_STATUS.DOWN));
    expect(steps.map((step) => step.status)).toEqual(['DOWN', 'UP']);
    expect(steps.map((step) => step.transition)).toEqual([null, STATE_TRANSITION.RECOVERED]);
  });

  it('a success resets the failure streak', () => {
    const steps = play('FFSFF', start(MONITOR_STATUS.UP));
    expect(steps.at(-1)).toMatchObject({ status: 'UP', consecutiveFailures: 2 });
    expect(steps.every((step) => step.transition === null)).toBe(true);
  });

  it('a failure resets the success streak while DOWN', () => {
    const steps = play('SFS', start(MONITOR_STATUS.DOWN));
    expect(steps.at(-1)).toMatchObject({ status: 'DOWN', consecutiveSuccesses: 1 });
    expect(steps.every((step) => step.transition === null)).toBe(true);
  });

  it('only reports the DOWN transition once however long the outage lasts', () => {
    const transitions = play('FFFFFFFF', start(MONITOR_STATUS.UP)).filter((step) => step.transition);
    expect(transitions).toHaveLength(1);
  });

  it('only reports RECOVERED once however long the site stays up', () => {
    const transitions = play('SSSSSS', start(MONITOR_STATUS.DOWN)).filter((step) => step.transition);
    expect(transitions).toHaveLength(1);
  });

  it('PENDING needs 2 successes to go UP, and that is not a recovery', () => {
    const steps = play('SS');
    expect(steps.map((step) => step.status)).toEqual(['PENDING', 'UP']);
    expect(steps.at(-1).transition).toBeNull();
  });

  it('a brand new monitor can go DOWN after 3 failures', () => {
    const steps = play('FFF');
    expect(steps.at(-1)).toMatchObject({ status: 'DOWN', transition: STATE_TRANSITION.DOWN });
  });

  it('keeps the time of the first failure in the streak', () => {
    const steps = play('FFF', start(MONITOR_STATUS.UP));
    expect(steps.at(-1).failureStreakStartedAt).toEqual(new Date(0));
  });

  it('keeps the time of the first success in the streak', () => {
    const steps = play('SS', start(MONITOR_STATUS.DOWN));
    expect(steps.at(-1).successStreakStartedAt).toEqual(new Date(0));
  });

  it('runs a complete outage cycle', () => {
    const steps = play('SSFFFFSFSS');
    expect(steps.filter((step) => step.transition).map((step) => step.transition)).toEqual([
      STATE_TRANSITION.DOWN,
      STATE_TRANSITION.RECOVERED,
    ]);
    expect(steps.at(-1).status).toBe('UP');
  });
});
