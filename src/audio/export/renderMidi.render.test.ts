import { describe, expect, test } from 'bun:test';
import { noteMidi } from '@/musicCore';
import { MAX_STEPS_PER_BAR } from '@/utils/timeSignature';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import {
  GM_DRUM_NOTE,
  MIDI_LANES,
  MIDI_PPQ,
  eventAudible,
  midiVelocity,
  renderMidi,
  resolveNoteOverlaps,
  secondsToTicks,
  type MidiNote,
} from './renderMidi';
import { readSmf, type ReadNote } from './smfTestReader';
import { beatPatternFixture, mixdownLoop, mixdownMelodyBar, mixdownSnapshot } from './mixdownFixture';
import type { MixdownRenderProgress } from './renderResult';
import { MIXDOWN_SEED, getRandomSource, withSeededRandom } from '../rng';
import { buildSongTimeline, type TimelineEvent } from '../playback/plan/songTimeline';
import type { MixdownSnapshot } from '../playback/plan/songSnapshot';

type RenderResult = Awaited<ReturnType<typeof renderMidi>>;

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function byChannelTickNote(a: ReadNote, b: ReadNote): number {
  return a.channel - b.channel || a.startTick - b.startTick || a.note - b.note;
}

async function parsedNotes(result: RenderResult): Promise<ReadNote[]> {
  if (!result.ok) throw new Error(`render failed: ${JSON.stringify(result.reason)}`);
  const file = readSmf(await bytesOf(result.blob));
  return file.tracks.flatMap((t) => t.notes).sort(byChannelTickNote);
}

async function renderNotes(snapshot: MixdownSnapshot): Promise<ReadNote[]> {
  return parsedNotes(await renderMidi(snapshot, 'T'));
}

function expectedNote(snapshot: MixdownSnapshot, e: TimelineEvent): MidiNote | null {
  const lane = e.kind === 'note' ? e.track : 'beat';
  const channel = MIDI_LANES.find((entry) => entry.lane === lane)!.channel;
  const note = e.kind === 'note' ? noteMidi(e.noteName) : GM_DRUM_NOTE[e.voice];
  const velocity = midiVelocity(e.velocity);
  if (note === null || velocity === null) return null;
  const startTick = secondsToTicks(e.kind === 'note' ? e.startSec : e.timeSec, snapshot.bpm);
  const endTick =
    e.kind === 'note'
      ? Math.max(startTick + 1, secondsToTicks(e.endSec, snapshot.bpm))
      : startTick + MIDI_PPQ / 4;
  return { lane, channel, note, velocity, startTick, endTick };
}

/** The oracle: the seeded timeline, filtered and mapped by hand, same overlap rule. */
async function expectedNotes(snapshot: MixdownSnapshot): Promise<ReadNote[]> {
  const { events } = await withSeededRandom(MIXDOWN_SEED, () => buildSongTimeline(snapshot));
  const notes = events
    .filter((e) => eventAudible(snapshot, e))
    .map((e) => expectedNote(snapshot, e))
    .filter((n): n is MidiNote => n !== null);
  return resolveNoteOverlaps(notes)
    .map(({ channel, note, velocity, startTick, endTick }) => ({ channel, note, velocity, startTick, endTick }))
    .sort(byChannelTickNote);
}

function leadBar32Snapshot(): MixdownSnapshot {
  const bar = mixdownMelodyBar('E4');
  bar[1] = [{ note: 'G4', len: 1 }];
  return mixdownSnapshot({ loops: [mixdownLoop({ leadMelodySteps: bar, leadStepResolution: '1/32' })] });
}

function twoLoopBassMutedSnapshot(): MixdownSnapshot {
  const second = mixdownLoop({ id: 'loop-2' });
  const buses = second.buses.map((b) => (b.source === 'bass' ? { ...b, muted: true } : b));
  return mixdownSnapshot({ loops: [mixdownLoop(), { ...second, buses }] });
}

/** Kick on 0/8 plus a snare on 4/12, so muting one voice leaves another sounding. */
function kickAndSnareSnapshot(kickGain: number): MixdownSnapshot {
  const pattern = beatPatternFixture();
  pattern.rows.snare = Array.from({ length: MAX_STEPS_PER_BAR }, (_, i) => i === 4 || i === 12);
  const beatVoiceGains = BEAT_VOICE_IDS.map((voice) => ({ voice, gain: voice === 'kick' ? kickGain : 1 }));
  return mixdownSnapshot({ loops: [mixdownLoop({ beatPattern: pattern, beatVoiceGains })] });
}

function randomArpSnapshot(): MixdownSnapshot {
  return mixdownSnapshot({
    loops: [
      mixdownLoop({
        repeatCount: 4,
        chordArpSettings: { active: true, mode: 'random', rate: '16n', octaves: 2 },
      }),
    ],
  });
}

