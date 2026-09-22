import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import { BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import { createDefaultLoop, createLoopSlice } from './loopSlice';
import { SCOPE_NONE } from './playbackScope';
import { useAppStore } from './store';
import type { AppStore } from './types';
import type { Loop } from './types';
import type { BassStepChoice } from '@/data/bassPatterns';

// The cross-boundary fixture, spelled out here as it is at each boundary it
// crosses: a TWO-bar Chord lane over a FOUR-bar Bass lane in 3/4, with an
// explicit hold on every onset. The hold is `THREE_FOUR` on purpose — 12 is a
// legal span in BOTH coordinate spaces (the stored slot at the widest meter
// and the column in 3/4), so neither read is forced to rewrite it and the
// fixture keeps asserting what it claims to.
const THREE_FOUR = 12; // `METERS['3/4'].stepsPerBar`

function customPatternLoop(): Loop {
  const chord = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
  chord[0] = true;
  chord[MAX_STEPS_PER_BAR] = true;
  const chordHolds = new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1);
  chordHolds[0] = THREE_FOUR;
  chordHolds[MAX_STEPS_PER_BAR] = THREE_FOUR;

  const bass = new Array<BassStepChoice>(4 * MAX_STEPS_PER_BAR).fill('rest');
  const bassHolds = new Array<number>(4 * MAX_STEPS_PER_BAR).fill(1);
  const tones: BassStepChoice[] = ['root', 'third', 'fifth', 'seventh'];
  tones.forEach((tone, bar) => {
    bass[bar * MAX_STEPS_PER_BAR] = tone;
    bassHolds[bar * MAX_STEPS_PER_BAR] = THREE_FOUR;
  });

  return {
    ...createDefaultLoop(),
    id: 'loop-custom',
    customChordRhythm: chord,
    customChordHoldSteps: chordHolds,
    customChordLoopLength: 2,
    customBassPattern: bass,
    customBassHoldSteps: bassHolds,
    customBassLoopLength: 4,
  };
}

function makeSlice(initial?: Partial<AppStore>) {
  let state = {} as AppStore;
  const set = ((partial: unknown) => {
    const patch =
      typeof partial === 'function' ? (partial as (s: AppStore) => object)(state) : partial;
    state = { ...state, ...(patch as object) } as AppStore;
  }) as StoreApi<AppStore>['setState'];
  const get = (() => state) as StoreApi<AppStore>['getState'];
  state = {
    ...createLoopSlice(set, get),
    // Match the real store's transport default so the song-cursor guard in
    // deleteLoop/reorderLoops behaves identically (null = loop mode).
    songLoopIndex: null,
    // addLoop/duplicateLoop now read playbackScope (rescopeToLoop); the real
    // store's transport slice seeds it to SCOPE_NONE, so this harness must
    // too or those actions dereference undefined.
    playbackScope: SCOPE_NONE,
    ...initial,
  } as AppStore;
  return {
    get state() {
      return state;
    },
    /** A bare write, standing in for the real store's `setState`. */
    patch(p: Partial<AppStore>) {
      set(p);
    },
  };
}

