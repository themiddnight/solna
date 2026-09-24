import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { mulberry32 } from '../audio/rng';
import { VIBES } from '../data/vibes';
import { DEFAULT_METER_ID } from '../utils/timeSignature';
import { INITIAL_EFFECTS } from './initialState';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { SCOPE_NONE } from './playbackScope';
import * as store from './store';
import { releasePersistedWrites, useAppStore } from './store';
import { DEFAULT_BPM, isAnyPlayerActive } from './transportSlice';
import type { AppStore } from './types';
import {
  beginVibePreview, cancelVibePreview, commitVibePreview, playPreview, previewVibe, rerollPreview, stopPreview,
} from './vibePreview';
import { captureVibeTargets, resolveVibe, resolveVibeVoices, vibeContentPatch, withMirror } from './vibes';
import { createDraw, formatVariationSummary, resolveVibeVariation, summarizeVibe } from './vibeVariation';

const resetStore = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop], activeLoopId: loop.id, ...loopStatePatch(loop),
    sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped', fxPlayer: 'stopped',
    songLoopIndex: null, activeTab: 'sound', playbackScope: SCOPE_NONE, selectedVibeId: null,
    bpm: DEFAULT_BPM, meterId: DEFAULT_METER_ID, effects: { ...INITIAL_EFFECTS }, noteInputSuspended: false,
  });
};

const s = () => useAppStore.getState();
const stopped = () => !isAnyPlayerActive(s()) && s().playbackScope.kind === 'none';

beforeEach(resetStore);
afterEach(() => {
  s().hardStopAll();
  releasePersistedWrites(); // a failed test must not leave the hold on for the next file
  resetStore();
});

describe('vibe preview commands (R337)', () => {
  test('open stops the transport, suspends input and snapshots the targets', () => {
    s().playAll();
    const snap = beginVibePreview();
    expect(stopped()).toBe(true);
    expect(s().noteInputSuspended).toBe(true);
    expect(snap.chords).toBe(s().chords);
    cancelVibePreview(snap);
    expect(s().noteInputSuspended).toBe(false);
  });

  test('a preview plays the active loop under the loop scope, never the song', () => {
    const snap = beginVibePreview();
    previewVibe(VIBES[0]);
    expect(s().playbackScope).toEqual({ kind: 'loop', loopId: s().activeLoopId });
    expect(isAnyPlayerActive(s())).toBe(true);
    expect(s().selectedVibeId).toBe(VIBES[0].id);
    cancelVibePreview(snap);
    expect(stopped()).toBe(true);
  });

  test('Stop stops; Play after a reroll plays what is in the store without re-applying', () => {
    const snap = beginVibePreview();
    previewVibe(VIBES[1]);
    const { spec } = rerollPreview(VIBES[1]);
    expect(spec.id).toBe(VIBES[1].id);
    const { chords, bpm } = s();
    stopPreview();
    expect(stopped()).toBe(true);
    playPreview();
    playPreview(); // idempotent: soloLoop alone would toggle it off
    expect(s().chords).toBe(chords);
    expect(s().bpm).toBe(bpm);
    expect(s().playbackScope.kind).toBe('loop');
    cancelVibePreview(snap);
  });

  test('Cancel after every vibe and a reroll restores the pre-open state, with two loops', () => {
    const first = createDefaultLoop();
    const second = { ...createDefaultLoop(), name: 'Mine' };
    useAppStore.setState({ loops: [first, second], activeLoopId: second.id, ...loopStatePatch(second) });
    const before = s();
    const snap = beginVibePreview();
    for (const vibe of VIBES) previewVibe(vibe);
    rerollPreview(VIBES[0]);
    cancelVibePreview(snap);
    const after = s();
    for (const key of Object.keys(captureVibeTargets(before)) as (keyof AppStore)[]) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.activeLoopId).toBe(second.id);
    expect(stopped()).toBe(true);
    expect(after.noteInputSuspended).toBe(false);
  });

  test('Use keeps the last preview, stamps the loop and leaves the transport stopped', () => {
    beginVibePreview();
    previewVibe(VIBES[2]);
    const { chords } = s();
    commitVibePreview();
    expect(s().chords).toBe(chords);
    expect(s().selectedVibeId).toBe(VIBES[2].id);
    expect(s().loops.find((l) => l.id === s().activeLoopId)?.tempName).toBe(VIBES[2].name);
    expect(stopped()).toBe(true);
    expect(s().noteInputSuspended).toBe(false);
  });

  test('open, cancel, open, cancel (StrictMode) ends unsuspended and unchanged', () => {
    const before = s().chords;
    cancelVibePreview(beginVibePreview());
    const snap = beginVibePreview();
    previewVibe(VIBES[3]);
    cancelVibePreview(snap);
    expect(s().chords).toEqual(before);
    expect(s().noteInputSuspended).toBe(false);
  });
});

