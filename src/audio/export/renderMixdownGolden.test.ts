/**
 * DEV-420 golden: recorded on the pre-refactor renderer and never edited by a
 * later commit of the branch. The WAV hash proves byte-identity (RNG
 * interleaving, graph wiring); the call log localises a failure to the first
 * differing engine call. Re-record only with GOLDEN_UPDATE=1, and only in a
 * commit that changes nothing else (see the DEV-420 spec, risk R2).
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from '../engine';
import { renderMixdown } from './renderMixdown';
import {
  beatMixFixture,
  beatPatternFixture,
  FACTORY_EFFECTS,
  mixdownLoop,
  mixdownMelodyBar,
  mixdownSnapshot,
} from './mixdownFixture';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';
import type { ActiveSynth, ArpSettings, SubtractiveParams } from '@/types/synth';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

type Snapshot = Parameters<typeof renderMixdown>[0];
type Loop = Snapshot['loops'][number];

const DIR = join(process.cwd(), 'src/audio/export');
const HASH_FILE = join(DIR, 'renderMixdownGolden.wav.sha256');
const CALLS_FILE = join(DIR, 'renderMixdownGolden.calls.json');
const UPDATE = process.env.GOLDEN_UPDATE === '1';
const METHODS = [
  'triggerSynthNoteOn',
  'triggerSynthNoteOff',
  'triggerDrum',
  'setSourceState',
  'setDrumKit',
  'setDrumTrackGain',
] as const;

function randomArp(): ArpSettings {
  return { active: true, mode: 'random', rate: '16n', octaves: 2 };
}

function subtractive(edit: (patch: SubtractiveParams) => void): ActiveSynth {
  const synth = structuredClone(SUBTRACTIVE_INIT);
  edit(synth.patch.synth);
  return synth;
}

function beatPattern(hits: Partial<Record<BeatVoiceId, number[]>>): BeatPattern {
  const pattern = beatPatternFixture();
  for (const voice of Object.keys(pattern.rows) as BeatVoiceId[]) {
    pattern.rows[voice] = pattern.rows[voice].map(() => false);
  }
  for (const [voice, steps] of Object.entries(hits) as [BeatVoiceId, number[]][]) {
    for (const step of steps) pattern.rows[voice][step] = true;
  }
  return pattern;
}

function mutedMix(voice: BeatVoiceId): BeatMix {
  const mix = structuredClone(beatMixFixture());
  mix.voices[voice] = { ...mix.voices[voice], muted: true };
  return mix;
}

/** Loop A: random arps on chord, bass and Lead; noisy chord patch; S&H LFO on Lead. */
function loopA(): Loop {
  return mixdownLoop({
    id: 'golden-a',
    repeatCount: 2,
    chords: [
      { id: 'a1', root: 'C', quality: 'maj', bars: 1 },
      { id: 'a2', root: 'A', quality: 'min', bars: 1 },
    ],
    chordRhythmId: 'fourOnFloor',
    chordArpSettings: randomArp(),
    chordSynthParams: subtractive((p) => {
      p.utility = { ...p.utility, noiseEnabled: true, noiseLevelDb: -18 };
    }),
    bassPatternId: 'driving-eighths',
    bassArpSettings: randomArp(),
    padMode: 'pad',
    leadMelodySteps: mixdownMelodyBar('E4'),
    synthArpSettings: randomArp(),
    synthParams: subtractive((p) => {
      p.lfo = {
        ...p.lfo,
        waveform: 'sample-and-hold',
        depth: 0.5,
        route: { target: 'filter-cutoff', unit: 'semitones', amount: 12 },
      };
    }),
    beatPattern: beatPattern({ kick: [0, 8], snare: [4, 12], hihat: [2, 6, 10, 14] }),
  });
}

/** Loop B: full-hold chord and bass, pad drone, FX melody, one Beat voice muted. */
function loopB(): Loop {
  return mixdownLoop({
    id: 'golden-b',
    chords: [{ id: 'b1', root: 'F', quality: 'maj', bars: 1 }],
    chordRhythmId: 'sustained',
    bassPatternId: 'whole-note-root',
    padMode: 'drone',
    fxMelodySteps: mixdownMelodyBar('G5'),
    beatPattern: beatPattern({ kick: [0], snare: [8], hihat: [0, 4, 8, 12] }),
    beatMix: mutedMix('snare'),
  });
}

