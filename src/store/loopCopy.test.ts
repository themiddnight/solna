import { describe, expect, test } from 'bun:test';
import { LOOP_FLAT_KEYS } from './loop';
import { buildLoopCopyPatch, impliesKeyCopy, LOOP_COPY_GROUPS } from './loopCopy';
import type { LoopCopyGroupId } from './loopCopy';
import { createDefaultLoop } from './loopSlice';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { BassStepChoice } from '@/data/bassPatterns';
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
  customChordLoopLength: 2,
  customChordHoldSteps: new Array<number>(MAX_STEPS_PER_BAR * 2).fill(4),
  customBassLoopLength: 2,
  customBassHoldSteps: new Array<number>(MAX_STEPS_PER_BAR * 2).fill(2),
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
      'customChordLoopLength',
      'customChordHoldSteps',
      'chordFeel',
      'chordOctave',
    ]);
  });

  test('each pattern group carries its lane loop length and holds', () => {
    // A pattern is its onsets AND the cycle they repeat over: copying the grid
    // without the length would replay a two-bar phrase as a one-bar one, and
    // without the holds every span would collapse to a single step.
    const chord = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['chord-pattern']);
    expect(chord.customChordLoopLength).toBe(2);
    expect(chord.customChordHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR * 2).fill(4));

    const bass = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['bass-pattern']);
    expect(Object.keys(bass)).toEqual([
      'bassPatternId',
      'bassPatternMode',
      'customBassPattern',
      'customBassLoopLength',
      'customBassHoldSteps',
      'bassFeel',
      'bassOctave',
    ]);
    expect(bass.customBassLoopLength).toBe(2);
    expect(bass.customBassHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR * 2).fill(2));
  });

  test('several groups contribute exactly their union and nothing else', () => {
    const patch = buildLoopCopyPatch(sourceLoop(), targetLoop(), ['chord-progression', 'chord-pattern', 'key']);
    expect(new Set(Object.keys(patch))).toEqual(
      new Set([
        'chords',
        'chordRhythmId',
        'chordRhythmMode',
        'customChordRhythm',
        'customChordLoopLength',
        'customChordHoldSteps',
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
});

// Split off the group-matrix tests above: these two ask about the SHAPE of
// what comes back (ownership, and the one key whose copy is field-selective)
// rather than about which keys a group contributes.
describe('buildLoopCopyPatch — the value it hands back', () => {
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

// The cross-boundary fixture: ONE loop whose Chord lane runs TWO bars and
// whose Bass lane runs FOUR over the same four one-bar chords, with an
// explicit hold on every onset. A lane's cycle is an INDEPENDENT divisor of
// the progression, so a copy must move each lane at its own width — and the
// pattern groups are the only carriers of that width, which is why
// `customChordLoopLength`/`customBassLoopLength` are pinned alongside the
// arrays they size.
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

describe('the custom pattern fixture survives a module copy', () => {
  const source = (): Loop => customPatternLoop();

  test('the chord lane carries its own two-bar cycle, its onsets and its holds', () => {
    const patch = buildLoopCopyPatch(source(), targetLoop(), ['chord-pattern']);

    expect(patch.customChordLoopLength).toBe(2);
    expect(patch.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    // The STORED slot, not a column: 24 is bar two at the widest meter's width.
    expect(patch.customChordRhythm?.[MAX_STEPS_PER_BAR]).toBe(true);
    expect(patch.customChordHoldSteps?.[0]).toBe(THREE_FOUR);
    expect(patch.customChordHoldSteps?.[MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
  });

  test('the bass lane carries four bars, uncut to the chord lane’s two', () => {
    const patch = buildLoopCopyPatch(source(), targetLoop(), ['bass-pattern']);

    expect(patch.customBassLoopLength).toBe(4);
    expect(patch.customBassPattern).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(patch.customBassHoldSteps).toHaveLength(4 * MAX_STEPS_PER_BAR);
    ['root', 'third', 'fifth', 'seventh'].forEach((tone, bar) => {
      expect(patch.customBassPattern?.[bar * MAX_STEPS_PER_BAR]).toBe(tone);
      expect(patch.customBassHoldSteps?.[bar * MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
    });
  });

  test('copying one lane never carries the other', () => {
    const chord = buildLoopCopyPatch(source(), targetLoop(), ['chord-pattern']);
    expect('customBassPattern' in chord).toBe(false);
    expect('customBassLoopLength' in chord).toBe(false);
    expect('customBassHoldSteps' in chord).toBe(false);

    const bass = buildLoopCopyPatch(source(), targetLoop(), ['bass-pattern']);
    expect('customChordRhythm' in bass).toBe(false);
    expect('customChordLoopLength' in bass).toBe(false);
    expect('customChordHoldSteps' in bass).toBe(false);
  });

  test('the copied spans are the patch owner’s, so a later edit to the source cannot reach them', () => {
    const src = source();
    const patch = buildLoopCopyPatch(src, targetLoop(), ['chord-pattern', 'bass-pattern']);
    const before = JSON.stringify(patch);

    // Mutate the SOURCE one level down in each lane. A shallow pick passes a
    // `!==` check on the outer array and still shares every element.
    src.customChordRhythm[MAX_STEPS_PER_BAR] = false;
    src.customChordHoldSteps[0] = 1;
    src.customBassPattern[0] = 'rest';

    expect(JSON.stringify(patch)).toBe(before);
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