describe('renderMidi equivalence', () => {
  test('the MIDI notes are the audible timeline events, nothing else', async () => {
    for (const snapshot of [mixdownSnapshot(), leadBar32Snapshot(), twoLoopBassMutedSnapshot()]) {
      const actual = await renderNotes(snapshot);
      expect(actual.length).toBeGreaterThan(0);
      expect(actual).toEqual(await expectedNotes(snapshot));
    }
  });

  test('on-grid events land on step multiples', async () => {
    const grid = await renderNotes(mixdownSnapshot());
    const onGrid = grid.filter((n) => n.channel === 9 || n.channel === 1);
    expect(onGrid.length).toBeGreaterThan(0);
    for (const n of onGrid) expect(n.startTick % 120).toBe(0);

    const lead = (await renderNotes(leadBar32Snapshot())).filter((n) => n.channel === 3);
    expect(lead.length).toBeGreaterThan(0);
    for (const n of lead) expect(n.startTick % 60).toBe(0);
    const g4 = lead.find((n) => n.note === 67);
    expect(g4?.startTick).toBe(60);
  });

  test('a muted loop bus drops that lane only in that loop', async () => {
    const notes = await renderNotes(twoLoopBassMutedSnapshot());
    const loop2Start = 16 * 120;
    const bass = notes.filter((n) => n.channel === 1);
    expect(bass.length).toBeGreaterThan(0);
    for (const n of bass) expect(n.startTick).toBeLessThan(loop2Start);
    for (const channel of [0, 9]) {
      const lane = notes.filter((n) => n.channel === channel);
      expect(lane.some((n) => n.startTick < loop2Start)).toBe(true);
      expect(lane.some((n) => n.startTick >= loop2Start)).toBe(true);
    }
  });

  test('a bus at gain 0 and a muted drum voice drop their notes', async () => {
    const loop = mixdownLoop();
    const buses = loop.buses.map((b) => (b.source === 'chord' ? { ...b, gain: 0 } : b));
    const chordSilent = await renderNotes(mixdownSnapshot({ loops: [{ ...loop, buses }] }));
    expect(chordSilent.some((n) => n.channel === 1)).toBe(true);
    expect(chordSilent.filter((n) => n.channel === 0)).toEqual([]);

    const drums = (await renderNotes(kickAndSnareSnapshot(0))).filter((n) => n.channel === 9);
    expect(drums.filter((n) => n.note === GM_DRUM_NOTE.kick)).toEqual([]);
    expect(drums.some((n) => n.note === GM_DRUM_NOTE.snare)).toBe(true);
    const unmuted = (await renderNotes(kickAndSnareSnapshot(1))).filter((n) => n.channel === 9);
    expect(unmuted.some((n) => n.note === GM_DRUM_NOTE.kick)).toBe(true);
  });

  test('an unparseable note name is dropped, not sent as 440 Hz', async () => {
    expect(noteMidi('H9')).toBeNull();
    const snapshot = mixdownSnapshot({ loops: [mixdownLoop({ leadMelodySteps: mixdownMelodyBar('H9') })] });
    const result = await renderMidi(snapshot, 'T');
    expect(result.ok).toBe(true);
    expect((await parsedNotes(result)).filter((n) => n.channel === 3)).toEqual([]);
  });
});

describe('renderMidi runtime', () => {
  test('two exports of a random-arp song are byte-identical', async () => {
    const first = await renderMidi(randomArpSnapshot(), 'T');
    const second = await renderMidi(randomArpSnapshot(), 'T');
    if (!first.ok || !second.ok) throw new Error('render failed');
    expect(await bytesOf(second.blob)).toEqual(await bytesOf(first.blob));
  });

  test('runs with no OfflineAudioContext or AudioContext', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { offline: g.OfflineAudioContext, live: g.AudioContext };
    delete g.OfflineAudioContext;
    delete g.AudioContext;
    try {
      const result = await renderMidi(mixdownSnapshot(), 'T');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.blob.type).toBe('audio/midi');
    } finally {
      if (saved.offline !== undefined) g.OfflineAudioContext = saved.offline;
      if (saved.live !== undefined) g.AudioContext = saved.live;
    }
  });

  test('reports preparing, rendering, encoding in order', async () => {
    const progress: MixdownRenderProgress[] = [];
    const snapshot = mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 20 })] });
    const result = await renderMidi(snapshot, 'T', (p) => progress.push(p));
    expect(result.ok).toBe(true);
    const phases = progress.map((p) => p.phase).filter((phase, i, all) => phase !== all[i - 1]);
    expect(phases).toEqual(['preparing', 'rendering', 'encoding']);
    const firstRendering = progress.find((p) => p.phase === 'rendering');
    expect(firstRendering).toEqual({ phase: 'rendering', percent: Math.floor((100 * 200) / 320) });
    expect(Math.floor((100 * 200) / 320)).toBe(62);
  });

  test('an aborted signal before start returns cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await renderMidi(mixdownSnapshot(), 'T', undefined, controller.signal);
    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });

  test('aborting at the first yield returns cancelled', async () => {
    const controller = new AbortController();
    const phases: string[] = [];
    const snapshot = mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 20 })] });
    const onProgress = (p: MixdownRenderProgress) => {
      phases.push(p.phase);
      if (p.phase === 'rendering') controller.abort();
    };
    const result = await renderMidi(snapshot, 'T', onProgress, controller.signal);
    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
    expect(phases).not.toContain('encoding');
  });

  test('an empty arrangement is reported, not encoded', async () => {
    const result = await renderMidi(mixdownSnapshot({ loops: [] }), 'T');
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('a throwing progress observer does not fail the export', async () => {
    const result = await renderMidi(mixdownSnapshot(), 'T', () => {
      throw new Error('observer broke');
    });
    expect(result.ok).toBe(true);
  });

  test('the seeded stream is restored afterwards', async () => {
    const before = getRandomSource();
    await renderMidi(randomArpSnapshot(), 'T');
    expect(getRandomSource()).toBe(before);
  });
});
