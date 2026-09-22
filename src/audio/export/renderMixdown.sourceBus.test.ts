import { describe, expect, spyOn, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { BeatPattern } from '@/types';
import { MIXDOWN_SAMPLE_RATE, renderMixdown } from './renderMixdown';
import type { MixdownLoop } from '../playback/plan/songSnapshot';
import {
  beatPatternFixture,
  FACTORY_EFFECTS,
  mixdownLoop,
  mixdownMelodyBar,
  mixdownSnapshot,
} from './mixdownFixture';
import { AudioEngine } from '../engine';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

function silentBeatPattern(): BeatPattern {
  const pattern = beatPatternFixture();
  pattern.rows.kick = pattern.rows.kick.map(() => false);
  return pattern;
}

function windowPeaks(
  result: Awaited<ReturnType<typeof renderMixdown>>,
  startSeconds = 0,
  endSeconds = 0.1,
): number[] {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
  expect(result.buffer.numberOfChannels).toBe(2);
  const start = Math.floor(MIXDOWN_SAMPLE_RATE * startSeconds);
  const end = Math.floor(MIXDOWN_SAMPLE_RATE * endSeconds);
  expect(end).toBeLessThanOrEqual(result.buffer.length);
  expect(end).toBeGreaterThan(start);
  return Array.from({ length: result.buffer.numberOfChannels }, (_, channel) => {
    const samples = result.buffer.getChannelData(channel);
    let maximum = 0;
    for (let i = start; i < end; i += 1) {
      maximum = Math.max(maximum, Math.abs(samples[i]));
    }
    return maximum;
  });
}

/** Each fixture schedules exactly one named source at the opening boundary. */
const MUTED_SOURCE_CASES: Array<{ source: string; loop: Partial<MixdownLoop> }> = [
  {
    source: 'synth',
    loop: { chords: [], beatPattern: silentBeatPattern(), leadMelodySteps: mixdownMelodyBar('C4') },
  },
  {
    source: 'fx',
    loop: { chords: [], beatPattern: silentBeatPattern(), fxMelodySteps: mixdownMelodyBar('G4') },
  },
  {
    source: 'chord',
    loop: {
      beatPattern: silentBeatPattern(),
      bassPatternMode: 'custom',
      customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
      padDroneIntervals: [],
    },
  },
  {
    source: 'bass',
    loop: {
      beatPattern: silentBeatPattern(),
      chordRhythmMode: 'custom',
      customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
      padDroneIntervals: [],
    },
  },
  {
    source: 'pad',
    loop: {
      beatPattern: silentBeatPattern(),
      chordRhythmMode: 'custom',
      customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
      bassPatternMode: 'custom',
      customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
    },
  },
  { source: 'sequencer', loop: { chords: [] } },
];

describe('renderMixdown: muted source buses', () => {
  for (const { source, loop: sourceLoop } of MUTED_SOURCE_CASES) {
    test(`muted source is silent from sample zero (${source})`, async () => {
      const buses = mixdownSnapshot().buses;
      const render = async (muted: boolean) => renderMixdown(mixdownSnapshot({
        buses: buses.map((bus) => ({ ...bus, muted: muted || bus.source !== source })),
        effects: {
          ...FACTORY_EFFECTS,
          reverbWet: 0,
          delayWet: 0,
          distortionWet: 0,
          limiterEnabled: false,
        },
        loops: [mixdownLoop({
          ...sourceLoop,
          buses: buses.map((bus) => ({ ...bus, muted: muted || bus.source !== source })),
        })],
      }));

      for (const peak of windowPeaks(await render(false))) expect(peak).toBeGreaterThan(0);
      for (const peak of windowPeaks(await render(true))) expect(peak).toBe(0);
    });
  }

  test('arrangement fallback keeps Lead muted across distinct future loops; the target alone starts silent', async () => {
    let fallbackCount = 0;
    class FallbackOfflineAudioContext extends OfflineAudioContext {
      override createGain() {
        const node = super.createGain();
        node.gain.cancelAndHoldAtTime = () => {
          fallbackCount += 1;
          throw new Error('forced unsupported hold');
        };
        return node;
      }
    }
    const audioGlobal = globalThis as { OfflineAudioContext?: unknown };
    const previousContext = audioGlobal.OfflineAudioContext;
    audioGlobal.OfflineAudioContext = FallbackOfflineAudioContext;
    try {
      const buses = mixdownSnapshot().buses.map((bus) => ({ ...bus, muted: bus.source !== 'synth' }));
      const loud = mixdownLoop({
        id: 'audible-lead',
        chords: [],
        beatPattern: silentBeatPattern(),
        leadMelodySteps: mixdownMelodyBar('C4'),
        buses,
      });
      const muted = {
        ...loud,
        id: 'muted-lead',
        buses: buses.map((bus) => ({ ...bus, muted: true })),
      };
      const target = { ...muted, id: 'muted-lead-next', leadMelodySteps: mixdownMelodyBar('G4') };
      const snapshot = mixdownSnapshot({
        buses,
        effects: { ...FACTORY_EFFECTS, reverbWet: 0, delayWet: 0, distortionWet: 0, limiterEnabled: false },
        loops: [loud, muted, target],
      });

      const arrangement = await renderMixdown(snapshot);
      expect(fallbackCount).toBeGreaterThan(0);
      for (const peak of windowPeaks(arrangement)) expect(peak).toBeGreaterThan(0);
      // One-bar loops at 120 BPM start at 0, 2 and 4 seconds. The first mute
      // retains its click-free decay; the next muted boundary must not reopen
      // Lead for the target loop's real step-zero note.
      for (const peak of windowPeaks(arrangement, 2.2, 4.1)) expect(peak).toBeLessThan(0.000001);

      const loopOnly = await renderMixdown({ ...snapshot, loops: [target] });
      for (const peak of windowPeaks(loopOnly)) expect(peak).toBe(0);
      const audibleTarget = await renderMixdown({ ...snapshot, loops: [{ ...target, buses }] });
      for (const peak of windowPeaks(audibleTarget)) expect(peak).toBeGreaterThan(0);
    } finally {
      audioGlobal.OfflineAudioContext = previousContext;
    }
  });
});

describe('renderMixdown: per-track sends', () => {
  test("each pass installs its own loop's sends at its start: settle at 0, transition after", async () => {
    const calls: Parameters<AudioEngine['setSourceSends']>[] = [];
    const spy = spyOn(AudioEngine.prototype, 'setSourceSends').mockImplementation(
      (...args: Parameters<AudioEngine['setSourceSends']>) => {
        calls.push(args);
      },
    );
    try {
      const base = mixdownSnapshot();
      const chordReverb = (id: string, reverb: number) => mixdownLoop({
        id,
        buses: base.buses.map((bus) => (bus.source === 'chord' ? { ...bus, sends: { ...bus.sends, reverb } } : bus)),
      });
      const result = await renderMixdown(mixdownSnapshot({
        loops: [chordReverb('loop-a', 0.25), chordReverb('loop-b', 0.75)],
      }));
      expect(result.ok).toBe(true);
      const songLevel = base.buses.find((bus) => bus.source === 'chord')!.sends;
      // One-bar loops at 120 BPM: loop-b's pass starts at 2 s.
      expect(calls.filter(([source]) => source === 'chord')).toEqual([
        ['chord', songLevel, 0, 'settle'],
        ['chord', { ...songLevel, reverb: 0.25 }, 0, 'settle'],
        ['chord', { ...songLevel, reverb: 0.75 }, 2, 'transition'],
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  test('a later pass whose sends equal the previous pass pushes nothing (golden bytes)', async () => {
    const calls: Parameters<AudioEngine['setSourceSends']>[] = [];
    const spy = spyOn(AudioEngine.prototype, 'setSourceSends').mockImplementation(
      (...args: Parameters<AudioEngine['setSourceSends']>) => {
        calls.push(args);
      },
    );
    try {
      const result = await renderMixdown(mixdownSnapshot({
        loops: [mixdownLoop({ id: 'loop-a' }), mixdownLoop({ id: 'loop-b' })],
      }));
      expect(result.ok).toBe(true);
      expect(calls.every(([, , time, mode]) => time === 0 && mode === 'settle')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
