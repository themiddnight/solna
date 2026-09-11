import { describe, expect, test } from 'bun:test';
import { LOOP_FLAT_KEYS } from './loop';
import { buildLoopCopyPatch, impliesKeyCopy, LOOP_COPY_GROUPS } from './loopCopy';
import type { LoopCopyGroupId } from './loopCopy';
import { createDefaultLoop } from './loopSlice';
import type { Loop } from './types';

describe('LOOP_COPY_GROUPS partitions LOOP_FLAT_KEYS', () => {
  test('covers every flat key exactly once — no key uncovered, none in two groups', () => {
    const claimed = LOOP_COPY_GROUPS.flatMap((group) => [...group.keys]);
    // Duplicates first: a key counted twice would make the union a multiset
    // that the Set equality below silently accepts, and would mean two
    // checkboxes fighting over one field.
    expect(new Set(claimed).size).toBe(claimed.length);
    // Equality, not a subset check: a field added to Loop and to
    // LOOP_FLAT_KEYS but to no group would otherwise be saved, loaded,
    // mirrored and permanently uncopyable with nothing red.
    expect(new Set(claimed)).toEqual(new Set(LOOP_FLAT_KEYS));
  });

  test('every group id is unique', () => {
    const ids = LOOP_COPY_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

const sourceLoop = (): Loop => ({
  ...createDefaultLoop(),
  id: 'loop-source',
  name: 'Chorus',
  scaleRoot: 'C',
  scaleType: 'Major',
  chordFeel: 0.9,
  chordOctave: 5,
  synthVolume: -3,
});

const targetLoop = (): Loop => ({ ...createDefaultLoop(), id: 'loop-target' });

describe('buildLoopCopyPatch', () => {
  test('an empty selection builds an empty patch', () => {
    expect(Object.keys(buildLoopCopyPatch(sourceLoop(), targetLoop(), []))).toEqual([]);
  });

  test('one group contributes exactly its own keys', () => {
    const patch = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['lead-sound']);
    expect(Object.keys(patch)).toEqual(['synthParams']);
  });

  test('chord-progression copies only the progression; chord-pattern only the rhythm', () => {
    const progression = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['chord-progression']);
    expect(Object.keys(progression)).toEqual(['chords']);

    const rhythm = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['chord-pattern']);
    expect(Object.keys(rhythm)).toEqual([
      'chordRhythmId',
      'chordRhythmMode',
      'customChordRhythm',
      'chordFeel',
      'chordOctave',
    ]);
  });

  test('several groups contribute exactly their union and nothing else', () => {
    const patch = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['chord-progression', 'chord-pattern', 'key']);
    expect(new Set(Object.keys(patch))).toEqual(
      new Set([
        'chords',
        'chordRhythmId',
        'chordRhythmMode',
        'customChordRhythm',
        'chordFeel',
        'chordOctave',
        'scaleRoot',
        'scaleType',
      ]),
    );
    expect(patch.chordFeel).toBe(0.9);
    expect(patch.chordOctave).toBe(5);
    expect(patch.scaleRoot).toBe('C');
    // Not selected: the mixer and the drum grid stay out of the patch, so a
    // merge over the target cannot move a field the user did not tick.
    expect('synthVolume' in patch).toBe(false);
    expect('sequencerTracks' in patch).toBe(false);
    expect('name' in patch).toBe(false);
  });

  test('an unknown-to-the-selection group id contributes nothing', () => {
    // A genuinely unrecognized id, not a real LOOP_COPY_GROUPS member: the
    // function iterates LOOP_COPY_GROUPS and looks each one up in `selected`,
    // so an id with no matching group is simply never found — this pins that
    // a bogus id neither throws nor writes a stray key, which a refactor to
    // iterate `selected` instead could silently break.
    const patch = buildLoopCopyPatch(sourceLoop(), targetLoop(), [
      'lead-sound',
      'not-a-real-group' as LoopCopyGroupId,
    ]);
    expect(Object.keys(patch)).toEqual(['synthParams']);
  });

  test('values are deep-cloned, so a later edit to the source cannot reach the patch', () => {
    const source = sourceLoop();
    const patch = buildLoopCopyPatch(source, targetLoop(), ['drums-pattern', 'lead-pattern']);
    const before = JSON.stringify(patch);

    // Mutate the SOURCE one level DOWN in each structure. A shallow pick
    // passes a `!==` check on the outer array and still shares every
    // element, which is the failure cloneLoop exists to prevent: a later
    // edit to one loop's grid silently rewriting the other's.
    source.sequencerTracks[0].steps[0] = !source.sequencerTracks[0].steps[0];
    source.sequencerTracks[0].muted = true;
    source.leadMelodySteps[0].push({ note: 'C4', len: 1 });

    expect(JSON.stringify(patch)).toBe(before);
    expect(patch.sequencerTracks?.[0].muted).toBe(false);
    expect(patch.sequencerTracks?.[0].steps[0]).toBe(!source.sequencerTracks[0].steps[0]);
    expect(patch.leadMelodySteps?.[0]).toEqual([]);
  });

  test('drums-pattern copies steps only — the target keeps its own per-voice volume/mute', () => {
    // A SequencerTrack bundles a drum voice's pattern together with the
    // volume/mute TrackRow's own fader owns; neither 'drums-pattern' nor any
    // other checkbox names those two fields, so a mixed-in-place target must
    // come back untouched even though the whole key is what gets copied.
    const source = sourceLoop();
    source.sequencerTracks = source.sequencerTracks.map((track) => ({
      ...track,
      volume: -12,
      muted: true,
    }));
    const target = targetLoop();
    target.sequencerTracks = target.sequencerTracks.map((track) => ({
      ...track,
      volume: -3,
      muted: false,
    }));

    const patch = buildLoopCopyPatch(source, target, ['drums-pattern']);

    expect(patch.sequencerTracks?.every((t) => t.volume === -3)).toBe(true);
    expect(patch.sequencerTracks?.every((t) => t.muted === false)).toBe(true);
    // The pattern itself still comes from the source.
    expect(patch.sequencerTracks?.map((t) => t.steps)).toEqual(
      source.sequencerTracks.map((t) => t.steps),
    );
  });
});

describe('impliesKeyCopy', () => {
  const inC: Loop = { ...createDefaultLoop(), id: 'a', scaleRoot: 'C', scaleType: 'Major' };
  const inAMinor: Loop = {
    ...createDefaultLoop(),
    id: 'b',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
  };

  test('different keys with the chord progression ticked implies the key copy', () => {
    expect(impliesKeyCopy(inC, inAMinor, ['chord-progression'])).toBe(true);
  });

  test('a differing scale type alone is enough', () => {
    expect(impliesKeyCopy({ ...inC, scaleType: 'Dorian' }, inC, ['chord-progression'])).toBe(true);
  });

  test('matching keys imply nothing, so the notice never fires on a no-op', () => {
    expect(impliesKeyCopy(inC, { ...inC, id: 'c' }, ['chord-progression'])).toBe(false);
  });

  test('without the chord progression nothing is implied, whatever the keys are', () => {
    expect(impliesKeyCopy(inC, inAMinor, ['lead-sound', 'mix', 'drums-pattern'])).toBe(false);
    expect(impliesKeyCopy(inC, inAMinor, [])).toBe(false);
  });
});
