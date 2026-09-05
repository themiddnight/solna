import { describe, expect, test } from 'bun:test';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';

const idle = {
  clockListenerCount: 0,
  liveVoiceCount: 0,
  contextState: 'running' as AudioContextState,
};

describe('shouldSuspendWhenIdle', () => {
  test('a genuinely idle running context may suspend', () => {
    expect(shouldSuspendWhenIdle(idle)).toBe(true);
  });

  test('never while a player holds the clock', () => {
    expect(shouldSuspendWhenIdle({ ...idle, clockListenerCount: 1 })).toBe(false);
  });

  // The metronome is no longer part of this snapshot at all: it cannot make a
  // sound without a clock listener, and that count is the guard right above.
  // The behaviour is pinned through the real engine instead, in engine.test.ts
  // ('an enabled metronome with nothing playing does not block the suspend'),
  // where the toggle can actually be turned on.
  test('a lone clock listener is enough to block it', () => {
    expect(shouldSuspendWhenIdle({ ...idle, clockListenerCount: 1 })).toBe(false);
  });

  test('never while any voice is live or still releasing', () => {
    expect(shouldSuspendWhenIdle({ ...idle, liveVoiceCount: 1 })).toBe(false);
  });

  test('never when the context is not running', () => {
    expect(shouldSuspendWhenIdle({ ...idle, contextState: 'suspended' })).toBe(false);
    expect(shouldSuspendWhenIdle({ ...idle, contextState: 'closed' })).toBe(false);
  });

  test('a held QWERTY note blocks suspend even with no player running', () => {
    // The exact regression this guards: hold a key for 30 s with the transport
    // stopped, and the sustained note must not be cut by the idle timer.
    expect(shouldSuspendWhenIdle({ ...idle, liveVoiceCount: 1, clockListenerCount: 0 })).toBe(false);
  });

  test('the idle window is long enough not to fire between two takes', () => {
    expect(IDLE_SUSPEND_MS).toBeGreaterThanOrEqual(30_000);
  });
});
