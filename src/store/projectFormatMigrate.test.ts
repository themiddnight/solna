import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { migrateProjectBody } from './projectFormatMigrate';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { LEAD_TICKS_PER_BAR } from '../utils/stepResolution';
import { defaultPadState, INITIAL_SEQUENCER_TRACKS } from './initialState';
import type { SequencerTrack } from '../types';
import { PROJECT_FORMAT_VERSION } from './projectFormat';

describe('the .solna chain widens the melody to ticks', () => {
  const body = (steps: unknown, formatVersion: number): Record<string, unknown> => ({
    formatVersion,
    content: {
      loops: [{ id: 'loop-1', name: 'Loop 1', leadLoopLength: 1, leadMelodySteps: steps }],
    },
  });

  test('a current-shape v2 body is widened to ticks and defaulted', () => {
    const steps: unknown[][] = Array.from({ length: MAX_STEPS_PER_BAR }, () => []);
    steps[4] = [{ note: 'C4', len: 2 }];
    const out = migrateProjectBody(body(steps, 2), 2);
    const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
    expect(loop.leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
    expect((loop.leadMelodySteps as LeadNote[][])[8]).toEqual([{ note: 'C4', len: 4 }]);
    expect(loop.leadStepResolution).toBe('1/16');
  });

  test('a v1 body runs BOTH lead steps, in order, and lands populated', () => {
    // Same trap as the persist chain, and the reason each chain needs its
    // own end-to-end test: a v1 string[][] widened first would never become
    // LeadNote[][] at all, and sanitizeContent would hand back a blank
    // melody with no throw and no warning.
    const legacy = Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]);
    legacy[2] = ['C4'];
    const out = migrateProjectBody(body(legacy, 1), 1);
    const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
    expect((loop.leadMelodySteps as LeadNote[][])[4]).toEqual([{ note: 'C4', len: 2 }]);
    expect(loop.leadGate).toBeCloseTo(DEFAULT_LEAD_GATE, 10);
    expect(loop.leadStepResolution).toBe('1/16');
  });

  test('a v2 melody wider than leadLoopLength keeps every bar, at the right beat', () => {
    // The same ordinary state the persist chain is pinned against: a melody
    // left wider than the loop by setLeadLoopLengthPreserve. At exactly 2x
    // the old array is the width of one new bar, which is what made
    // trusting leadLoopLength re-read bar 0 at half its beat and bury bar 1.
    const steps: unknown[][] = Array.from({ length: 2 * MAX_STEPS_PER_BAR }, () => []);
    steps[4] = [{ note: 'C4', len: 2 }];
    steps[MAX_STEPS_PER_BAR + 4] = [{ note: 'E4', len: 2 }];
    const out = migrateProjectBody(body(steps, 2), 2);
    const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
    const melody = loop.leadMelodySteps as LeadNote[][];
    expect(melody).toHaveLength(2 * LEAD_TICKS_PER_BAR);
    expect(melody[8]).toEqual([{ note: 'C4', len: 4 }]);
    expect(melody[LEAD_TICKS_PER_BAR + 8]).toEqual([{ note: 'E4', len: 4 }]);
  });

  test('the two chains are separate functions, and stay separate', () => {
    const src = readFileSync(new URL('./projectFormatMigrate.ts', import.meta.url), 'utf8');
    // The ONLY thing shared with the persist chain is the pure transform.
    expect(src).toContain('upgradeLeadMelodyToTicks');
    expect(src).not.toContain("from './migrate'");
    expect(src).not.toContain("from './store'");
  });
});

describe('pad layer body upgrade', () => {
  // THE SECOND OF THE THREE. Same rule as the persist chain, enforced
  // separately because the two chains are deliberately not shared: a project
  // body is an external contract, a persist payload is private localStorage
  // shape, and their versions move for different reasons (CLAUDE.md).
  test('a body from before the pad opens with the pad muted', () => {
    const out = migrateProjectBody(
      { content: { loops: [{ id: 'a' }, { id: 'b' }] } },
      3,
    ) as { content: { loops: Record<string, unknown>[] } };
    for (const loop of out.content.loops) {
      expect(loop.padMuted).toBe(true);
      expect(loop.padDroneIntervals).toEqual(defaultPadState().padDroneIntervals);
    }
  });

  test('a body already at the current version is not re-backfilled', () => {
    const raw = { content: { loops: [{ id: 'a', padMuted: false }] } };
    const out = migrateProjectBody(raw, 4) as {
      content: { loops: Record<string, unknown>[] };
    };
    expect(out.content.loops[0].padMuted).toBe(false);
  });

  test('a body with no loops passes through', () => {
    expect(migrateProjectBody({ content: { bpm: 90 } }, 3)).toEqual({
      content: { bpm: 90 },
    });
  });
});

