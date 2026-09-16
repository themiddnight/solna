import { describe, expect, spyOn, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  buildLoopVoices,
  MIXDOWN_SAMPLE_RATE,
  padSnapshotForLoop,
  planArrangement,
  planLoopAudioAutomation,
  renderBassEventsAt,
  renderChordEventsAt,
  renderMixdown,
  type MixdownLoop,
  type MixdownRenderProgress,
} from './renderMixdown';
import {
  beatMixFixture,
  beatParamsFixture,
  beatPatternFixture,
  mixdownLoop,
  mixdownMelodyBar,
  mixdownSnapshot,
  FACTORY_EFFECTS,
} from './mixdownFixture';
import { AudioEngine, audioEngine } from '../engine';
import { random } from '../rng';
import { cycleHoldScale, resolvePlaybackBassCycle, resolvePlaybackRhythmCycle } from '../chordRhythms';
import { buildChordEvents, eventsForCycleStep } from '../playback/chordPlayback';
import { isApproachToken, resolveBassSteps } from '../bassPatterns';
import { patternStoredIndexAt } from '@/utils/patternTimeline';
import { generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { BeatPattern, BeatVoices } from '@/types';
import { padPlanSnapshot } from '@/store/playbackPlanSnapshots';
import { planPadArm } from '../playback/plan/padPlan';
import type { AppStore } from '@/store/types';

// The capability probe reads `globalThis.OfflineAudioContext`, so the TEST
// provides it — the same way a browser does. There is no injection seam in
// the production code for this, deliberately: a device with no offline
// context is a degraded state the probe reports, and a seam only tests use
// would be a second path through the one branch that matters.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('planArrangement', () => {
  test('one loop, one bar, one repeat is stepsPerBar steps', () => {
    const plan = planArrangement(mixdownSnapshot());
    expect(plan.totalSteps).toBe(16);
    expect(plan.passes).toEqual([
      { loopIndex: 0, startStep: 0, passSteps: 16, dwellSteps: 16 },
    ]);
  });

  test('repeats multiply the dwell, not the pass', () => {
    const plan = planArrangement(
      mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 3 })] }),
    );
    expect(plan.passes[0]).toEqual({
      loopIndex: 0,
      startStep: 0,
      passSteps: 16,
      dwellSteps: 48,
    });
    expect(plan.totalSteps).toBe(48);
  });

  test('a chordless loop still dwells a whole bar', () => {
    // The spec's edge case: loopDwellSteps floors a loop with no chords at
    // stepsPerBar, matching live playback. A silent BAR in the file, never a
    // skipped loop.
    const plan = planArrangement(
      mixdownSnapshot({ loops: [mixdownLoop({ chords: [] })] }),
    );
    expect(plan.passes[0]).toEqual({
      loopIndex: 0,
      startStep: 0,
      passSteps: 16,
      dwellSteps: 16,
    });
  });

  test('a second loop starts where the first stopped', () => {
    const plan = planArrangement(
      mixdownSnapshot({
        loops: [
          mixdownLoop({ id: 'a', repeatCount: 2 }),
          mixdownLoop({ id: 'b', chords: [{ id: 'c2', root: 'F', quality: 'maj', bars: 2 }] }),
        ],
      }),
    );
    expect(plan.passes[1]).toEqual({
      loopIndex: 1,
      startStep: 32,
      passSteps: 32,
      dwellSteps: 32,
    });
    expect(plan.totalSteps).toBe(64);
  });

  test('repeatCount 0 and absent both floor at one pass', () => {
    const zero = planArrangement(mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 0 })] }));
    const absent = planArrangement(mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: undefined })] }));
    expect(zero.totalSteps).toBe(16);
    expect(absent.totalSteps).toBe(16);
  });

  test('positions every loop\'s Beat patch on its arrangement boundary', () => {
    const filtered = (cutoff: number, resonance: number) => {
      const base = beatParamsFixture();
      return { ...base, filter: { ...base.filter, cutoff, resonance } };
    };
    const snapshot = mixdownSnapshot({
      loops: [
        mixdownLoop({ beatParams: filtered(500, 2) }),
        mixdownLoop({ beatParams: filtered(12000, 1) }),
      ],
    });

    expect(
      planLoopAudioAutomation(snapshot, planArrangement(snapshot)).map((entry) => ({
        loopIndex: entry.loopIndex,
        time: entry.time,
        filter: entry.beatParams.filter,
      })),
    ).toEqual([
      { loopIndex: 0, time: 0, filter: { cutoff: 500, resonance: 2, type: 'lowpass' } },
      { loopIndex: 1, time: 2, filter: { cutoff: 12000, resonance: 1, type: 'lowpass' } },
    ]);
  });
});

