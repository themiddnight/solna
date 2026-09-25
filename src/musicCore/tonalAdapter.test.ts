import { describe, expect, test } from 'bun:test';
import { Chord, Interval, Note, Scale, transpose } from 'tonal';
import {
  chromaOfNote,
  intervalDistance,
  intervalSemitones,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  octaveOfNote,
  pitchClassOfNote,
  resolveTonalChord,
  scaleNotesForTonal,
  scaleSemitonesForTonal,
  transposeByInterval,
} from './tonalAdapter';

describe('tonalAdapter', () => {
  test('chromaOfNote matches Note.get(...).chroma, including NaN for an unparseable name', () => {
    expect(chromaOfNote('C#4')).toBe(Note.get('C#4').chroma);
    expect(Number.isNaN(chromaOfNote('not-a-note'))).toBe(true);
    expect(Note.get('not-a-note').empty).toBe(true);
  });

  test('noteMidi matches Note.midi', () => {
    expect(noteMidi('C4')).toBe(Note.midi('C4'));
    expect(noteMidi('not-a-note')).toBeNull();
  });

  test('midiToSharpName matches Note.fromMidiSharps', () => {
    expect(midiToSharpName(61)).toBe(Note.fromMidiSharps(61));
    expect(midiToSharpName(61)).toBe('C#4');
  });

  test('midiToFlatName matches Note.fromMidi', () => {
    expect(midiToFlatName(61)).toBe(Note.fromMidi(61));
    expect(midiToFlatName(61)).toBe('Db4');
  });

  test('pitchClassOfNote matches Note.pitchClass', () => {
    expect(pitchClassOfNote('Db5')).toBe(Note.pitchClass('Db5'));
    expect(pitchClassOfNote('Db5')).toBe('Db');
  });

  test('octaveOfNote matches Note.get(...).oct, narrowed to null', () => {
    expect(octaveOfNote('C4')).toBe(Note.get('C4').oct);
    expect(octaveOfNote('C4')).toBe(4);
    expect(octaveOfNote('F#3')).toBe(3);
    expect(octaveOfNote('Bb10')).toBe(10);
    expect(octaveOfNote('C-1')).toBe(-1);
  });

  test('octaveOfNote is null for a pitch class with no octave, or an unparseable name', () => {
    expect(octaveOfNote('C')).toBeNull();
    expect(octaveOfNote('')).toBeNull();
    expect(octaveOfNote('not-a-note')).toBeNull();
  });

  test('transposeByInterval matches transpose verbatim, including empty string on failure', () => {
    expect(transposeByInterval('C4', '8P')).toBe(transpose('C4', '8P'));
    expect(transposeByInterval('not-a-note', '8P')).toBe('');
  });

  test('intervalDistance matches Interval.distance', () => {
    expect(intervalDistance('C', 'E')).toBe(Interval.distance('C', 'E'));
    expect(intervalDistance('C', 'E')).toBe('3M');
  });

  test('intervalSemitones matches Interval.semitones', () => {
    expect(intervalSemitones('3M')).toBe(Interval.semitones('3M'));
    expect(intervalSemitones('3M')).toBe(4);
  });

  test('scaleNotesForTonal matches Scale.get(...).notes', () => {
    expect(scaleNotesForTonal('C', 'major')).toEqual(Scale.get('C major').notes);
  });

  test('scaleSemitonesForTonal measures Scale.get(C name).intervals in semitones', () => {
    expect(scaleSemitonesForTonal('major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleSemitonesForTonal('minor pentatonic')).toEqual(
      Scale.get('C minor pentatonic').intervals.map((i) => Interval.semitones(i)),
    );
  });

  test('scaleSemitonesForTonal throws on a name tonal does not know', () => {
    expect(() => scaleSemitonesForTonal('not-a-scale')).toThrow("tonal has no scale named 'not-a-scale'");
  });

  test('resolveTonalChord narrows Chord.getChord to { empty, intervals }', () => {
    const chord = Chord.getChord('maj7', 'C');
    expect(resolveTonalChord('maj7', 'C')).toEqual({ empty: chord.empty, intervals: chord.intervals });
    expect(resolveTonalChord('not-a-chord-type', 'C').empty).toBe(true);
  });
});
