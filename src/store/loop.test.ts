import { describe, expect, test } from 'bun:test';
import {
  defaultPadState,
  INITIAL_CHORDS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
} from './initialState';
import {
  cloneLoop,
  fallbackActiveLoopId,
  newLoopId,
  nextDuplicateLabel,
  loopBars,
  loopLabel,
  nextUntitledName,
  loopStatePatch,
  resolveActiveLoop,
  LOOP_FLAT_KEYS,
} from './loop';
import { createDefaultLoop } from './loopSlice';
import type { Loop } from './types';
import { DEFAULT_LEAD_GATE } from '../audio/leadMelody';

function makeLoop(overrides: Partial<Loop> = {}): Loop {
  return {
    id: 'loop-x',
    name: 'Loop X',
    tempName: 'untitled-1',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: INITIAL_SYNTH_PARAMS,
    chords: INITIAL_CHORDS.map((c) => ({ ...c })),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: 'bass-1',
    bassPatternMode: 'preset',
    customBassPattern: [],
    bassFeel: 0.5,
    bassOctave: 2,
    leadMelodySteps: [[]],
    leadLoopLength: 1,
    leadStepResolution: '1/16',
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    leadGate: DEFAULT_LEAD_GATE,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    synthVolume: 1.0,
    synthMuted: false,
    chordVolume: 1.0,
    chordMuted: false,
    bassVolume: 1.0,
    bassMuted: false,
    ...defaultPadState(),
    masterSequencerVolume: 0.8,
    drumMuted: false,
    ...overrides,
  };
}

describe('loopBars', () => {
  test('sums chord bars with a 1-bar default for bar-less chords', () => {
    expect(loopBars([])).toBe(0);
    expect(loopBars([{ bars: 2 }, { bars: 1 }, { bars: 4 }])).toBe(7);
    expect(loopBars([{ bars: 0 }])).toBe(1);
    expect(loopBars([{ bars: undefined }])).toBe(1);
    expect(loopBars(INITIAL_CHORDS)).toBe(4);
  });
});

describe('newLoopId', () => {
  test('produces unique ids with the loop- prefix', () => {
    expect(newLoopId().startsWith('loop-')).toBe(true);
    expect(newLoopId()).not.toBe(newLoopId());
  });
});

describe('loopLabel', () => {
  test('a user name wins over the app label', () => {
    expect(loopLabel({ name: 'Drop', tempName: 'Synthwave 80s' })).toBe('Drop');
  });

  // The case the old single-field model could not represent at all: an empty
  // name is a VALUE (the user cleared it), not a hole, and it falls through.
  test('a blank name falls through to tempName', () => {
    expect(loopLabel({ name: '', tempName: 'Synthwave 80s' })).toBe('Synthwave 80s');
    expect(loopLabel({ name: '', tempName: 'untitled-3' })).toBe('untitled-3');
  });
});

describe('nextUntitledName', () => {
  test('is one above the highest untitled number, not a positional index', () => {
    expect(nextUntitledName([])).toBe('untitled-1');
    expect(nextUntitledName([makeLoop({ id: 'a', tempName: 'untitled-1' })])).toBe('untitled-2');
  });

  // The stored-not-positional trade, asserted rather than described: the label
  // never shifts when loops are dragged or deleted, at the cost of gaps. With
  // untitled-2 and untitled-7 present the next is untitled-8, NOT untitled-3.
  test('leaves gaps alone and counts from the highest', () => {
    expect(
      nextUntitledName([
        makeLoop({ id: 'a', tempName: 'untitled-2' }),
        makeLoop({ id: 'b', tempName: 'untitled-7' }),
      ])
    ).toBe('untitled-8');
  });

  test('a vibe-stamped or user-named loop consumes no number', () => {
    expect(
      nextUntitledName([
        makeLoop({ id: 'a', name: 'Drop', tempName: 'Synthwave 80s' }),
        makeLoop({ id: 'b', tempName: 'Lo-Fi Chill' }),
      ])
    ).toBe('untitled-1');
  });
});