describe('buildLoopVoices', () => {
  test('maps every bar of a pass to the chord that covers it', () => {
    const loop = mixdownLoop({
      chords: [
        { id: 'a', root: 'C', quality: 'maj', bars: 1 },
        { id: 'b', root: 'F', quality: 'maj', bars: 3 },
      ],
    });
    const voices = buildLoopVoices(loop, '4/4', 120, 16);
    expect(voices.chordsByBar).toEqual([0, 1, 1, 1]);
    expect(voices.chordStartStep).toEqual([0, 16]);
  });

  test('a full-hold rhythm produces no per-step events, only a hold', () => {
    // 'sustained' is the full-hold chord rhythm, 'whole-note-root' the
    // full-hold bass — both short-written in the fixture above.
    const voices = buildLoopVoices(mixdownLoop(), '4/4', 120, 16);
    expect(voices.chordArp).toBe(false);
    expect(voices.chordEvents[0]).toEqual([]);
    expect(voices.chordHoldSec[0]).toBeGreaterThan(0);
    expect(voices.bassHoldNotes[0]).not.toBeNull();
  });

  test('a one-hit rhythm produces per-step events and no hold', () => {
    // 'offbeatStabs' and 'offbeat-sub' are real, one-hit, non-full-hold ids
    // (the brief's 'offbeat'/'root-8ths' would have fallen back to the
    // full-hold library head and asserted the wrong thing).
    const voices = buildLoopVoices(
      mixdownLoop({ chordRhythmId: 'offbeatStabs', chordOctave: 4, bassPatternId: 'offbeat-sub' }),
      '4/4',
      120,
      16,
    );
    expect(voices.chordHoldSec[0]).toBe(0);
    expect(voices.chordEvents[0].length).toBeGreaterThan(0);
    expect(voices.bassHoldNotes[0]).toBeNull();
  });
});

/**
 * The chords a render emits at a step and the chords live playback emits at
 * the same step must be the SAME events: the mixdown is the loop, offline, and
 * a custom pattern's second bar is the part a one-bar fold used to lose.
 *
 * Three one-bar chords under a two-bar custom cycle, so column 20 belongs to
 * the second bar and to the third chord — a step a bar-relative filter maps
 * onto column 4, under a different chord.
 */
/** A Beat that plays nothing, for the tests that measure one melodic source. */
function silentBeatPattern(): BeatPattern {
  const pattern = beatPatternFixture();
  pattern.rows.kick = pattern.rows.kick.map(() => false);
  return pattern;
}

const CHORD_DURATIONS = [16, 16, 16];
const STEP_DUR = stepDurationSec(120);

function customCycleLoop(): MixdownLoop {
  const chordRow = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
  chordRow[patternStoredIndexAt(0, 16)] = true;
  chordRow[patternStoredIndexAt(20, 16)] = true;
  const bassRow = new Array<BassStepChoice>(2 * MAX_STEPS_PER_BAR).fill('rest');
  bassRow[patternStoredIndexAt(0, 16)] = 'root';
  bassRow[patternStoredIndexAt(20, 16)] = 'fifth';
  return mixdownLoop({
    chords: [
      { id: 'a', root: 'C', quality: 'maj', bars: 1 },
      { id: 'b', root: 'F', quality: 'maj', bars: 1 },
      { id: 'c', root: 'G', quality: 'maj', bars: 1 },
    ],
    chordRhythmMode: 'custom',
    customChordRhythm: chordRow,
    customChordHoldSteps: new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1),
    customChordLoopLength: 2,
    bassPatternMode: 'custom',
    customBassPattern: bassRow,
    customBassHoldSteps: new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1),
    customBassLoopLength: 2,
  });
}

