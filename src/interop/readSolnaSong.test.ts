import { describe, expect, test } from 'bun:test';
import { Chord } from 'tonal';
import { CHORD_QUALITY_GROUPS, chordSymbol, getChordQualityEntry } from '@/musicCore';
import { serializeProject } from '@/store/projectFile';
import type { SolnaSong } from './contract';
import { interopFixtureBody } from './fixtures/interopFixture';
import { SOLNA_DRUM_VOICES, SOLNA_INTEROP_CONTRACT_VERSION, SOLNA_REFERENCE_PATCH, readSolnaSong } from './index';

const body = interopFixtureBody();
const text = serializeProject(body);

function readFixture(): SolnaSong {
  const result = readSolnaSong(text);
  if (!result.ok) throw new Error(`fixture did not read: ${result.reason}`);
  return result.song;
}
const song = readFixture();

describe('readSolnaSong', () => {
  test('refuses non-JSON, a non-project object and a newer version', () => {
    expect(readSolnaSong('{')).toEqual({ ok: false, reason: 'malformed' });
    expect(readSolnaSong('{"hello":1}')).toEqual({ ok: false, reason: 'malformed' });
    expect(readSolnaSong('[]')).toEqual({ ok: false, reason: 'malformed' });
    expect(readSolnaSong(text.slice(0, text.length / 2))).toEqual({ ok: false, reason: 'malformed' });
    expect(readSolnaSong(JSON.stringify({ ...body, formatVersion: 999 }))).toEqual({
      ok: false,
      reason: 'newer-version',
      formatVersion: 999,
    });
  });

  test('reports the envelope, tempo, meter and versions', () => {
    expect(song.contractVersion).toBe(SOLNA_INTEROP_CONTRACT_VERSION);
    expect(song.formatVersion).toBe(body.formatVersion);
    expect(song.name).toBe('Interop Fixture');
    expect(song.bpm).toBe(120);
    expect(song.meter).toEqual({ id: '4/4', numerator: 4, denominator: 4, beatsPerBar: 4 });
    expect(song.masterVolumeDb).toBe(body.content.masterVolume);
  });

  test('a compound meter counts its bar in quarter-note beats', () => {
    const result = readSolnaSong(JSON.stringify({ ...body, content: { ...body.content, meterId: '6/8' } }));
    if (!result.ok) throw new Error('6/8 fixture did not read');
    expect(result.song.meter).toEqual({ id: '6/8', numerator: 6, denominator: 8, beatsPerBar: 3 });
    expect(result.song.loops.map((l) => [l.startBeat, l.passBeats])).toEqual([[0, 6], [12, 3]]);
  });

  test('lays loops out in beats; a chordless loop dwells one bar', () => {
    expect(song.loops.map((l) => [l.index, l.startBeat, l.passBeats, l.repeatCount])).toEqual([
      [0, 0, 8, 2],
      [1, 16, 4, 1],
    ]);
  });

  test('names a loop by the user name, else by the app label', () => {
    expect(song.loops.map((l) => l.name)).toEqual(['Verse', 'untitled-2']);
  });

  test('reports chords pass-relative with Tonal symbols', () => {
    expect(song.loops[0].chords).toEqual([
      { startBeat: 0, durationBeats: 4, symbol: 'Cmaj' },
      { startBeat: 4, durationBeats: 4, symbol: 'Amin7' },
    ]);
    expect(song.loops[1].chords).toEqual([]);
  });

  test('every chord quality has a symbol Tonal reads back as the same chord', () => {
    const qualities = CHORD_QUALITY_GROUPS.flatMap((group) => group.options.map((option) => option.value));
    expect(qualities).toHaveLength(20);
    for (const quality of qualities) {
      const symbol = chordSymbol('F#', quality);
      if (symbol === null) throw new Error(`no symbol for ${quality}`);
      const parsed = Chord.get(symbol);
      expect(parsed.empty ? quality : null).toBeNull();
      expect(parsed.tonic).toBe('F#');
      expect(parsed.intervals).toEqual(Chord.getChord(getChordQualityEntry(quality)?.tonalAlias ?? '', 'F#').intervals);
    }
    expect(chordSymbol('C', 'nope')).toBeNull();
  });

});

