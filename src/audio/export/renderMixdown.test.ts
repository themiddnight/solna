import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  buildLoopVoices,
  MIXDOWN_SAMPLE_RATE,
  planArrangement,
  planLoopAudioAutomation,
  renderMixdown,
  type MixdownRenderProgress,
} from './renderMixdown';
import { mixdownLoop, mixdownSnapshot, FACTORY_EFFECTS } from './mixdownFixture';
import { random } from '../rng';

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
          mixdownLoop({ id: 'b', chords: [{ id: 'c2', root: 'F', quality: 'maj', bars: 2, notes: ['F4', 'A4', 'C5'] }] }),
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

  test('positions every loop\'s drum filter on its arrangement boundary', () => {
    const snapshot = mixdownSnapshot({
      loops: [
        mixdownLoop({
          drumFilter: { cutoff: 500, resonance: 2, type: 'lowpass' },
        }),
        mixdownLoop({
          drumFilter: { cutoff: 12000, resonance: 1, type: 'lowpass' },
        }),
      ],
    });

    expect(
      planLoopAudioAutomation(snapshot, planArrangement(snapshot)).map((entry) => ({
        loopIndex: entry.loopIndex,
        time: entry.time,
        drumFilter: entry.drumFilter,
      })),
    ).toEqual([
      {
        loopIndex: 0,
        time: 0,
        drumFilter: { cutoff: 500, resonance: 2, type: 'lowpass' },
      },
      {
        loopIndex: 1,
        time: 2,
        drumFilter: { cutoff: 12000, resonance: 1, type: 'lowpass' },
      },
    ]);
  });
});

describe('buildLoopVoices', () => {
  test('maps every bar of a pass to the chord that covers it', () => {
    const loop = mixdownLoop({
      chords: [
        { id: 'a', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] },
        { id: 'b', root: 'F', quality: 'maj', bars: 3, notes: ['F4'] },
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

describe('renderMixdown', () => {
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
      sequencerTracks: [],
      buses: loopMix(true),
    });
    const second = mixdownLoop({
      id: 'audible-chord',
      sequencerTracks: [],
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