/** The chord covering a pass-relative step; every chord here is one bar. */
const chordIndexAt = (step: number) => Math.min(Math.floor(step / 16), 2);

/**
 * The asymmetric fixture the contract-locking suites share the shape of: a
 * TWO-bar Chord lane and a FOUR-bar Bass lane over one four-bar progression,
 * played in 3/4 — a twelve-column bar, not the widest meter's twenty-four.
 *
 * Everything is STORED bar-major at `MAX_STEPS_PER_BAR`, so the onsets sit on
 * slots 0/24 for the chord lane and 0/24/48/72 for the bass lane, and each
 * carries a hold of twelve columns. Reading the stored width as if it were the
 * playing width is the exact defect this test exists to catch: it would report
 * 48- and 96-step cycles and leave column 12 of the chord lane unreachable.
 */
const THREE_FOUR_STEPS = 12;

function asymmetricCycleLoop(): MixdownLoop {
  const chordRow = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
  const chordHolds = new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1);
  for (const bar of [0, 1]) {
    chordRow[bar * MAX_STEPS_PER_BAR] = true;
    chordHolds[bar * MAX_STEPS_PER_BAR] = THREE_FOUR_STEPS;
  }

  const bassRow = new Array<BassStepChoice>(4 * MAX_STEPS_PER_BAR).fill('rest');
  const bassHolds = new Array<number>(4 * MAX_STEPS_PER_BAR).fill(1);
  const tones: BassStepChoice[] = ['root', 'third', 'fifth', 'seventh'];
  tones.forEach((tone, bar) => {
    bassRow[bar * MAX_STEPS_PER_BAR] = tone;
    bassHolds[bar * MAX_STEPS_PER_BAR] = THREE_FOUR_STEPS;
  });

  return mixdownLoop({
    chords: [
      { id: 'a', root: 'C', quality: 'maj', bars: 1 },
      { id: 'b', root: 'F', quality: 'maj', bars: 1 },
      { id: 'c', root: 'G', quality: 'maj', bars: 1 },
      { id: 'd', root: 'A', quality: 'min', bars: 1 },
    ],
    chordRhythmMode: 'custom',
    customChordRhythm: chordRow,
    customChordHoldSteps: chordHolds,
    customChordLoopLength: 2,
    bassPatternMode: 'custom',
    customBassPattern: bassRow,
    customBassHoldSteps: bassHolds,
    customBassLoopLength: 4,
  });
}

