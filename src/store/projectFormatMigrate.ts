import {
  DEFAULT_LEAD_GATE,
  isLegacyLeadMelody,
  upgradeLeadMelodyToTicks,
  upgradeLeadMelodyV1,
  type LeadNote,
} from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';
import {
  defaultPadState,
  recolourDrumTracks,
  renameDrumTrack,
  renameSoundKit,
  withDrumTracks,
} from './initialState';
import type { SequencerTrack } from '../types';

/**
 * The traversal every per-loop step of THIS chain repeats: reach `raw.content`,
 * leave the body untouched unless it is a plain object whose `loops` is an
 * array, and map each plain-object loop through `fn` (anything else passes
 * through, for sanitizeContent to refuse). Each version step below is then only
 * the field map it actually is.
 *
 * This is deliberately a SECOND copy of the same idea that mapLoops in
 * migrate.ts carries, and the two must NOT be merged: a project body is an
 * external contract (it has an envelope around `content`), the persist payload
 * is private localStorage shape, and their version numbers move for different
 * reasons (CLAUDE.md).
 */
function mapBodyLoops(
  raw: Record<string, unknown>,
  fn: (loop: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const content = raw.content;
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return raw;
  const c = content as Record<string, unknown>;
  if (!Array.isArray(c.loops)) return raw;
  return {
    ...raw,
    content: {
      ...c,
      loops: c.loops.map((loop) => {
        if (typeof loop !== 'object' || loop === null || Array.isArray(loop)) return loop;
        return fn(loop as Record<string, unknown>);
      }),
    },
  };
}

/**
 * v1 -> v2: lead notes gain a length and each loop gains a gate. Shares only
 * the pure upgradeLeadMelodyV1 transform with the persist chain in
 * migrate.ts — the two must NOT be refactored into one function: a project
 * body is an external contract, the persist payload is private localStorage
 * shape, and their version numbers move for different reasons.
 */
function upgradeLeadNotesV2(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (row) => ({
    ...row,
    leadMelodySteps: isLegacyLeadMelody(row.leadMelodySteps)
      ? upgradeLeadMelodyV1(row.leadMelodySteps)
      : row.leadMelodySteps,
    leadGate: typeof row.leadGate === 'number' ? row.leadGate : DEFAULT_LEAD_GATE,
  }));
}

/**
 * v2 -> v3: the melody is stored in ticks and each loop carries the
 * resolution it was authored at. Shares only the pure
 * upgradeLeadMelodyToTicks transform with the persist chain in migrate.ts —
 * the two must NOT be refactored into one: a project body is an external
 * contract, the persist payload is private localStorage shape, and their
 * version numbers move for different reasons.
 */
function upgradeLeadTicksV3(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (row) => {
    const bars = typeof row.leadLoopLength === 'number' ? row.leadLoopLength : 1;
    return {
      ...row,
      leadMelodySteps: Array.isArray(row.leadMelodySteps)
        ? upgradeLeadMelodyToTicks(row.leadMelodySteps as LeadNote[][], bars)
        : row.leadMelodySteps,
      leadStepResolution:
        typeof row.leadStepResolution === 'string'
          ? row.leadStepResolution
          : DEFAULT_LEAD_STEP_RESOLUTION,
    };
  });
}

/* ===========================================================================
 * ABOUT THE STEPS BELOW — a note on this section, not a docblock for the next
 * function. (Written with a single `*` so no tool reads it as one.)
 *
 * The `.solna` format migration chain. Separate from the persist chain in
 * store.ts on purpose (see projectFormat.ts): a project file is an external
 * contract, the persist payload is private.
 *
 * Each step must be PURE, and steps run in version order. A step is NOT
 * required to be a no-op on an already-current payload, and upgradeLeadTicksV3
 * deliberately is not one: applied twice it re-doubles the melody (96 rows to
 * 192). The `fromVersion` gate in migrateProjectBody is what guarantees single
 * application, and each step may assume it.
 *
 * That is not laxity. upgradeLeadTicksV3 used to make itself idempotent by
 * comparing the array's width against leadLoopLength, and because
 * LEAD_TICKS_PER_BAR is 2 * MAX_STEPS_PER_BAR that guard read two OLD bars as
 * one NEW one and returned a real user's melody un-widened, to be replayed at
 * half its beat. Do not restore a width guard here: the version gate already
 * does the job, and a width cannot tell the two shapes apart.
 *
 * This whole chain runs BEFORE sanitizeContent (parseProjectFile in
 * projectFile.ts) and must never be moved into or after it: asLeadNoteMatrix —
 * the guard sanitizeLoops reads through — returns `undefined` for the v1 string
 * shape rather than throwing, so an un-upgraded body would fall back to the
 * default and come back with a blank melody and no error.
 * =========================================================================== */

/**
 * v3 -> v4: every loop gains the pad/drone layer's eight fields, with the pad
 * MUTED — a project written before the layer existed must reopen sounding the
 * way it sounded when it was closed.
 *
 * Shares only defaultPadState() with the persist chain's migratePadLayer, and
 * must not be refactored into one function with it: a project body is an
 * external contract, the persist payload is private localStorage shape, and
 * their version numbers move for different reasons.
 */