describe('v4 -> v5: a project body gains the tom and crash tracks', () => {
  const body = (loops: unknown[]) => ({ formatVersion: 4, content: { loops } });
  // The five tracks a REAL pre-v5 body actually wrote. A literal, not a slice
  // of INITIAL_SEQUENCER_TRACKS: that constant's roster and order have moved
  // twice already, and a fixture that tracks the roster it is supposed to
  // predate stops testing anything.
  const LEGACY_FIVE = ['kick', 'snare', 'hihat', 'openhat', 'clap'];
  const fiveTracks = () =>
    LEGACY_FIVE.map((instrument) => {
      const t = INITIAL_SEQUENCER_TRACKS.find((c) => c.instrument === instrument)!;
      return { ...t, steps: [...t.steps] };
    });

  test('a body from before the tracks opens with the six new voices, silent', () => {
    const out = migrateProjectBody(body([{ id: 'a', sequencerTracks: fiveTracks() }]), 4) as {
      content: { loops: Array<{ sequencerTracks: SequencerTrack[] }> };
    };
    const tracks = out.content.loops[0].sequencerTracks;
    expect(tracks.map((t) => t.instrument).slice(5)).toEqual([
      'rimshot', 'hitom', 'lowtom', 'ride', 'crash', 'bell',
    ]);
    for (const instrument of ['rimshot', 'hitom', 'lowtom', 'ride', 'crash', 'bell']) {
      const t = tracks.find((tr) => tr.instrument === instrument)!;
      expect(t.steps.some(Boolean), instrument).toBe(false);
    }
  });

  test('the drum backfill applied twice still appends the tracks once', () => {
    // Was a `fromVersion: 5` call asserting length 7 on a 7-length input: no
    // step ran, so it passed with the whole feature deleted. Real idempotence
    // is the v4 step applied to its own output.
    const once = migrateProjectBody(body([{ id: 'a', sequencerTracks: fiveTracks() }]), 4);
    const twice = migrateProjectBody(once, 4) as {
      content: { loops: Array<{ sequencerTracks: SequencerTrack[] }> };
    };
    const tracks = twice.content.loops[0].sequencerTracks;
    expect(tracks).toHaveLength(11);
    expect(tracks.map((t) => t.instrument)).toEqual([
      'kick',
      'snare',
      'hihat',
      'openhat',
      'clap',
      'rimshot',
      'hitom',
      'lowtom',
      'ride',
      'crash',
      'bell',
    ]);
  });

  test('a body that already holds all seven tracks keeps the very same array', () => {
    // withDrumTracks returns its input when nothing is missing, so reopening a
    // current project does not rebuild a single track object. `toBe`, not
    // `toEqual`: an equal-but-copied array would still pass the weaker check
    // and would still churn every loop on every open.
    const tracks = INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] }));
    const out = migrateProjectBody(body([{ id: 'a', sequencerTracks: tracks }]), 4) as {
      content: { loops: Array<{ sequencerTracks: SequencerTrack[] }> };
    };
    expect(out.content.loops[0].sequencerTracks).toBe(tracks);
  });

  test('a body with no loops passes through', () => {
    expect(migrateProjectBody({ formatVersion: 4, content: { bpm: 120 } }, 4)).toEqual({
      formatVersion: 4,
      content: { bpm: 120 },
    });
  });

  test('the two chains are separate modules, and stay separate', () => {
    // Was `expect(migrateProjectBody).not.toBe(migrateDrumTracks)`, which
    // compares two separately-declared functions and therefore can never
    // fail — it passed with the whole feature deleted. The lead chain's
    // sibling above is a source scan for exactly that reason, and this is the
    // same scan: what must hold is that this module never reaches into the
    // persist chain. They share withDrumTracks, a pure transform, and nothing
    // else.
    const src = readFileSync(new URL('./projectFormatMigrate.ts', import.meta.url), 'utf8');
    expect(src).toContain('withDrumTracks');
    expect(src).not.toContain("from './migrate'");
    // The docblock names the persist step in prose, as a cross-reference the
    // way upgradePadLayerV4 names migratePadLayer — so the guard is on a CALL
    // to it, not on the bare word.
    expect(src).not.toMatch(/migrateDrumTracks\s*\(/);
  });
});