describe('offline rendering consumes the resolved cycles', () => {
  test('each lane plays its own cycle in the ACTIVE meter, not the stored row width', () => {
    const voices = buildLoopVoices(asymmetricCycleLoop(), '3/4', 120, THREE_FOUR_STEPS);

    // Two bars of a twelve-column bar, and four — the lanes' independent
    // cycles, measured in the meter they are played in.
    expect(voices.chordCycleSteps).toBe(2 * THREE_FOUR_STEPS);
    expect(voices.bassCycleSteps).toBe(4 * THREE_FOUR_STEPS);

    // The onsets sit on CYCLE COLUMNS one active bar apart, not on their
    // stored slots (which are one widest bar apart).
    expect([...new Set(voices.chordEvents[0].map((event) => event.step))]).toEqual([0, 12]);
    const bassColumns = [
      ...new Set(voices.bassEvents.flat().map((event) => event.step)),
    ].sort((a, b) => a - b);
    expect(bassColumns).toEqual([0, 12, 24, 36]);

    // The hold is one 3/4 bar of time — the same twelve columns the row was
    // drawn with — not one widest-meter bar, which happens to be the same
    // number of STEPS here and so is only distinguishable through the cycle.
    const barSec = THREE_FOUR_STEPS * stepDurationSec(120);
    expect(voices.chordEvents[0][0].hold).toBeCloseTo(barSec, 6);

    // The contrast that proves the numbers above came from the ACTIVE bar
    // length and not from a stored width read as if it were one: in 12/8 a bar
    // IS `MAX_STEPS_PER_BAR`, so a column and its stored slot coincide and the
    // very same rows report cycles twice as wide. That degeneracy is why the
    // bug is invisible in the widest meter and only shows up elsewhere.
    const widest = buildLoopVoices(asymmetricCycleLoop(), '12/8', 120, MAX_STEPS_PER_BAR);
    expect(widest.chordCycleSteps).toBe(2 * MAX_STEPS_PER_BAR);
    expect(widest.bassCycleSteps).toBe(4 * MAX_STEPS_PER_BAR);
  });

  test('a custom two-bar cycle reaches its second bar', () => {
    const voices = buildLoopVoices(customCycleLoop(), '4/4', 120, 16);
    expect(voices.chordCycleSteps).toBe(32);
    expect(voices.bassCycleSteps).toBe(32);
    // Column 20 is bar two of the cycle; a one-bar resolution drops it.
    expect(voices.chordEvents[0].map((e) => e.step)).toContain(20);
  });

  test('render and live produce identical Chord/Bass events at every step', () => {
    const loop = customCycleLoop();
    const voices = buildLoopVoices(loop, '4/4', 120, 16);
    const chordCycle = resolvePlaybackRhythmCycle(
      loop.chordRhythmMode, loop.chordRhythmId, loop.customChordRhythm,
      loop.customChordHoldSteps, loop.customChordLoopLength, 16, '4/4', CHORD_DURATIONS,
    );
    const bassCycle = resolvePlaybackBassCycle(
      loop.bassPatternMode, loop.bassPatternId, loop.customBassPattern,
      loop.customBassHoldSteps, loop.customBassLoopLength, 16, '4/4', CHORD_DURATIONS,
    );
    const chordScale = cycleHoldScale(chordCycle.custom, loop.chordFeel);
    const bassScale = cycleHoldScale(bassCycle.custom, loop.bassFeel);

    // Live arms ONE plan per chord off the run origin, then folds that step
    // onto each lane's own cycle — this mirrors emitChordPlanStep's call.
    const liveChord = (step: number) => {
      const i = chordIndexAt(step);
      const notes = generateBlockChordNotes(loop.chords[i].quality, loop.chords[i].root, loop.chordOctave);
      return eventsForCycleStep(
        buildChordEvents(chordCycle.pattern, notes, STEP_DUR, chordScale),
        step, chordCycle.cycleSteps, true,
      );
    };
    const liveBass = (step: number) => {
      const i = chordIndexAt(step);
      const events = resolveBassSteps(
        bassCycle.pattern, loop.chords, i, loop.bassOctave, loop.scaleRoot, loop.scaleType, 120, bassScale,
      ).map((ev) => ({
        step: ev.step, noteName: ev.noteName, velocity: ev.velocity,
        timeOffset: 0, hold: ev.holdSec, lastBarOnly: isApproachToken(ev.token),
      }));
      return eventsForCycleStep(events, step, bassCycle.cycleSteps, true);
    };

    for (const step of [0, 15, 16, 20, 31, 32, 47]) {
      const i = chordIndexAt(step);
      expect(renderChordEventsAt(voices, i, step, true), `chord ${step}`).toEqual(liveChord(step));
      expect(renderBassEventsAt(voices, i, step, true), `bass ${step}`).toEqual(liveBass(step));
    }
  });
});

describe('renderMixdown: progress and cancellation', () => {
  test('reports real render-timeline progress before encoding the WAV', async () => {
    const updates: MixdownRenderProgress[] = [];

    const result = await renderMixdown(mixdownSnapshot(), (progress) => {
      updates.push(progress);
    });

    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    expect(updates[0]).toEqual({ phase: 'preparing' });
    expect(updates.at(-1)).toEqual({ phase: 'encoding' });
    const renderPercents = updates
      .filter((update) => update.phase === 'rendering')
      .map((update) => update.percent);
    expect(renderPercents.length).toBeGreaterThan(1);
    expect(renderPercents).toEqual([...renderPercents].sort((a, b) => a - b));
    expect(renderPercents[0]).toBe(1);
    expect(renderPercents.at(-1)).toBe(100);
    expect(
      Math.max(
        ...renderPercents.slice(1).map((percent, index) => percent - renderPercents[index]),
      ),
    ).toBeLessThanOrEqual(2);
  });

  test('a cancellation after rendering suppresses WAV encoding', async () => {
    const controller = new AbortController();

    const result = await renderMixdown(
      mixdownSnapshot(),
      (progress) => {
        if (progress.phase === 'rendering' && progress.percent === 100) {
          controller.abort();
        }
      },
      controller.signal,
    );

    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });

});

