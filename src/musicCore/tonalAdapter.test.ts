import { describe, expect, test } from 'bun:test';
import { Chord, Interval, Note, Scale, transpose } from 'tonal';
import {
  chromaOfNote,
  intervalDistance,
  intervalSemitones,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  pitchClassOfNote,
  resolveTonalChord,
  scaleNotesForTonal,
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

  test('resolveTonalChord narrows Chord.getChord to { empty, intervals }', () => {
    const chord = Chord.getChord('maj7', 'C');
    expect(resolveTonalChord('maj7', 'C')).toEqual({ empty: chord.empty, intervals: chord.intervals });
    expect(resolveTonalChord('not-a-chord-type', 'C').empty).toBe(true);
  });
});