/** Loop C: chordless, Lead only, drums. */
function loopC(): Loop {
  return mixdownLoop({
    id: 'golden-c',
    chords: [],
    leadMelodySteps: mixdownMelodyBar('C5'),
    beatPattern: beatPattern({ kick: [0, 4, 8, 12] }),
  });
}

function goldenSnapshot(): Snapshot {
  return mixdownSnapshot({
    effects: { ...FACTORY_EFFECTS, reverbDecay: 2.6, delayWet: 0.3 },
    loops: [loopA(), loopB(), loopC()],
  });
}

/** Every object-valued loop field, labelled `loop<i>.<field>` by reference. */
function objectLabels(snapshot: Snapshot): Map<unknown, string> {
  const labels = new Map<unknown, string>();
  snapshot.loops.forEach((loop, i) => {
    for (const [field, value] of Object.entries(loop)) {
      if (typeof value === 'object' && value !== null && !labels.has(value)) {
        labels.set(value, `loop${i}.${field}`);
      }
    }
  });
  return labels;
}

// tsc resolves `bun:test`'s ambient types from @types/node's `node:test` shape (no
// `Bun` global, no (name, fn, timeoutMs) overload for `test`) even though the runtime
// is real Bun — a pre-existing repo quirk, not a DEV-420 concern. These two local
// type-only shims describe what Bun actually provides at runtime.
declare const Bun: {
  CryptoHasher: new (algorithm: string) => { update(data: Uint8Array): unknown; digest(encoding: string): string };
};
type TestWithTimeout = (name: string, fn: () => Promise<void>, timeoutMs: number) => void;

type Method = (...args: unknown[]) => unknown;

async function renderWithCallLog(snapshot: Snapshot) {
  const proto = AudioEngine.prototype as unknown as Record<(typeof METHODS)[number], Method>;
  const labels = objectLabels(snapshot);
  const log: unknown[][] = [];
  const spies = METHODS.map((method) => {
    const original = proto[method];
    return spyOn(proto, method).mockImplementation(function (this: unknown, ...args: unknown[]) {
      const out = original.apply(this, args);
      log.push([method, ...args.map((a) => labels.get(a) ?? a), out ?? null]);
      return out;
    });
  });
  try {
    const result = await renderMixdown(snapshot);
    // JSON round-trip: the comparison is against a JSON file, so normalise
    // undefined → null and -0 → 0 exactly as the file stores them.
    return { result, log: JSON.parse(JSON.stringify(log)) as unknown[][] };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

async function sha256(blob: Blob): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(new Uint8Array(await blob.arrayBuffer()));
  return hasher.digest('hex');
}

function readGolden(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — record it with GOLDEN_UPDATE=1 on the pre-refactor code`);
  }
  return readFileSync(file, 'utf8');
}

describe('renderMixdown golden (DEV-420)', () => {
  (test as TestWithTimeout)('golden: the fixture renders to the recorded WAV sha256', async () => {
    const result = await renderMixdown(goldenSnapshot());
    if (!result.ok) throw new Error(`render failed: ${JSON.stringify(result.reason)}`);
    const hash = await sha256(result.blob);
    if (UPDATE) writeFileSync(HASH_FILE, `${hash}\n`);
    expect(hash).toBe(readGolden(HASH_FILE).trim());
  }, 60_000);

  (test as TestWithTimeout)('golden: the fixture makes the recorded engine-call sequence', async () => {
    const { result, log } = await renderWithCallLog(goldenSnapshot());
    expect(result.ok).toBe(true);
    if (UPDATE) {
      writeFileSync(CALLS_FILE, `[\n${log.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`);
    }
    expect(log).toEqual(JSON.parse(readGolden(CALLS_FILE)) as unknown[][]);
  }, 60_000);
});