describe('renderMixdown: the rendered buffer', () => {
  test('applies each loop\'s mixer instead of keeping the active loop\'s mutes for the whole song', async () => {
    const quietEffects = {
      ...FACTORY_EFFECTS,
      reverbWet: 0,
      delayWet: 0,
      distortionWet: 0,
      limiterEnabled: false,
    };
    const loopMix = (chordMuted: boolean) =>
      mixdownSnapshot().buses.map((bus) => ({
        ...bus,
        muted: bus.source !== 'chord' || chordMuted,
      }));
    const first = mixdownLoop({
      id: 'muted-chord',
      chords: [],
      beatPattern: silentBeatPattern(),
      buses: loopMix(true),
    });
    const second = mixdownLoop({
      id: 'audible-chord',
      beatPattern: silentBeatPattern(),
      buses: loopMix(false),
    });
    const snapshot = mixdownSnapshot({
      effects: quietEffects,
      // This is the active loop's mixer in the broken implementation. It
      // must not keep the second loop's chord muted after the boundary.
      buses: mixdownSnapshot().buses.map((bus) => ({ ...bus, muted: true })),
      loops: [first, second],
    });

    const result = await renderMixdown(snapshot);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);

    const left = result.buffer.getChannelData(0);
    const energy = (fromSec: number, toSec: number): number => {
      let sum = 0;
      for (
        let i = Math.floor(fromSec * MIXDOWN_SAMPLE_RATE);
        i < Math.floor(toSec * MIXDOWN_SAMPLE_RATE);
        i += 1
      ) {
        sum += left[i] ** 2;
      }
      return sum;
    };

    // Each one-bar loop lasts 2 s at 120 bpm. Ignore 100 ms at each edge so
    // the assertion measures the loop body, not a click-free bus ramp.
    expect(energy(2.1, 3.9)).toBeGreaterThan(1);
  });

  test('renders a non-silent stereo buffer of the exact expected length', async () => {
    const snapshot = mixdownSnapshot();
    const result = await renderMixdown(snapshot);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);

    // 16 steps at 120 bpm = 16 * (60/120/4) = 2.0 s, plus the tail.
    // reverbDecay is 1.5, so the tail is max(2, 2.5) = 2.5 s.
    expect(result.buffer.numberOfChannels).toBe(2);
    expect(result.buffer.length).toBe(Math.round(4.5 * MIXDOWN_SAMPLE_RATE));
    expect(result.buffer.sampleRate).toBe(MIXDOWN_SAMPLE_RATE);

    const left = result.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < left.length; i += 1) peak = Math.max(peak, Math.abs(left[i]));
    expect(peak).toBeGreaterThan(0);
  });

  test('the blob is a WAV of the same length', async () => {
    const result = await renderMixdown(mixdownSnapshot());
    if (!result.ok) throw new Error('expected ok');
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBe(44 + Math.round(4.5 * MIXDOWN_SAMPLE_RATE) * 2 * 2);
  });

  test('an empty arrangement fails rather than writing a silent file', async () => {
    const result = await renderMixdown(mixdownSnapshot({ loops: [] }));
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('a missing offline context fails with unsupported-context', async () => {
    // The capability probe reads globalThis.OfflineAudioContext; remove it so
    // the probe reports the degraded state instead of a `new` throwing.
    const g = globalThis as { OfflineAudioContext?: unknown };
    const saved = g.OfflineAudioContext;
    delete g.OfflineAudioContext;
    try {
      const result = await renderMixdown(mixdownSnapshot());
      expect(result).toEqual({ ok: false, reason: { kind: 'unsupported-context' } });
    } finally {
      g.OfflineAudioContext = saved;
    }
  });

});