describe('readSolnaSong — parts, passes and voices', () => {
  test('lists one pass per repeat with pass-relative notes', () => {
    expect(song.loops[0].synths.lead.passes).toHaveLength(2);
    expect(song.loops[1].synths.lead.passes).toHaveLength(1);
    for (const pass of song.loops[0].synths.lead.passes) {
      // The lead grid is one bar long and the pass two: the note sounds on each bar.
      expect(pass.map((n) => [n.midi, n.startBeat])).toEqual([[76, 0], [76, 4]]);
      expect(pass[0].durationBeats).toBeGreaterThan(0);
      expect(pass[0].velocity).toBeGreaterThan(0);
      expect(pass[0].velocity).toBeLessThanOrEqual(1);
    }
  });

  test('every note starts inside its pass', () => {
    for (const loop of song.loops) {
      for (const part of Object.values(loop.synths)) {
        for (const pass of part.passes) {
          for (const note of pass) {
            expect(note.startBeat).toBeGreaterThanOrEqual(0);
            expect(note.startBeat).toBeLessThan(loop.passBeats);
          }
        }
      }
      for (const pass of loop.beat.passes) {
        for (const hit of pass) {
          expect(hit.startBeat).toBeGreaterThanOrEqual(0);
          expect(hit.startBeat).toBeLessThan(loop.passBeats);
        }
      }
    }
  });

  test('reports mute without applying it, and applies voice mutes', () => {
    expect(song.loops[0].synths.bass.muted).toBe(true);
    expect(song.loops[0].synths.bass.passes[0].length).toBeGreaterThan(0);
    expect(song.loops[0].synths.lead.muted).toBe(false);
    expect(song.loops[0].beat.muted).toBe(false);
    // Two bars a pass, kick on steps 0 and 8 of each; the muted hi-hat voice has no hits.
    expect(song.loops[0].beat.passes[0].map((h) => [h.voiceId, h.startBeat])).toEqual([
      ['kick', 0],
      ['kick', 2],
      ['kick', 4],
      ['kick', 6],
    ]);
  });

  test('a chordless loop plays no chord, bass or pad, and keeps its lead and beat', () => {
    const loop = song.loops[1];
    expect(loop.synths.chord.passes).toEqual([[]]);
    expect(loop.synths.bass.passes).toEqual([[]]);
    expect(loop.synths.pad.passes).toEqual([[]]);
    expect(loop.synths.lead.passes[0]).toHaveLength(1);
    expect(loop.beat.passes[0]).toHaveLength(2);
  });

  test('carries each part its own level and patch', () => {
    const [verse] = body.content.loops;
    expect(song.loops[0].synths.lead.volumeDb).toBe(verse.synthVolume);
    expect(song.loops[0].synths.lead.patch).toEqual(verse.synthParams.patch);
    expect(song.loops[0].synths.pad.patch).toEqual(verse.padSynthParams.patch);
    expect(song.loops[0].beat.volumeDb).toBe(verse.beatMix.levelDb);
  });

  test('names the key with the Tonal scale name', () => {
    expect(song.loops[0].key).toEqual({ root: 'A', scaleName: 'aeolian' });
  });

  test('lists five synth tracks in display order and eleven drum voices with GM notes', () => {
    expect(song.synthTracks).toEqual([
      { id: 'lead', label: 'Lead' },
      { id: 'fx', label: 'FX' },
      { id: 'chord', label: 'Chord' },
      { id: 'bass', label: 'Bass' },
      { id: 'pad', label: 'Pad' },
    ]);
    expect(Object.keys(song.loops[0].synths).sort()).toEqual(song.synthTracks.map((t) => t.id).sort());
    expect(song.drumVoices).toEqual(SOLNA_DRUM_VOICES);
    expect(song.drumVoices).toHaveLength(11);
    expect(song.drumVoices.find((v) => v.id === 'kick')).toEqual({ id: 'kick', label: 'Kick', gmNote: 36 });
    expect(song.drumVoices.find((v) => v.id === 'bell')?.gmNote).toBe(56);
  });

  test('reads the same song twice (a random arp is seeded)', () => {
    const arp = { ...body.content.loops[0].chordArpSettings, active: true, mode: 'random' as const };
    const withArp = { ...body, content: { ...body.content, loops: [{ ...body.content.loops[0], chordArpSettings: arp }] } };
    const first = readSolnaSong(JSON.stringify(withArp));
    const second = readSolnaSong(JSON.stringify(withArp));
    expect(first).toEqual(second);
  });

  test('the reference patch sets both ENV2 routes and the LFO route', () => {
    expect(SOLNA_REFERENCE_PATCH.synth.env2Routes).toHaveLength(2);
    expect(SOLNA_REFERENCE_PATCH.synth.lfo.route).not.toBeNull();
  });
});