describe('v5 -> v7: eleven drum voices', () => {
  const body = () => ({
    formatVersion: 5,
    content: {
      loops: [{
        soundKit: '909 Modern',
        sequencerTracks: [
          { id: 'track-kick', name: 'Kick', instrument: 'kick',
            steps: [true, false], volume: 0.9, muted: false, color: 'bg-error' },
          { id: 'track-tom', name: 'Tom', instrument: 'tom',
            steps: [false, true], volume: 0.8, muted: false, color: 'bg-primary' },
        ],
      }],
    },
  });

  test('renames the tom row, restores the other canonical rows, renames the kit, and ships the four new voices silent', () => {
    const out = migrateProjectBody(body(), 5) as {
      content: { loops: { soundKit: string; sequencerTracks: SequencerTrack[] }[] };
    };
    const loop = out.content.loops[0];
    expect(loop.soundKit).toBe('Club Standard');
    const lowtom = loop.sequencerTracks.filter((t) => t.instrument === 'lowtom');
    expect(lowtom).toHaveLength(1);
    expect(lowtom[0].steps).toEqual([false, true]);
    expect(lowtom[0].color).toBe('bg-drum-lowtom'); // bg-primary was the factory tom colour
    expect(loop.sequencerTracks.find((t) => t.instrument === 'kick')!.color).toBe('bg-drum-kick');
    // What must hold for a body this app actually wrote is that nothing it
    // authored changed.
    expect(loop.sequencerTracks.find((t) => t.instrument === 'kick')!.steps).toEqual([true, false]);
    // renameDrumTrack overwrites `tom` IN PLACE (position 1, where it already
    // was), then withDrumTracks appends the nine missing canonical tracks in
    // INITIAL_SEQUENCER_TRACKS order — this literal is the only evidence in
    // this file that the rename is in place rather than append-then-rename.
    expect(loop.sequencerTracks.map((t) => t.instrument)).toEqual([
      'kick', 'lowtom', 'snare', 'rimshot', 'clap', 'hihat',
      'openhat', 'hitom', 'ride', 'crash', 'bell',
    ]);
    // Property, in addition to the order above: every newly-canonical row is
    // silent.
    for (const added of ['rimshot', 'hitom', 'ride', 'bell']) {
      const track = loop.sequencerTracks.find((t) => t.instrument === added)!;
      expect(track.steps.some(Boolean), `${added} must ship silent`).toBe(false);
    }
  });

  test('PROJECT_FORMAT_VERSION is 7 and a v7 body is untouched', () => {
    expect(PROJECT_FORMAT_VERSION).toBe(7);
    const already = migrateProjectBody(body(), 7);
    expect((already as typeof already & { content: { loops: { soundKit: string }[] } })
      .content.loops[0].soundKit).toBe('909 Modern');
  });

  // A v6 body IS re-upgraded, and that is the reason the version moved to 7.
  // v6 was stamped on projects saved part-way through the drum slice, while the
  // upgrade step had not yet learned the four new voices, so a body carrying
  // that stamp holds a seven-voice roster that a `fromVersion < 6` guard would
  // never revisit. The step is idempotent, so re-running it completes those
  // bodies; this test is what stops someone "tidying" the guard back to 6.
  test('a v6 body is re-upgraded, not treated as current', () => {
    const upgraded = migrateProjectBody(body(), 6) as ReturnType<typeof body> & {
      content: { loops: { soundKit: string }[] };
    };
    expect(upgraded.content.loops[0].soundKit).toBe('Club Standard');
  });
});
