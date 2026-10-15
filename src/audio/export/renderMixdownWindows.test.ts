import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from '../engine';
import { renderCheckpoints, renderMixdown } from './renderMixdown';
import { mixdownLoop, mixdownMelodyBar, mixdownSnapshot } from './mixdownFixture';

/**
 * ADR-0061: the walk is performed in windows just ahead of the render
 * position, so render time grows with the song's length and not its square.
 * Split out of `renderMixdown.test.ts`, which sits at the repo's `max-lines`
 * ceiling.
 */
const globals = globalThis as { OfflineAudioContext?: unknown };
const previousOffline = globals.OfflineAudioContext;
globals.OfflineAudioContext = OfflineAudioContext;
afterAll(() => {
  globals.OfflineAudioContext = previousOffline;
});

const SR = 44100;

describe('renderCheckpoints', () => {
  test('a ten-second render pauses every 2%, each mid-quantum', () => {
    const times = renderCheckpoints(10 * SR, SR);
    expect(times).toHaveLength(49);
    expect(times[0]).toBe(8768 / SR);
    expect(times.at(-1)).toBe(432192 / SR);
    for (const t of times) expect(Math.round(t * SR) % 128).toBe(64);
  });

  test('a long render pauses at least once a second', () => {
    const times = renderCheckpoints(100 * SR, SR);
    expect(times).toHaveLength(99);
    expect(times[0]).toBe(44096 / SR);
    expect(times.at(-1)).toBe(4365888 / SR);
  });

  test('a render shorter than 50 quanta never pauses twice in one quantum', () => {
    expect(renderCheckpoints(300, SR)).toEqual([192 / SR, 320 / SR]);
  });
});

describe('renderMixdown: the graph is built just ahead of the render', () => {
  test('every note and hit is built after the render has started and at most three seconds before it sounds', async () => {
    const built: { at: number; renderedTo: number }[] = [];
    let renderContext: BaseAudioContext | null = null;
    const record = (at: number) => built.push({ at, renderedTo: renderContext!.currentTime });
    const bindContext = AudioEngine.prototype.bindContext;
    const bindSpy = spyOn(AudioEngine.prototype, 'bindContext').mockImplementation(
      function (this: AudioEngine, ...args: Parameters<AudioEngine['bindContext']>) {
        renderContext = args[0];
        return bindContext.apply(this, args);
      },
    );
    const noteOn = AudioEngine.prototype.triggerSynthNoteOn;
    const drum = AudioEngine.prototype.triggerDrum;
    const noteSpy = spyOn(AudioEngine.prototype, 'triggerSynthNoteOn').mockImplementation(
      function (this: AudioEngine, ...args: Parameters<AudioEngine['triggerSynthNoteOn']>) {
        record(args[3]!);
        return noteOn.apply(this, args);
      },
    );
    const drumSpy = spyOn(AudioEngine.prototype, 'triggerDrum').mockImplementation(
      function (this: AudioEngine, ...args: Parameters<AudioEngine['triggerDrum']>) {
        record(args[2]!);
        return drum.apply(this, args);
      },
    );
    try {
      // Six one-bar passes at 120 BPM: twelve seconds of song.
      const result = await renderMixdown(mixdownSnapshot({
        loops: [mixdownLoop({ repeatCount: 6, leadMelodySteps: mixdownMelodyBar('E4') })],
      }));
      expect(result.ok).toBe(true);
    } finally {
      bindSpy.mockRestore();
      noteSpy.mockRestore();
      drumSpy.mockRestore();
    }

    expect(built.filter(({ at }) => at >= 10)).not.toHaveLength(0);
    for (const { at, renderedTo } of built) {
      expect(at).toBeGreaterThanOrEqual(renderedTo);
      expect(at - renderedTo).toBeLessThanOrEqual(3);
    }
  });
});