function upgradePadLayerV4(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => ({
    ...loop,
    ...defaultPadState(),
    padMuted: true,
  }));
}

/**
 * v4 -> v5: every loop gains the `lowtom` and `crash` sequencer tracks, so a
 * reopened project can play the lowtom and crash rows its drum grids always
 * had. (This step shipped naming the row `tom`; Task 7 renamed the
 * INITIAL_SEQUENCER_TRACKS entry to `lowtom`, and this step tracks that name
 * because it only ever calls withDrumTracks against the current constant —
 * see upgradeDrumVoicesV6 below for the one-time rename a body that already
 * persisted a real `tom` row still needs.)
 *
 * Shares only the pure withDrumTracks transform with the persist chain's
 * migrateDrumTracks, and must not be refactored into one function with it: a
 * project body is an external contract, the persist payload is private
 * localStorage shape, and their version numbers move for different reasons.
 *
 * `loops` only. A project body has no top-level sequencerTracks — the content
 * set is PROJECT_CONTENT_KEYS and sequencerTracks is a per-loop field — so a
 * top-level branch here would be dead code claiming a key exists.
 *
 * INITIAL_SEQUENCER_TRACKS holds eleven canonical tracks. A project this app
 * wrote before v5 can only be missing the six that landed after it —
 * `lowtom`, `crash`, `rimshot`, `hitom`, `ride` and `bell` — and all six
 * canonical rows are authored with an empty bar
 * (INITIAL_SEQUENCER_TRACKS.filter((t) => !t.steps.some(Boolean)) is exactly
 * those six, evaluated, not counted by hand) — so it reopens sounding the way
 * it sounded when it was closed. That is a fact about those six rows, NOT
 * about withDrumTracks: it appends ANY missing canonical track, and the other
 * five carry factory beats (kick 4 active steps, snare 2, hihat 8, openhat 1,
 * clap 2). A hand-edited or truncated body missing more than those six is a
 * repair case and gets the factory rows back audibly — a playable kit is the
 * right answer there; silence is promised only for bodies this app wrote.
 */
function upgradeDrumTracksV5(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => ({
    ...loop,
    sequencerTracks: Array.isArray(loop.sequencerTracks)
      ? withDrumTracks(loop.sequencerTracks as SequencerTrack[])
      : loop.sequencerTracks,
  }));
}


/**
 * v5 -> v6: the drum kit is renamed end to end, in a project body. At this
 * commit that is two shape changes over the seven-voice roster (rename +
 * kit rename); Task 8 grows the same roster to eleven and this step then
 * also appends the four new voices, with no further version bump.
 *
 * The same pure transforms as the persist chain's migrateDrumVoices, in the
 * same order — renameDrumTrack before withDrumTracks before recolourDrumTracks
 * last, as defence in depth, not because the reverse of the first two is
 * unsafe: see renameDrumTrack's own docblock in initialState.ts, whose
 * blank-target repair branch makes those two orders produce byte-identical
 * output. Deliberately NOT the same function as migrateDrumVoices: a project body is
 * an external contract, the persist payload is private localStorage shape,
 * and their version numbers move for different reasons.
 *
 * `loops` only. A project body has no top-level sequencerTracks — the content
 * set is PROJECT_CONTENT_KEYS and sequencerTracks is a per-loop field — so a
 * top-level branch here would be dead code claiming a key exists.
 *
 * A project this app wrote reopens sounding the way it sounded when it was
 * closed: the renamed row keeps its steps, 'Club Standard' is the same kit
 * object '909 Modern' was, a later task's appended rows are empty, and a
 * colour is not a sound.
 */
function upgradeDrumVoicesV6(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => {
    const rekitted = renameSoundKit(loop, '909 Modern', 'Club Standard');
    if (!Array.isArray(rekitted.sequencerTracks)) return rekitted;
    const tracks = rekitted.sequencerTracks as SequencerTrack[];
    const shaped = withDrumTracks(renameDrumTrack(tracks, 'tom', 'lowtom'));
    return { ...rekitted, sequencerTracks: recolourDrumTracks(shaped) };
  });
}

export function migrateProjectBody(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...raw };
  if (fromVersion < 2) next = upgradeLeadNotesV2(next);
  if (fromVersion < 3) next = upgradeLeadTicksV3(next);
  if (fromVersion < 4) next = upgradePadLayerV4(next);
  if (fromVersion < 5) next = upgradeDrumTracksV5(next);
  // 7, not 6, for the same reason the persist chain guards on 15: a project
  // saved part-way through the drum slice carries a formatVersion whose upgrade
  // had not yet learned the four new voices. The step is idempotent, so
  // re-running it completes those bodies and is a no-op for every other.
  if (fromVersion < 7) next = upgradeDrumVoicesV6(next);
  return next;
}