describe('renderMixdown: determinism', () => {
  test('two renders of one snapshot are byte-identical', async () => {
    const snapshot = mixdownSnapshot();
    const a = await renderMixdown(snapshot);
    const b = await renderMixdown(snapshot);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(Array.from(new Uint8Array(await a.blob.arrayBuffer()))).toEqual(
      Array.from(new Uint8Array(await b.blob.arrayBuffer())),
    );
  });

  test('two renders at the store-default reverb decay are byte-identical', async () => {
    // reverbDecay 2.0 is the store's factory default AND the impulse
    // setupMasterChain pre-builds, so setReverbDecay(2.0) early-returns and the
    // pre-built impulse is what reaches the graph. A render whose seeding
    // started only after createRenderEngine would leave that impulse unseeded,
    // and two renders would differ (the reviewer measured 579k differing bytes).
    const snapshot = mixdownSnapshot({ effects: { ...FACTORY_EFFECTS, reverbDecay: 2.0 } });
    const a = await renderMixdown(snapshot);
    const b = await renderMixdown(snapshot);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(Array.from(new Uint8Array(await a.blob.arrayBuffer()))).toEqual(
      Array.from(new Uint8Array(await b.blob.arrayBuffer())),
    );
  });

  test('restores the random source on the way out', async () => {
    // A render installs a seeded stream for its scheduling walk and must clear
    // it in a finally. A leaked source would leave every later random() call in
    // the process replaying MIXDOWN_SEED. Patch Math.random to a sentinel — the
    // repo idiom (see rng.test.ts) — so "restored" is an exact value, not a
    // statistical claim: setRandomSource(null) reads Math.random at call time.
    const original = Math.random;
    Math.random = () => 0.4242424242424242;
    try {
      await renderMixdown(mixdownSnapshot());
      expect(random()).toBe(0.4242424242424242);
    } finally {
      Math.random = original;
    }
  });

});

/**
 * The engine-discriminated cutover, asked of the RENDER rather than of the
 * snapshot shape. Every assertion below changes exactly one field of one
 * `EnginePatch` — `common.outputGainDb`, which is inside the patch and
 * therefore could not exist before the cutover — and reads the result off the
 * samples. A renderer that had kept scheduling a shared flat patch, or that
 * had wired two sources to one column, passes every type check and fails here.
 */
describe('renderMixdown: every melodic source plays its own patch', () => {
  /** No wet sends and no limiter: the comparisons below are about level, and
   *  both would compress the difference they are measuring. */
  const DRY_EFFECTS = {
    ...FACTORY_EFFECTS,
    reverbWet: 0,
    delayWet: 0,
    distortionWet: 0,
    limiterEnabled: false,
  };

  /** The five melodic patch columns, spelled as the store spells them — the
   *  Lead row's irregular name (`synthParams`) included, which is the whole
   *  reason `MELODY_TRACKS` exists and this fixture cannot derive them. */
  const PATCH_FIELDS = [
    'synthParams',
    'chordSynthParams',
    'bassSynthParams',
    'padSynthParams',
    'fxSynthParams',
  ] as const;

  /** A loop where all five melodic sources actually sound. */
  function fiveSourceLoop(over: Partial<MixdownLoop> = {}): MixdownLoop {
    return mixdownLoop({
      // Drums would add energy no patch change can move, diluting every ratio.
      beatPattern: silentBeatPattern(),
      leadMelodySteps: mixdownMelodyBar('C4'),
      fxMelodySteps: mixdownMelodyBar('G4'),
      ...over,
    });
  }

  function silencedOn(field: (typeof PATCH_FIELDS)[number]): MixdownLoop {
    const loop = fiveSourceLoop();
    const patch = loop[field];
    return {
      ...loop,
      [field]: {
        ...patch,
        patch: {
          ...patch.patch,
          common: { ...patch.patch.common, outputGainDb: SILENT_GAIN_DB },
        },
      },
    };
  }

  /** Far below anything audible, so the source's contribution is gone rather
   *  than merely quieter — a renderer that ignored the field entirely is what
   *  this has to separate from one that applied it. */
  const SILENT_GAIN_DB = -80;

  async function energyOf(loop: MixdownLoop): Promise<number> {
    const result = await renderMixdown(mixdownSnapshot({ effects: DRY_EFFECTS, loops: [loop] }));
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    const left = result.buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < left.length; i += 1) sum += left[i] ** 2;
    return sum;
  }

  for (const field of PATCH_FIELDS) {
    test(`silencing ${field}'s own patch quietens the render`, async () => {
      const full = await energyOf(fiveSourceLoop());
      const muted = await energyOf(silencedOn(field));
      // Strictly less, by a margin no rounding reaches: each source is one of
      // five, so removing one has to move the total by far more than epsilon.
      expect(muted).toBeLessThan(full * 0.99);
    });
  }
});

