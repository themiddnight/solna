/**
 * The contract's two promises that only solna can check: the reader reports
 * exactly what the song timeline (and so the MIDI export) plays, and the
 * contract's hand-declared shapes still accept solna's own types.
 */
import { describe, expect, test } from 'bun:test';
import { GM_DRUM_NOTE } from '@/audio/export/renderMidi';
import { buildSongTimeline, type SongTrack } from '@/audio/playback/plan/songTimeline';
import { MIXDOWN_SEED, withSeededRandom } from '@/audio/rng';
import { noteMidi } from '@/musicCore';
import { buildMixdownSnapshotFromContent } from '@/store/mixdownSnapshot';
import { serializeProject } from '@/store/projectFile';
import type { BeatVoiceId } from '@/types';
import type { EnginePatch } from '@/types/synth';
import type { SolnaSong, SolnaSynthPatch } from './contract';
import { interopFixtureBody } from './fixtures/interopFixture';
import { SOLNA_DRUM_VOICES, readSolnaSong } from './index';

// Type-level: solna's patch is assignable to the contract's inline declaration.
const patchConforms: SolnaSynthPatch = {} as EnginePatch<'subtractive'>;
void patchConforms;

interface FlatEvent {
  lane: string;
  key: number | string;
  beat: number;
  durationBeats: number | null;
  velocity: number;
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;
const byOrder = (a: FlatEvent, b: FlatEvent): number =>
  a.beat - b.beat || a.lane.localeCompare(b.lane) || String(a.key).localeCompare(String(b.key));

function flattenSong(song: SolnaSong): FlatEvent[] {
  const out: FlatEvent[] = [];
  for (const loop of song.loops) {
    for (const [lane, part] of Object.entries(loop.synths)) {
      part.passes.forEach((pass, passIndex) => {
        for (const n of pass) {
          out.push({
            lane,
            key: n.midi,
            beat: round(loop.startBeat + passIndex * loop.passBeats + n.startBeat),
            durationBeats: round(n.durationBeats),
            velocity: n.velocity,
          });
        }
      });
    }
    loop.beat.passes.forEach((pass, passIndex) => {
      for (const hit of pass) {
        out.push({
          lane: 'beat',
          key: hit.voiceId,
          beat: round(loop.startBeat + passIndex * loop.passBeats + hit.startBeat),
          durationBeats: null,
          velocity: hit.velocity,
        });
      }
    });
  }
  return out.sort(byOrder);
}

describe('interop conformance', () => {
  test('equals the song timeline event for event', async () => {
    const body = interopFixtureBody();
    const snapshot = buildMixdownSnapshotFromContent(body.content, []);
    const timeline = await withSeededRandom(MIXDOWN_SEED, () => buildSongTimeline(snapshot));
    const toBeat = (sec: number): number => round((sec * snapshot.bpm) / 60);
    const expected: FlatEvent[] = timeline.events
      .map((e): FlatEvent =>
        e.kind === 'note'
          ? {
              lane: e.track satisfies SongTrack,
              key: noteMidi(e.noteName) ?? -1,
              beat: toBeat(e.startSec),
              durationBeats: round(toBeat(e.endSec) - toBeat(e.startSec)),
              velocity: e.velocity,
            }
          : { lane: 'beat', key: e.voice, beat: toBeat(e.timeSec), durationBeats: null, velocity: e.velocity },
      )
      .sort(byOrder);

    const result = readSolnaSong(serializeProject(body));
    if (!result.ok) throw new Error('fixture did not read');
    expect(expected.length).toBeGreaterThan(10);
    expect(flattenSong(result.song)).toEqual(expected);
  });

  test('lists every Beat voice with the MIDI export note', () => {
    const notes: Record<BeatVoiceId, number> = Object.fromEntries(
      SOLNA_DRUM_VOICES.map((v) => [v.id, v.gmNote]),
    ) as Record<BeatVoiceId, number>;
    expect(notes).toEqual({ ...GM_DRUM_NOTE });
  });
});
