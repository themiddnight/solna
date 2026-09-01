import { describe, expect, test } from 'bun:test';
import { createFrameCoalescer, type FrameScheduler } from './frameCoalescer';

/** A frame scheduler the test drives by hand — no rAF, no timers, no sleeping. */
function manualFrames() {
  let next = 1;
  const queued = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    request: (fn) => {
      const handle = next++;
      queued.set(handle, fn);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
  };
  const tick = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { scheduler, tick, armed: () => queued.size };
}

describe('createFrameCoalescer', () => {
  test('the first value for a key applies synchronously (discrete change, no latency)', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));

    expect(log).toEqual(['a']);
    expect(frames.armed()).toBe(1);
  });

  test('several DISTINCT keys in one tick all apply immediately', () => {
    // A vibe apply writes synthParams + chordSynthParams + bassSynthParams +
    // effects in one action; none of them may be delayed.
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('effects', () => log.push('fx'));
    c.push('synth', () => log.push('s'));
    c.push('chord', () => log.push('c'));
    c.push('bass', () => log.push('b'));

    expect(log).toEqual(['fx', 's', 'c', 'b']);
    expect(c.pendingKeys()).toEqual([]);
  });

  test('a repeat of the SAME key inside the window defers, and only the last one lands', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('v1'));
    c.push('synth', () => log.push('v2'));
    c.push('synth', () => log.push('v3'));

    expect(log).toEqual(['v1']);
    expect(c.pendingKeys()).toEqual(['synth']);

    frames.tick();
    expect(log).toEqual(['v1', 'v3']);
    expect(c.pendingKeys()).toEqual([]);
  });

  test('a sustained gesture is capped at one apply per frame', () => {
    const frames = manualFrames();
    const log: number[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    // Two pointer events per frame for four frames. Each value is snapshotted
    // into its own binding before push() — a deferred thunk runs later, so
    // closing over a shared counter would read whatever it had become by
    // then, not the value that was current when the pointer event fired.
    let n = 0;
    for (let frame = 0; frame < 4; frame++) {
      const v1 = n++;
      c.push('synth', () => log.push(v1));
      const v2 = n++;
      c.push('synth', () => log.push(v2));
      frames.tick();
    }

    // leading 0, then the LAST value of each window: 1, 3, 5, 7.
    expect(log).toEqual([0, 1, 3, 5, 7]);
  });

  test('a frame that drains nothing does not re-arm, so the next push is leading again', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    frames.tick(); // nothing pending
    expect(frames.armed()).toBe(0);

    c.push('synth', () => log.push('b'));
    expect(log).toEqual(['a', 'b']); // applied immediately, not deferred
  });

  test('a frame that DID drain re-arms, so the cap holds across a long gesture', () => {
    const frames = manualFrames();
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => {});
    c.push('synth', () => {});
    frames.tick();

    expect(frames.armed()).toBe(1);
  });

  test('flush() applies pending work now and cancels the frame', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    c.push('synth', () => log.push('b'));
    c.flush();

    expect(log).toEqual(['a', 'b']);
    expect(frames.armed()).toBe(0);
    frames.tick();
    expect(log).toEqual(['a', 'b']); // no double apply
  });

  test('cancel() drops pending work without applying it', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    c.push('synth', () => log.push('b'));
    c.cancel();
    frames.tick();

    expect(log).toEqual(['a']);
    expect(c.pendingKeys()).toEqual([]);
  });

  test('keys are independent: a busy key never blocks a quiet one', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('s1'));
    c.push('synth', () => log.push('s2')); // deferred
    c.push('bass', () => log.push('b1')); // first for its key -> immediate

    expect(log).toEqual(['s1', 'b1']);
    frames.tick();
    expect(log).toEqual(['s1', 'b1', 's2']);
  });

  test('a throwing thunk does not strand the coalescer', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    c.push('synth', () => {
      throw new Error('engine blew up');
    });
    expect(() => frames.tick()).not.toThrow();
    expect(c.pendingKeys()).toEqual([]);

    c.push('synth', () => log.push('c'));
    expect(log).toEqual(['a', 'c']);
  });
});
