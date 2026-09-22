import { describe, expect, spyOn, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from '../engine';
import { renderMixdown } from './renderMixdown';
import { renderStems, STEM_CHANNELS, STEM_TRACKS } from './renderStems';
import {
  allTracksLoop, maxAbsDiff, NEUTRAL_EFFECTS, neutralSnapshot, peakOf, stemChannels,
} from './stemsFixture';
import type { MixdownBusState, MixdownLoop, MixdownSnapshot } from '../playback/plan/songSnapshot';
import type { ArpSettings } from '@/types/synth';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

const DATE = new Date(2026, 8, 22, 12, 0, 0);
const SAMPLE_RATE = 44100;
const at = (sec: number) => Math.round(sec * SAMPLE_RATE);

async function stems(snapshot: MixdownSnapshot): Promise<AudioBuffer> {
  const result = await renderStems(snapshot, 'song', DATE);
  if (!result.ok) throw new Error(`stems failed: ${JSON.stringify(result.reason)}`);
  return result.buffer;
}

async function mix(snapshot: MixdownSnapshot): Promise<AudioBuffer> {
  const result = await renderMixdown(snapshot);
  if (!result.ok) throw new Error(`mixdown failed: ${JSON.stringify(result.reason)}`);
  return result.buffer;
}

function wetSends(buses: readonly MixdownBusState[]): MixdownBusState[] {
  return buses.map((bus) => ({ ...bus, sends: { reverb: 1, delay: 1, distortion: 1 } }));
}

/** Every bus and loop at full sends with audible master effects. */
function wetSnapshot(loops: MixdownLoop[]): MixdownSnapshot {
  const base = neutralSnapshot({ loops });
  return {
    ...base,
    effects: { ...NEUTRAL_EFFECTS, reverbWet: 0.6, delayWet: 0.5 },
    buses: wetSends(base.buses),
    loops: base.loops.map((loop) => ({ ...loop, buses: wetSends(loop.buses) })),
  };
}

function expectStemsEqual(a: AudioBuffer, b: AudioBuffer): void {
  for (let c = 0; c < STEM_CHANNELS; c += 1) {
    expect(maxAbsDiff(a.getChannelData(c), b.getChannelData(c))).toBe(0);
  }
}

const METHODS = [
  'triggerSynthNoteOn', 'triggerSynthNoteOff', 'triggerDrum',
  'setSourceState', 'setDrumKit', 'setDrumTrackGain',
] as const;
type Method = (...args: unknown[]) => unknown;

async function callLog(render: () => Promise<unknown>): Promise<unknown[][]> {
  const proto = AudioEngine.prototype as unknown as Record<(typeof METHODS)[number], Method>;
  const log: unknown[][] = [];
  const spies = METHODS.map((method) => {
    const original = proto[method];
    return spyOn(proto, method).mockImplementation(function (this: unknown, ...args: unknown[]) {
      const out = original.apply(this, args);
      log.push([method, ...args.map((a) => (typeof a === 'object' && a !== null ? '[object]' : a)), out ?? null]);
      return out;
    });
  });
  try {
    await render();
    return log;
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

describe('renderStems: the stems are the mix before the master', () => {
  test('with zero sends and a neutral master, the stems sum to the mixdown per sample', async () => {
    const snapshot = neutralSnapshot();
    const stemBuffer = await stems(snapshot);
    const mixBuffer = await mix(snapshot);
    for (const channel of [0, 1]) {
      const sum = new Float32Array(mixBuffer.length);
      STEM_TRACKS.forEach((_, i) => {
        const data = stemBuffer.getChannelData(2 * i + channel);
        for (let s = 0; s < sum.length; s += 1) sum[s] += data[s];
      });
      expect(maxAbsDiff(sum, mixBuffer.getChannelData(channel))).toBeLessThanOrEqual(1e-5);
    }
    for (const { name } of STEM_TRACKS) expect(peakOf(stemChannels(stemBuffer, name)[0])).toBeGreaterThan(1e-3);
  });

  test("an arp 'random' song makes the mixdown's engine calls, in order", async () => {
    const random: ArpSettings = { active: true, mode: 'random', rate: '16n', octaves: 2 };
    const snapshot = neutralSnapshot({
      loops: [allTracksLoop({ repeatCount: 2, chordArpSettings: random, synthArpSettings: random })],
    });
    const mixLog = await callLog(() => renderMixdown(snapshot));
    const stemLog = await callLog(() => renderStems(snapshot, 'song', DATE));
    expect(stemLog.length).toBeGreaterThan(0);
    expect(stemLog).toEqual(mixLog);
  });
});

describe('renderStems: dry means dry', () => {
  test('sends, master effects and master volume leave every stem bit-identical', async () => {
    const base = neutralSnapshot();
    const reference = await stems(base);
    const variants: MixdownSnapshot[] = [
      wetSnapshot(base.loops),
      {
        ...base,
        // reverbDecay stays: it sets the length and reseeds the impulse (spec correction 2).
        effects: {
          ...NEUTRAL_EFFECTS, reverbWet: 0.6, delayWet: 0.5, delayFeedback: 0.6, distortionWet: 0.7,
          eqBypass: false, eqLow: 9, eqHigh: -9, compressorEnabled: true, limiterEnabled: true,
        },
      },
      { ...base, masterVolume: 0.25 },
    ];
    for (const variant of variants) expectStemsEqual(await stems(variant), reference);
  });
});

describe('renderStems: Beat', () => {
  test("a voice's reverbSend leaves the Beat stem bit-identical", async () => {
    const loop = allTracksLoop();
    const voices = { ...loop.beatParams.voices, kick: { ...loop.beatParams.voices.kick, reverbSend: 0 } };
    const reference = await stems(wetSnapshot([loop]));
    const changed = await stems(wetSnapshot([{ ...loop, beatParams: { ...loop.beatParams, voices } }]));
    const [refL, refR] = stemChannels(reference, 'beat');
    const [newL, newR] = stemChannels(changed, 'beat');
    expect(maxAbsDiff(newL, refL)).toBe(0);
    expect(maxAbsDiff(newR, refR)).toBe(0);
  });

  test('the Beat filter is upstream of the bus: a cutoff change reaches the Beat stem only', async () => {
    const loop = allTracksLoop();
    const filtered = allTracksLoop({
      beatParams: { ...loop.beatParams, filter: { ...loop.beatParams.filter, type: 'lowpass', cutoff: 150 } },
    });
    const reference = await stems(neutralSnapshot({ loops: [loop] }));
    const changed = await stems(neutralSnapshot({ loops: [filtered] }));
    expect(maxAbsDiff(stemChannels(changed, 'beat')[0], stemChannels(reference, 'beat')[0])).toBeGreaterThan(1e-3);
    expect(maxAbsDiff(stemChannels(changed, 'chord')[0], stemChannels(reference, 'chord')[0])).toBe(0);
  });

  test('a drum voice gain of 0 removes that voice (its step-8 hit at 1 s)', async () => {
    const loop = allTracksLoop();
    const silentKick = allTracksLoop({
      beatVoiceGains: loop.beatVoiceGains.map((row) => (row.voice === 'kick' ? { ...row, gain: 0 } : row)),
    });
    const reference = await stems(neutralSnapshot({ loops: [loop] }));
    const changed = await stems(neutralSnapshot({ loops: [silentKick] }));
    // The fixture kick plays steps 0 and 8; setDrumTrackGain is a 10 ms approach
    // from 1, so the t=0 hit leaks its first milliseconds (spec correction 3).
    expect(peakOf(stemChannels(reference, 'beat')[0], at(1), at(2))).toBeGreaterThan(1e-3);
    expect(peakOf(stemChannels(changed, 'beat')[0], at(1), at(2))).toBeLessThanOrEqual(1e-6);
  });
});

/**
 * node-web-audio-api's `cancelAndHoldAtTime` after a lone `setValueAtTime`
 * writes ±FLT_MAX into the param's timeline, so a mid-song bus change blows up
 * the render in the polyfill (the mixdown's too). Force the engine's own
 * no-hold fallback, as `renderMixdown.sourceBus.test.ts` does.
 */
class HoldFallbackOfflineAudioContext extends OfflineAudioContext {
  override createGain() {
    const node = super.createGain();
    node.gain.cancelAndHoldAtTime = () => {
      throw new Error('forced unsupported hold');
    };
    return node;
  }
}

async function withHoldFallback<T>(run: () => Promise<T>): Promise<T> {
  const audioGlobal = globalThis as { OfflineAudioContext?: unknown };
  const previous = audioGlobal.OfflineAudioContext;
  audioGlobal.OfflineAudioContext = HoldFallbackOfflineAudioContext;
  try {
    return await run();
  } finally {
    audioGlobal.OfflineAudioContext = previous;
  }
}

describe('renderStems: fader and mute per loop', () => {
  test('a bus muted in loop 2 of 3 is silent there and untouched elsewhere', () => withHoldFallback(async () => {
    const loop = (id: string, chordMuted: boolean): MixdownLoop => {
      const base = allTracksLoop({ id });
      return { ...base, buses: base.buses.map((bus) => (bus.source === 'chord' ? { ...bus, muted: chordMuted } : bus)) };
    };
    const open = await stems(neutralSnapshot({ loops: [loop('a', false), loop('b', false), loop('c', false)] }));
    const muted = await stems(neutralSnapshot({ loops: [loop('a', false), loop('b', true), loop('c', false)] }));
    const [openChord] = stemChannels(open, 'chord');
    const [mutedChord] = stemChannels(muted, 'chord');
    // One-bar loops at 120 BPM: passes start at 0, 2 and 4 s; 100 ms = 10 τ.
    expect(maxAbsDiff(mutedChord, openChord, 0, at(2))).toBe(0);
    expect(peakOf(openChord, at(2.1), at(4))).toBeGreaterThan(1e-3);
    expect(peakOf(mutedChord, at(2.1), at(4))).toBeLessThanOrEqual(1e-4);
    expect(maxAbsDiff(mutedChord, openChord, at(4.1), at(6))).toBeLessThanOrEqual(1e-3);
    expect(maxAbsDiff(stemChannels(muted, 'bass')[0], stemChannels(open, 'bass')[0])).toBe(0);
  }));
});
