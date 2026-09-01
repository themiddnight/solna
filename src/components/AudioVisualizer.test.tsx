import { describe, expect, test } from 'bun:test';
import {
  SILENT_FRAMES_BEFORE_THROTTLE,
  THROTTLED_FRAME_INTERVAL_MS,
  initialSilenceThrottle,
  nextSilenceThrottle,
  VISUALIZER_MODES,
} from './AudioVisualizer';

/** Drives N frames at 60 fps and returns how many of them drew. */
function runFrames(count: number, isSounding: (frame: number) => boolean) {
  let state = initialSilenceThrottle();
  let drawn = 0;
  for (let frame = 0; frame < count; frame++) {
    const out = nextSilenceThrottle(state, isSounding(frame), frame * (1000 / 60));
    state = out.state;
    if (out.shouldDraw) drawn++;
  }
  return { drawn, state };
}

describe('visualizer silence throttle', () => {
  test('every frame draws while audio is sounding', () => {
    expect(runFrames(300, () => true).drawn).toBe(300);
  });

  test('the first N silent frames still draw at full rate', () => {
    // The tail of a note must not stutter, so the throttle only engages after
    // a run of genuinely silent frames.
    expect(runFrames(SILENT_FRAMES_BEFORE_THROTTLE, () => false).drawn)
      .toBe(SILENT_FRAMES_BEFORE_THROTTLE);
  });

  test('past the threshold it settles to the throttled interval', () => {
    // 600 frames at 60 fps = 10 s. The first 90 draw at full rate; the
    // remaining 510 span ~8.5 s and draw at most once per 100 ms, so the
    // total lands around 175 rather than 600.
    const { drawn } = runFrames(600, () => false);
    expect(drawn).toBeGreaterThan(SILENT_FRAMES_BEFORE_THROTTLE);
    expect(drawn).toBeLessThanOrEqual(
      SILENT_FRAMES_BEFORE_THROTTLE + Math.ceil(8500 / THROTTLED_FRAME_INTERVAL_MS) + 1,
    );
    // The whole point: fewer than a third of the frames drew.
    expect(drawn).toBeLessThan(200);
  });

  test('a single sounding frame snaps straight back to full rate', () => {
    let state = initialSilenceThrottle();
    for (let frame = 0; frame < 300; frame++) {
      state = nextSilenceThrottle(state, false, frame * 16.67).state;
    }
    expect(state.silentFrames).toBeGreaterThanOrEqual(SILENT_FRAMES_BEFORE_THROTTLE);

    const wake = nextSilenceThrottle(state, true, 300 * 16.67);
    expect(wake.shouldDraw).toBe(true);
    expect(wake.state.silentFrames).toBe(0);
    // and the very next frame, 16 ms later, draws too — no throttle residue.
    expect(nextSilenceThrottle(wake.state, true, 301 * 16.67).shouldDraw).toBe(true);
  });

  test('the counter resets on sound and re-arms from zero afterwards', () => {
    let state = initialSilenceThrottle();
    for (let frame = 0; frame < 200; frame++) {
      const sounding = frame === 100;
      state = nextSilenceThrottle(state, sounding, frame * 16.67).state;
    }
    expect(state.silentFrames).toBe(99);
  });

  test('a throttled frame that draws records its timestamp', () => {
    let state = initialSilenceThrottle();
    for (let frame = 0; frame < SILENT_FRAMES_BEFORE_THROTTLE + 1; frame++) {
      state = nextSilenceThrottle(state, false, frame * 16.67).state;
    }
    const before = state.lastDrawAtMs;
    const skipped = nextSilenceThrottle(state, false, before + 10);
    expect(skipped.shouldDraw).toBe(false);
    expect(skipped.state.lastDrawAtMs).toBe(before);

    const due = nextSilenceThrottle(skipped.state, false, before + THROTTLED_FRAME_INTERVAL_MS);
    expect(due.shouldDraw).toBe(true);
    expect(due.state.lastDrawAtMs).toBe(before + THROTTLED_FRAME_INTERVAL_MS);
  });

  test('the mode table is untouched by this change', () => {
    expect(VISUALIZER_MODES).toEqual(['wave', 'bars', 'oscilloscope']);
  });
});