describe('renderMixdown: Arp reads each track`s own settings', () => {
  const DRY_EFFECTS = {
    ...FACTORY_EFFECTS,
    reverbWet: 0,
    delayWet: 0,
    distortionWet: 0,
    limiterEnabled: false,
  };
  const ARP_ON = { active: true, mode: 'up' as const, rate: '16n' as const, octaves: 1 };

  async function samplesOf(over: Partial<MixdownLoop>): Promise<Float32Array> {
    const loop = mixdownLoop({ beatPattern: silentBeatPattern(), ...over });
    const result = await renderMixdown(mixdownSnapshot({ effects: DRY_EFFECTS, loops: [loop] }));
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    return result.buffer.getChannelData(0);
  }

  const same = (a: Float32Array, b: Float32Array): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };

  test('the chord arp and the bass arp are two settings, not one', async () => {
    // Arp used to be four fields INSIDE the flat synth params, so a track's
    // arp travelled with its patch and there was one shape to get wrong. It
    // is a separate per-track record now, and these three renders are what
    // says so: each is deterministic (MIXDOWN_SEED), so identical bytes mean
    // the renderer read the same setting twice rather than each track's own.
    const neither = await samplesOf({});
    const chordOnly = await samplesOf({ chordArpSettings: ARP_ON });
    const bassOnly = await samplesOf({ bassArpSettings: ARP_ON });

    expect(same(chordOnly, neither)).toBe(false);
    expect(same(bassOnly, neither)).toBe(false);
    expect(same(chordOnly, bassOnly)).toBe(false);
  });
});

describe('renderMixdown: the session engine is not involved', () => {
  test('a render neither binds nor plays a note on the singleton', async () => {
    const noteOn = spyOn(audioEngine, 'triggerSynthNoteOn');
    const drum = spyOn(audioEngine, 'triggerDrum');
    try {
      // The singleton has no context until the first user click, and a render
      // must not be what creates one: `createRenderEngine` builds its own.
      expect(audioEngine.getAudioContext()).toBeNull();

      const result = await renderMixdown(mixdownSnapshot());
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);

      expect(noteOn).not.toHaveBeenCalled();
      expect(drum).not.toHaveBeenCalled();
      expect(audioEngine.getAudioContext()).toBeNull();
      expect(audioEngine.liveVoiceCount()).toBe(0);
    } finally {
      noteOn.mockRestore();
      drum.mockRestore();
    }
  });
});