describe('what the picker shows under the name', () => {
  test('a pick returns the authored vibe\'s detail line, the same shape a reroll gives', () => {
    const vibe = VIBES[0];
    const summary = summarizeVibe(vibe);
    const detail = previewVibe(vibe);
    expect(detail).toBe(formatVariationSummary(summary).detail);
    expect(detail).toContain(summary.progressionRoman);
    expect(detail).toContain(`drums: ${summary.drumGridName}`);
    expect(rerollPreview(vibe).detail.split(' · ')).toHaveLength(detail.split(' · ').length);
  });
});

describe('an open that throws undoes itself', () => {
  test('writes are released and input is back on before the error propagates', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {
      throw new Error('engine gone');
    });
    const release = spyOn(store, 'releasePersistedWrites');
    try {
      expect(() => beginVibePreview()).toThrow('engine gone');
      expect(release).toHaveBeenCalledTimes(1);
      expect(s().noteInputSuspended).toBe(false);
    } finally {
      stopSource.mockRestore();
      release.mockRestore();
    }
  });
});

describe('a new pick cuts the old voices before its content lands', () => {
  test('silences chord, bass and pad at the hard-stop release', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
    stopSource.mockClear();
    previewVibe(VIBES[1]);
    const silenced = stopSource.mock.calls.map((c) => c[0]);
    expect(silenced).toEqual(expect.arrayContaining(['chord', 'bass', 'pad']));
    for (const call of stopSource.mock.calls) expect(call[1]).toBe(0.02);
    stopSource.mockRestore();
  });

  test('every cut sees the OLD progression', () => {
    previewVibe(VIBES[0]);
    const oldIds = s().chords.map((c) => c.id);
    const idsAtCut: string[][] = [];
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {
      idsAtCut.push(s().chords.map((c) => c.id));
    });
    previewVibe(VIBES[1]);
    expect(idsAtCut.length).toBeGreaterThan(0);
    for (const ids of idsAtCut) expect(ids).toEqual(oldIds);
    stopSource.mockRestore();
  });
});

describe('the snapshot covers every key a vibe writes (R338)', () => {
  test('for every vibe and a seeded sample of rerolls', () => {
    const draw = createDraw(mulberry32(0x5eed));
    for (const base of VIBES) {
      const current = s();
      const specs = [base, ...Array.from({ length: 4 }, () => resolveVibeVariation(
        base,
        { scaleRoot: current.scaleRoot, chordRhythmId: current.chordRhythmId, bassPatternId: current.bassPatternId },
        draw,
      ).spec)];
      for (const spec of specs) {
        const vibe = resolveVibe(spec);
        const written = Object.keys(withMirror(current, vibeContentPatch(current, vibe, resolveVibeVoices(vibe))));
        const captured = new Set(Object.keys(captureVibeTargets(current)));
        expect(written.filter((key) => !captured.has(key))).toEqual([]);
      }
    }
  });
});