describe('nextDuplicateLabel', () => {
  // The whole rule: increment the label the card is DISPLAYING, in the field
  // it came from. tempName is ALSO renumbered here, off its own stem — never
  // copied verbatim — because `name` masking `tempName` today does not stop
  // either name being cleared to '' later, and a clone sharing its source's
  // exact tempName would then surface as the same loopLabel on both cards.
  test('a named loop increments its name and its tempName, independently', () => {
    const source = makeLoop({ id: 'a', name: 'Drop', tempName: 'Synthwave 80s' });
    expect(nextDuplicateLabel([source], source)).toEqual({
      name: 'Drop 2',
      tempName: 'Synthwave 80s 2',
    });
  });

  test('a named loop already carrying a number counts on from its stem', () => {
    const two = makeLoop({ id: 'a', name: 'Drop 2', tempName: 'untitled-1' });
    expect(nextDuplicateLabel([two], two).name).toBe('Drop 3');
  });

  // The second case is the point of the rule and must not be left to the
  // first case's coverage: copying tempName verbatim would put two cards
  // reading `Synthwave 80s` side by side, and promoting it into `name` would
  // stop the copy tracking vibe applications while its original kept doing so.
  test('an unnamed loop increments tempName and leaves name empty', () => {
    const source = makeLoop({ id: 'a', name: '', tempName: 'Synthwave 80s' });
    expect(nextDuplicateLabel([source], source)).toEqual({
      name: '',
      tempName: 'Synthwave 80s 2',
    });
  });

  test('an untitled loop counts on the hyphenated stem', () => {
    const loops = [
      makeLoop({ id: 'a', name: '', tempName: 'untitled-1' }),
      makeLoop({ id: 'b', name: '', tempName: 'untitled-2' }),
      makeLoop({ id: 'c', name: '', tempName: 'untitled-3' }),
    ];
    expect(nextDuplicateLabel(loops, loops[2])).toEqual({ name: '', tempName: 'untitled-4' });
  });

  // Lowest free rather than one-above-the-highest: the numbers belong to a
  // stem, not to the project, so a gap in `Drop 2, Drop 4` is a slot a copy
  // should fill.
  test('takes the lowest free integer for the stem', () => {
    const drop = makeLoop({ id: 'a', name: 'Drop', tempName: 'untitled-1' });
    const loops = [
      drop,
      makeLoop({ id: 'b', name: 'Drop 2', tempName: 'untitled-2' }),
      makeLoop({ id: 'c', name: 'Drop 4', tempName: 'untitled-3' }),
    ];
    expect(nextDuplicateLabel(loops, drop).name).toBe('Drop 3');
  });

  // The property, stated as a property: no two cards may read the same thing,
  // whatever arithmetic got there. Collision is checked against the DISPLAYED
  // label of every loop, since that is what the user is looking at.
  test('no two loops can resolve to the same loopLabel', () => {
    const source = makeLoop({ id: 'a', name: '', tempName: 'Synthwave 80s' });
    const loops = [
      source,
      makeLoop({ id: 'b', name: 'Synthwave 80s 2', tempName: 'untitled-2' }),
    ];
    const next = nextDuplicateLabel(loops, source);
    const clone = makeLoop({ id: 'c', ...next });
    const labels = [...loops, clone].map(loopLabel);
    expect(next.tempName).toBe('Synthwave 80s 3');
    expect(new Set(labels).size).toBe(labels.length);
  });

  // A masked tempName is still a live value: it must not be handed out to a
  // new clone just because the loop currently hiding it happens to be named.
  // L1 -> dup -> L2 (untitled-2) -> name L2 'Foo' (masks, does not clear,
  // untitled-2) -> dup L1 again must NOT reuse 'untitled-2', because clearing
  // L2's name later would unmask it and collide with the new clone.
  test('does not hand out a tempName another loop is currently masking', () => {
    const l1 = makeLoop({ id: 'l1', name: '', tempName: 'untitled-1' });
    const l2 = makeLoop({ id: 'l2', name: 'Foo', tempName: 'untitled-2' });
    const next = nextDuplicateLabel([l1, l2], l1);
    expect(next.tempName).toBe('untitled-3');

    const l3 = makeLoop({ id: 'l3', ...next });
    const l2Cleared = { ...l2, name: '' };
    const labels = [l1, l2Cleared, l3].map(loopLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // Same masking trap, but on the named-source branch's OWN tempName
  // renumbering: a user can rename a loop to look exactly like a placeholder
  // ('untitled-2'), and that string is still a live, currently-masked
  // tempName elsewhere only if some loop's real tempName equals it — here l3's
  // masked tempName is 'untitled-5', displayed as 'untitled-2'. Duplicating a
  // NAMED loop must avoid handing the clone's hidden tempName a value that
  // matches another loop's DISPLAYED label, or clearing the clone's name later
  // collides with l3.
  test('named-source branch does not hand out a tempName matching another loop\'s displayed label', () => {
    const l1 = makeLoop({ id: 'l1', name: 'Melody', tempName: 'untitled-1' });
    const l3 = makeLoop({ id: 'l3', name: 'untitled-2', tempName: 'untitled-5' });
    const next = nextDuplicateLabel([l1, l3], l1);
    expect(next.tempName).not.toBe('untitled-2');

    const l2 = makeLoop({ id: 'l2', ...next });
    const l2Cleared = { ...l2, name: '' };
    const labels = [l1, l3, l2Cleared].map(loopLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('fallbackActiveLoopId', () => {
  test('falls back to the next neighbour, then the previous, then the first', () => {
    const loops = [makeLoop({ id: 'a' }), makeLoop({ id: 'b' }), makeLoop({ id: 'c' })];
    expect(fallbackActiveLoopId(loops, 'a')).toBe('b');
    expect(fallbackActiveLoopId(loops, 'b')).toBe('c');
    expect(fallbackActiveLoopId(loops, 'c')).toBe('b');
    expect(fallbackActiveLoopId([loops[0]], 'a')).toBe('a');
    expect(fallbackActiveLoopId(loops, 'missing')).toBe(null);
  });
});

describe('cloneLoop', () => {
  test('deep-clones nested arrays and objects', () => {
    const loop = makeLoop();
    const clone = cloneLoop(loop);
    expect(clone).toEqual(loop);
    expect(clone).not.toBe(loop);
    expect(clone.synthParams).not.toBe(loop.synthParams);
    expect(clone.chords).not.toBe(loop.chords);
    expect(clone.sequencerTracks).not.toBe(loop.sequencerTracks);
    expect(clone.sequencerTracks[0].steps).not.toBe(loop.sequencerTracks[0].steps);
  });
});

describe('loopStatePatch', () => {
  test('picks exactly the 31 per-loop keys, never id or name', () => {
    const loop = makeLoop({ scaleRoot: 'D', drumMuted: true });
    const patch = loopStatePatch(loop);
    expect(Object.keys(patch).sort()).toEqual([...LOOP_FLAT_KEYS].sort());
    expect(patch.scaleRoot).toBe('D');
    expect(patch.drumMuted).toBe(true);
    expect('id' in patch).toBe(false);
    expect('name' in patch).toBe(false);
  });
  test('works on a flat AppStore-shaped object too', () => {
    const patch = loopStatePatch({ scaleRoot: 'C', chords: INITIAL_CHORDS, id: 'nope' });
    expect(patch.scaleRoot).toBe('C');
    expect('id' in patch).toBe(false);
  });
});

describe('resolveActiveLoop', () => {
  const loops = [
    { ...createDefaultLoop(), id: 'a' },
    { ...createDefaultLoop(), id: 'b' },
  ];
  test('returns the loop named by activeId when it exists', () => {
    expect(resolveActiveLoop(loops, 'b').id).toBe('b');
  });
  test('falls back to loops[0] for a foreign id, null or undefined', () => {
    expect(resolveActiveLoop(loops, 'zzz').id).toBe('a');
    expect(resolveActiveLoop(loops, null).id).toBe('a');
    expect(resolveActiveLoop(loops, undefined).id).toBe('a');
  });
});