describe('renderMixdown: every loop plays its OWN Beat patch', () => {
  /**
   * The defect this replaces: the snapshot carried ONE kit and one trim for
   * the whole arrangement, installed once in `applyMasterState`, so a song
   * whose second loop used a different Beat exported the first loop's sound
   * over both. The assertion is deliberately about ORDER — a patch installed
   * after a hit has already been scheduled is inaudible on that hit, so
   * "the engine saw both patches" is not enough.
   */
  test('each loop`s Beat Params reach the engine before that loop`s first hit', async () => {
    const beat = (kickDecay: number, kickFreqStart: number, outputTrimDb: number) => {
      const base = beatParamsFixture();
      return {
        ...base,
        outputTrimDb,
        voices: {
          ...base.voices,
          kick: { ...base.voices.kick, decay: kickDecay, freqStart: kickFreqStart },
        },
      };
    };
    const first = beat(0.12, 120, -4.5);
    const second = beat(0.6, 60, 3.5);

    const snapshot = mixdownSnapshot({
      loops: [
        mixdownLoop({ id: 'loop-first', beatParams: first }),
        mixdownLoop({ id: 'loop-second', beatParams: second }),
      ],
    });

    type Entry =
      | { kind: 'kit'; decay: number; freqStart: number; trim: number }
      | { kind: 'hit'; voice: string; time: number };
    const log: Entry[] = [];

    const realSetDrumKit = AudioEngine.prototype.setDrumKit;
    const realTriggerDrum = AudioEngine.prototype.triggerDrum;
    const kitSpy = spyOn(AudioEngine.prototype, 'setDrumKit').mockImplementation(
      function (this: AudioEngine, voices: BeatVoices, outputTrimDb: number) {
        log.push({ kind: 'kit', decay: voices.kick.decay, freqStart: voices.kick.freqStart, trim: outputTrimDb });
        realSetDrumKit.call(this, voices, outputTrimDb);
      },
    );
    const drumSpy = spyOn(AudioEngine.prototype, 'triggerDrum').mockImplementation(
      function (this: AudioEngine, type: string, velocity?: number, time?: number) {
        log.push({ kind: 'hit', voice: type, time: time ?? 0 });
        realTriggerDrum.call(this, type, velocity, time);
      },
    );

    try {
      const result = await renderMixdown(snapshot);
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);

      const hits = log.filter((e): e is Extract<Entry, { kind: 'hit' }> => e.kind === 'hit');
      expect(hits.length).toBeGreaterThan(2);

      // One bar of 4/4 at 120 bpm: the second loop starts at 2 s.
      const secondLoopStart = 16 * stepDurationSec(120);
      const firstIndex = log.findIndex((e) => e.kind === 'hit');
      const secondIndex = log.findIndex((e) => e.kind === 'hit' && e.time >= secondLoopStart - 1e-9);
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);

      const kitBefore = (index: number) => {
        for (let i = index - 1; i >= 0; i -= 1) {
          const entry = log[i];
          if (entry.kind === 'kit') return entry;
        }
        return undefined;
      };

      expect(kitBefore(firstIndex)).toEqual({
        kind: 'kit', decay: 0.12, freqStart: 120, trim: -4.5,
      });
      expect(kitBefore(secondIndex)).toEqual({
        kind: 'kit', decay: 0.6, freqStart: 60, trim: 3.5,
      });
    } finally {
      kitSpy.mockRestore();
      drumSpy.mockRestore();
    }
  });

  /** The per-voice mute layer travels with the loop, and a muted voice
   *  schedules nothing at all — the same decision `beatStepEvents` takes live. */
  test('a voice muted in a loop`s Beat Mix is never scheduled for that loop', async () => {
    const muted = beatMixFixture();
    muted.voices.kick = { levelDb: 0, muted: true };

    const snapshot = mixdownSnapshot({
      loops: [mixdownLoop({ id: 'loop-muted', beatMix: muted })],
    });

    const realTriggerDrum = AudioEngine.prototype.triggerDrum;
    const voices: string[] = [];
    const drumSpy = spyOn(AudioEngine.prototype, 'triggerDrum').mockImplementation(
      function (this: AudioEngine, type: string, velocity?: number, time?: number) {
        voices.push(type);
        realTriggerDrum.call(this, type, velocity, time);
      },
    );
    try {
      const result = await renderMixdown(snapshot);
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
      expect(voices).not.toContain('kick');
    } finally {
      drumSpy.mockRestore();
    }
  });
});

describe('live and offline build the same pad snapshot', () => {
  const chords = [
    { id: 'c1', root: 'C', quality: 'maj' as const, bars: 2 },
    { id: 'c2', root: 'A', quality: 'min' as const, bars: 2 },
  ];
  const loop = mixdownLoop({
    chords,
    padMode: 'drone',
    padOctave: 4,
    padVoicing: 'triad',
    padDroneDegree: 1,
    padDroneIntervals: [1, 5, 8],
    scaleRoot: 'C',
    scaleType: 'major',
  });
  const state = {
    padMode: loop.padMode,
    chords: loop.chords,
    padDroneDegree: loop.padDroneDegree,
    padDroneIntervals: loop.padDroneIntervals,
    padOctave: loop.padOctave,
    padVoicing: loop.padVoicing,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    bpm: 120,
    meterId: '4/4',
  } as unknown as AppStore;

  test('the offline snapshot deep-equals the store snapshot', () => {
    expect(padSnapshotForLoop(loop, 120, 16)).toEqual(padPlanSnapshot(state));
  });

  test('and therefore both plan the same arm at every chord', () => {
    for (const chordIndex of [0, 1, 2]) {
      expect(planPadArm(padSnapshotForLoop(loop, 120, 16), { chordIndex })).toEqual(
        planPadArm(padPlanSnapshot(state), { chordIndex }),
      );
    }
  });
});