describe('loopSlice: defaults, add and duplicate', () => {
  test('starts with one default loop whose name is empty and whose tempName is untitled-1', () => {
    const s = makeSlice().state;
    expect(s.loops).toHaveLength(1);
    // The user's field starts EMPTY, so nothing in state can be mistaken for
    // a name the user chose; the app's field is what renders.
    expect(s.loops[0].name).toBe('');
    expect(s.loops[0].tempName).toBe('untitled-1');
    expect(s.activeLoopId).toBe(s.loops[0].id);
  });

  test('default loop reproduces the flat slices fixed-width custom pattern grids', () => {
    const loop = makeSlice().state.loops[0];
    expect(loop.customChordRhythm).toHaveLength(MAX_STEPS_PER_BAR);
    expect(loop.customChordRhythm).toEqual(
      new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    );
    expect(loop.customBassPattern).toHaveLength(MAX_STEPS_PER_BAR);
    expect(loop.customBassPattern).toEqual(
      new Array<'rest'>(MAX_STEPS_PER_BAR).fill('rest'),
    );
  });

  test('default loop ships one-bar custom patterns with one-step holds', () => {
    // The factory value of the four keys this feature adds is also what an old
    // saved loop reads back as: sanitizeLoops fills a missing key with the
    // default rather than running a version-gated upgrade, so the two must not
    // drift apart.
    const loop = createDefaultLoop();
    expect(loop.customChordLoopLength).toBe(1);
    expect(loop.customChordHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
    expect(loop.customBassLoopLength).toBe(1);
    expect(loop.customBassHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
  });

  test('addLoop appends a deep copy of the active loop and auto-activates it', () => {
    const h = makeSlice();
    const first = h.state.loops[0];
    const id = h.state.addLoop();
    expect(h.state.loops).toHaveLength(2);
    expect(h.state.activeLoopId).toBe(id);
    const added = h.state.loops[1];
    expect(added.id).toBe(id);
    // Add is a FRESH slot, Duplicate is a derived one, and the labels say
    // which — even though Add clones the active loop's content. Sharing one
    // namer between the two would erase the distinction.
    expect(added.name).toBe('');
    expect(added.tempName).toBe('untitled-2');
    expect(added.scaleRoot).toBe(first.scaleRoot);
    expect(added.synthParams).toEqual(first.synthParams);
    expect(added.synthParams).not.toBe(first.synthParams);
    expect(added.chords).not.toBe(first.chords);
  });

  test('addLoop never inherits the source loop label', () => {
    const h = makeSlice();
    h.state.setLoopName(h.state.loops[0].id, 'Drop');
    h.state.addLoop();
    const added = h.state.loops[1];
    // The regression the shared-namer shortcut would cause: the new slot must
    // not come out called `Drop` or `Drop 2`.
    expect(added.name).toBe('');
    expect(added.tempName).toBe('untitled-2');
  });

  test('duplicateLoop of the active loop inserts a deep clone after it and auto-activates it', () => {
    const h = makeSlice();
    const original = h.state.loops[0];
    const result = h.state.duplicateLoop(original.id);
    expect(result).toBe(null);
    expect(h.state.loops).toHaveLength(2);
    expect(h.state.loops[1].id).toBe(h.state.activeLoopId);
    expect(h.state.loops[1].name).toBe('');
    expect(h.state.loops[1].tempName).toBe('untitled-2');
    expect(h.state.loops[1].scaleRoot).toBe(original.scaleRoot);
    expect(h.state.loops[1].chords).not.toBe(original.chords);
  });

  test('duplicateLoop of a non-active loop returns the clone id for the caller to load', () => {
    const h = makeSlice();
    h.state.addLoop(); // active is now loop 2
    const firstId = h.state.loops[0].id;
    const cloneId = h.state.duplicateLoop(firstId);
    expect(cloneId).not.toBe(null);
    expect(h.state.loops).toHaveLength(3);
    expect(h.state.loops[1].id).toBe(cloneId); // right after the original, not at the end
    expect(h.state.activeLoopId).not.toBe(cloneId);
    expect(h.state.loops[1].name).toBe('');
    expect(h.state.loops[1].tempName).toBe('untitled-3');
  });

  // tempName is renumbered too, off its own stem, never copied verbatim from
  // the source — see nextDuplicateLabel's docblock in loop.ts for why a
  // shared tempName would resurface as a collision once both names are
  // cleared.

  test('duplicateLoop increments a user name and its tempName, independently', () => {
    const h = makeSlice();
    const id = h.state.loops[0].id;
    h.state.setLoopName(id, 'Drop');
    h.state.duplicateLoop(id);
    const clone = h.state.loops[1];
    expect(clone.name).toBe('Drop 2');
    expect(clone.tempName).toBe('untitled-2');
  });
});

// The DUPLICATION boundary of the cross-boundary fixture: the same two-bar
// Chord / four-bar Bass custom loop the serialization, merge and copy tests
// round-trip, taken through `duplicateLoop` → `cloneLoop` → `structuredClone`
// rather than through a copy patch. A duplicate is the one path where the four
// lane fields are carried by the whole-object clone instead of by a key list,
// so nothing else would notice `cloneLoop` ceasing to be a deep clone — or a
// lane's width being flattened into the other lane's.
describe('the Beat instrument on a loop', () => {
  test('default loop ships a complete Beat instrument at the default preset', () => {
    const loop = createDefaultLoop();
    expect(loop.beatParams.basePresetId).toBe(DEFAULT_BEAT_PRESET_ID);
    expect(Object.keys(loop.beatPattern.rows).sort()).toEqual([...BEAT_VOICE_IDS].sort());
    expect(loop.beatPattern.rows.kick).toHaveLength(MAX_STEPS_PER_BAR);
    expect(loop.beatMix.voices.kick).toEqual({ levelDb: 0, muted: false });
  });

  test('an added loop shares no Beat substructure with the loop it was copied from', () => {
    const h = makeSlice();
    const first = h.state.loops[0];
    h.state.addLoop();
    const added = h.state.loops[1];
    expect(added.beatPattern.rows.kick).not.toBe(first.beatPattern.rows.kick);
    expect(added.beatParams.voices.kick).not.toBe(first.beatParams.voices.kick);
    expect(added.beatMix.voices.kick).not.toBe(first.beatMix.voices.kick);
    // Step 1, which the starter groove leaves silent in both loops — so the
    // flip below is visible, and it is the WRITE that this asserts does not
    // travel, not a difference the default pattern already had.
    expect(first.beatPattern.rows.kick[1]).toBe(false);
    added.beatPattern.rows.kick[1] = true;
    expect(first.beatPattern.rows.kick[1]).toBe(false);
  });
});

describe('the custom pattern fixture survives a duplicate', () => {
  function duplicateFixture() {
    const fixture = customPatternLoop();
    const h = makeSlice({ loops: [fixture], activeLoopId: fixture.id });
    // Auto-activates, so the clone lands at index 1 with a fresh id.
    expect(h.state.duplicateLoop(fixture.id)).toBe(null);
    return { fixture, clone: h.state.loops[1] };
  }

  test('each lane keeps its own width, bar-major values and holds', () => {
    const { fixture, clone } = duplicateFixture();
    expect(clone.id).not.toBe(fixture.id);

    // 2 bars of chord against a 4-bar progression, beside 4 bars of bass: the
    // two widths are asserted together so a clone that defaulted both to the
    // factory's one bar could not pass by coincidence.
    expect(clone.customChordLoopLength).toBe(2);
    expect(clone.customBassLoopLength).toBe(4);

    // The STORED slot at MAX_STEPS_PER_BAR, not the 3/4 column the lane plays.
    expect(clone.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(clone.customChordHoldSteps).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(clone.customChordRhythm[0]).toBe(true);
    expect(clone.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    expect(clone.customChordHoldSteps[0]).toBe(THREE_FOUR);
    expect(clone.customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);

    expect(clone.customBassPattern).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(clone.customBassHoldSteps).toHaveLength(4 * MAX_STEPS_PER_BAR);
    ['root', 'third', 'fifth', 'seventh'].forEach((tone, bar) => {
      expect(clone.customBassPattern[bar * MAX_STEPS_PER_BAR]).toBe(tone);
      expect(clone.customBassHoldSteps[bar * MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
    });
  });

  test('the copy is deep, so an edit to the source lane cannot reach it', () => {
    const { fixture, clone } = duplicateFixture();
    // One level down in each lane: a spread-only clone passes a `!==` check on
    // the outer array and still shares every element.
    fixture.customChordRhythm[MAX_STEPS_PER_BAR] = false;
    fixture.customChordHoldSteps[0] = 1;
    fixture.customBassPattern[0] = 'rest';

    expect(clone.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    expect(clone.customChordHoldSteps[0]).toBe(THREE_FOUR);
    expect(clone.customBassPattern[0]).toBe('root');
  });
});

describe('loopSlice: delete and reorder', () => {
  test('deleteLoop of the active loop loads the fallback loop’s fields in the same write', () => {
    const h = makeSlice();
    const first = h.state.loops[0];
    h.state.addLoop(); // loop 2 active
    const second = h.state.loops[1];
    const deleted = h.state.deleteLoop(second.id);
    expect(deleted).toEqual({ loop: second, index: 1, wasActive: true });
    expect(h.state.loops).toHaveLength(1);
    expect(h.state.activeLoopId).toBe(first.id);
    expect(h.state.scaleRoot).toBe(first.scaleRoot);
    expect(h.state.chords).toEqual(first.chords);
    expect(h.state.leadMelodySteps).toEqual(first.leadMelodySteps);
  });

  test('deleteLoop of a non-active loop leaves the active loop alone', () => {
    const h = makeSlice();
    h.state.addLoop();
    const firstId = h.state.loops[0].id;
    const activeId = h.state.activeLoopId;
    const result = h.state.deleteLoop(firstId);
    expect(result?.wasActive).toBe(false);
    expect(result?.loop.id).toBe(firstId);
    expect(result?.index).toBe(0);
    expect(h.state.loops).toHaveLength(1);
    expect(h.state.activeLoopId).toBe(activeId);
  });

  test('the last loop cannot be deleted', () => {
    const h = makeSlice();
    const id = h.state.loops[0].id;
    expect(h.state.deleteLoop(id)).toBe(null);
    expect(h.state.loops).toHaveLength(1);
  });

  test('reorderLoops moves a loop up and down, and no-ops off the edge', () => {
    const h = makeSlice();
    h.state.addLoop();
    h.state.addLoop();
    const ids = h.state.loops.map((r) => r.id);
    h.state.reorderLoops(ids[0], 1);
    expect(h.state.loops.map((r) => r.id)).toEqual([ids[1], ids[0], ids[2]]);
    h.state.reorderLoops(ids[0], -1);
    expect(h.state.loops.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
    h.state.reorderLoops(ids[0], -1); // off the top edge
    expect(h.state.loops.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  test('deleteLoop of a non-active loop re-derives songLoopIndex onto the surviving active loop', () => {
    const h = makeSlice({ songLoopIndex: 1 });
    h.state.addLoop(); // 2 loops, second is active
    const firstId = h.state.loops[0].id;
    const secondId = h.state.loops[1].id;
    expect(h.state.activeLoopId).toBe(secondId);
    expect(h.state.songLoopIndex).toBe(1);

    const result = h.state.deleteLoop(firstId);
    expect(result?.wasActive).toBe(false);
    expect(h.state.loops).toHaveLength(1);
    expect(h.state.activeLoopId).toBe(secondId);
    expect(h.state.songLoopIndex).toBe(0);
  });

  test('deleteLoop of the active loop re-derives songLoopIndex onto the fallback', () => {
    const h = makeSlice({ songLoopIndex: 2 });
    h.state.addLoop();
    h.state.addLoop(); // 3 loops, active = loops[2]
    const ids = h.state.loops.map((r) => r.id);
    expect(h.state.activeLoopId).toBe(ids[2]);
    expect(h.state.songLoopIndex).toBe(2);

    const deleted = h.state.deleteLoop(ids[2]); // delete active (last)
    expect(deleted?.wasActive).toBe(true);
    expect(deleted?.loop.id).toBe(ids[2]);
    expect(h.state.loops).toHaveLength(2);
    expect(h.state.activeLoopId).toBe(ids[1]);
    expect(h.state.songLoopIndex).toBe(1);
  });

  test('reorderLoops keeps songLoopIndex on the active loop after the move', () => {
    const h = makeSlice({ songLoopIndex: 2 });
    h.state.addLoop();
    h.state.addLoop(); // 3 loops, active = loops[2]
    const ids = h.state.loops.map((r) => r.id);
    expect(h.state.activeLoopId).toBe(ids[2]);
    expect(h.state.songLoopIndex).toBe(2);

    h.state.reorderLoops(ids[2], -1); // move the active loop up one slot

    expect(h.state.loops.map((r) => r.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(h.state.activeLoopId).toBe(ids[2]);
    expect(h.state.songLoopIndex).toBe(1);
  });

  test('deleteLoop and reorderLoops leave songLoopIndex null outside song mode', () => {
    const h = makeSlice();
    h.state.addLoop();
    h.state.addLoop();
    const firstId = h.state.loops[0].id;
    expect(h.state.songLoopIndex).toBe(null);

    h.state.deleteLoop(firstId);
    expect(h.state.songLoopIndex).toBe(null);

    h.state.reorderLoops(h.state.loops[0].id, 1);
    expect(h.state.songLoopIndex).toBe(null);
  });

});

describe('loopSlice: restoreLoop undoes a delete', () => {
  test('restoreLoop puts the loop back at its index and does not activate it', () => {
    const h = makeSlice();
    h.state.addLoop();
    h.state.addLoop();
    const ids = h.state.loops.map((l) => l.id);
    const active = h.state.activeLoopId;
    const deleted = h.state.deleteLoop(ids[0])!;
    h.state.restoreLoop(deleted);
    expect(h.state.loops.map((l) => l.id)).toEqual(ids);
    expect(h.state.activeLoopId).toBe(active);
  });

  test('restoreLoop of the loop that was active leaves the fallback active', () => {
    const h = makeSlice();
    h.state.addLoop(); // loop 2 active
    const ids = h.state.loops.map((l) => l.id);
    const deleted = h.state.deleteLoop(ids[1])!;
    h.state.restoreLoop(deleted);
    expect(h.state.loops.map((l) => l.id)).toEqual(ids);
    expect(h.state.activeLoopId).toBe(ids[0]);
  });

  test('restoreLoop is a no-op when the loop is already present', () => {
    const h = makeSlice();
    h.state.addLoop();
    const ids = h.state.loops.map((l) => l.id);
    const deleted = h.state.deleteLoop(ids[0])!;
    h.state.restoreLoop(deleted);
    h.state.restoreLoop(deleted);
    expect(h.state.loops.map((l) => l.id)).toEqual(ids);
  });

  test('restoreLoop clamps an index past the end of a list that shrank', () => {
    const h = makeSlice();
    h.state.addLoop();
    h.state.addLoop();
    const ids = h.state.loops.map((l) => l.id);
    const deleted = h.state.deleteLoop(ids[2])!;
    h.state.deleteLoop(ids[1]);
    h.state.restoreLoop(deleted);
    expect(h.state.loops.map((l) => l.id)).toEqual([ids[0], ids[2]]);
  });

  test('restoreLoop re-derives songLoopIndex onto the active loop', () => {
    const h = makeSlice({ songLoopIndex: 1 });
    h.state.addLoop(); // active = loops[1]
    const ids = h.state.loops.map((l) => l.id);
    const deleted = h.state.deleteLoop(ids[0])!;
    expect(h.state.songLoopIndex).toBe(0);
    h.state.restoreLoop(deleted);
    expect(h.state.songLoopIndex).toBe(1);
  });
});

describe('loopSlice: the flat setters', () => {
  test('setActiveLoop is gone — no bare activeLoopId writer remains', () => {
    expect('setActiveLoop' in makeSlice().state).toBe(false);
  });

  test('setLoopMix on the active loop mirrors onto the flat slices', () => {
    const h = makeSlice();
    const id = h.state.activeLoopId;
    h.state.setLoopMix(id, { synthVolume: 0.25, chordMuted: true });
    expect(h.state.loops[0].synthVolume).toBe(0.25);
    expect(h.state.loops[0].chordMuted).toBe(true);
    // engineSync reads the flat fields, so the mirror keeps the edit audible live.
    expect(h.state.synthVolume).toBe(0.25);
    expect(h.state.chordMuted).toBe(true);
  });

  test('setLoopMix on a non-active loop edits loops only', () => {
    const h = makeSlice();
    h.state.addLoop(); // active is now loop 2
    const firstId = h.state.loops[0].id;
    h.state.setLoopMix(firstId, { bassVolume: 0.1, beatMix: { ...h.state.loops[0].beatMix, muted: true } });
    expect(h.state.loops[0].bassVolume).toBe(0.1);
    expect(h.state.loops[0].beatMix.muted).toBe(true);
    // The non-active edit must not touch the flat slices (the live sound).
    // This harness holds the loop slice alone, so an untouched flat key is
    // ABSENT rather than at its default — which is exactly what makes a
    // mirroring write visible here.
    expect(h.state.bassVolume).toBeUndefined();
    expect(h.state.beatMix).toBeUndefined();
    // ...nor the active loop's copy.
    expect(h.state.loops[1].bassVolume).toBe(-6); // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
    expect(h.state.loops[1].beatMix.muted).toBe(false);
  });

  test('setLoopName updates the name of the specified loop', () => {
    const h = makeSlice();
    const id = h.state.loops[0].id;
    h.state.setLoopName(id, 'Intro Verse');
    expect(h.state.loops[0].name).toBe('Intro Verse');
  });

  test('reorderLoopsArray replaces the loop array and maintains songLoopIndex', () => {
    const h = makeSlice({ songLoopIndex: 0 });
    h.state.addLoop(); // loop 1 (idx 0), loop 2 (idx 1, active)
    const [l1, l2] = h.state.loops;
    h.patch({ activeLoopId: l1.id });
    h.state.reorderLoopsArray([l2, l1]);
    expect(h.state.loops.map((r) => r.id)).toEqual([l2.id, l1.id]);
    expect(h.state.songLoopIndex).toBe(1); // l1 is now at index 1
  });

});

describe('a cursor move carries the scope with it', () => {
  // bun runs every test file in one process without isolation, and these
  // tests are the only ones in this file that touch the shared singleton
  // store — a scope or player state left behind by one test (or by a
  // sibling file) would otherwise bleed into the next. soloLoop in
  // particular is a no-op once the scope already names a DIFFERENT loop
  // (Task 2: "a different card is unreachable"), so a stale scope here
  // would silently make it do nothing rather than establish the baseline a
  // test expects. Restore SCOPE_NONE before AND after each test, matching
  // loadLoop.test.ts's resetStore.
  const resetScope = () => {
    useAppStore.setState({
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      songLoopIndex: null,
      playbackScope: SCOPE_NONE,
    });
  };
  beforeEach(resetScope);
  afterEach(resetScope);

  test('addLoop mid-playback re-points the scope at the new loop', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().soloLoop('loop-default-1');

    const newId = useAppStore.getState().addLoop();

    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe(newId);
    // The clone is content-identical, so the audio is unchanged and must not
    // stop; only the scope's id moves.
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: newId });
  });

  test('duplicateLoop of the ACTIVE loop re-points the scope at the clone', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.getState().duplicateLoop('loop-default-1');

    const s = useAppStore.getState();
    // duplicateLoop returns null when it auto-activates the clone, so read
    // the new active id from the store rather than from the return value.
    expect(s.activeLoopId).not.toBe('loop-default-1');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: s.activeLoopId });
  });

  test('duplicating a NON-active loop moves neither the cursor nor the scope', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.getState().duplicateLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe('loop-default-1');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('adding a loop while the song plays leaves the arrangement in charge', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().playAll();

    useAppStore.getState().addLoop();

    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
  });
});

describe('deleteLoop never leaves the scope naming a loop that is gone', () => {
  // Same reset as 'a cursor move carries the scope with it' above, and for
  // the same reason: this block also calls soloLoop against the shared
  // singleton store, and soloLoop is a no-op once the scope already names a
  // DIFFERENT loop (or already names 'song') — a scope or player state left
  // behind by one test would silently satisfy the next test's assertions
  // without that test's own setup doing any work.
  const resetScope = () => {
    useAppStore.setState({
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      songLoopIndex: null,
      playbackScope: SCOPE_NONE,
    });
  };
  beforeEach(resetScope);
  afterEach(resetScope);

  test('deleting the loop that is playing stops playback and clears the scope', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    const deleted = useAppStore.getState().deleteLoop('loop-default-1');

    const s = useAppStore.getState();
    expect(deleted?.wasActive).toBe(true);
    expect(s.activeLoopId).toBe('loop-b');
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope).toBe(SCOPE_NONE);
    expect(s.loops.some((l) => l.id === 'loop-default-1')).toBe(false);
  });

  test('deleting a loop that is not the scoped one leaves playback alone', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.getState().deleteLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('deleting the active loop notifies subscribers once, already on the fallback', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'D' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      scaleRoot: 'A',
      songLoopIndex: null,
    });
    const seen: Array<{ activeLoopId: string; scaleRoot: string }> = [];
    const off = useAppStore.subscribe((s) => {
      seen.push({ activeLoopId: s.activeLoopId, scaleRoot: s.scaleRoot });
    });
    useAppStore.getState().deleteLoop('loop-default-1');
    off();
    expect(seen).toEqual([{ activeLoopId: 'loop-b', scaleRoot: 'D' }]);
  });

  test('deleting the active loop while the song plays keeps the song running on the fallback', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: 0,
    });
    useAppStore.getState().playAll();

    useAppStore.getState().deleteLoop('loop-default-1');

    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe('loop-b');
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'song' });
    expect(s.songLoopIndex).toBe(0);
  });

  test('deleting a loop while the song plays leaves the arrangement running', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: 0,
    });
    useAppStore.getState().playAll();

    useAppStore.getState().deleteLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'song' });
    expect(s.songLoopIndex).toBe(0);
  });

  test('the last loop cannot be deleted, so no scope change happens', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().soloLoop('loop-default-1');

    expect(useAppStore.getState().deleteLoop('loop-default-1')).toBe(null);
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
  });

  // selectedVibeId clearing on an activeLoopId change (addLoop, duplicateLoop
  // and deleteLoop all move it) is no longer inline in these actions — see
  // store/vibeNav.ts's activeLoopId subscription and vibeNav.test.ts, which
  // covers every writer generically instead of one test per action here.
});

  test('setLoopTempName writes loops[] directly for the named loop only', () => {
    const h = makeSlice();
    const firstId = h.state.loops[0].id;
    h.state.addLoop();
    h.state.setLoopTempName(firstId, 'Synthwave 80s');
    expect(h.state.loops[0].tempName).toBe('Synthwave 80s');
    expect(h.state.loops[1].tempName).toBe('untitled-2');
  });
