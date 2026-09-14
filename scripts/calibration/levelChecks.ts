/**
 * The four questions `check:levels` and the lock test both ask. One
 * implementation, two front doors, so they can never disagree.
 *
 * Every one of them reads the COMMITTED table and recomputes hashes from current
 * data. None renders audio and none spawns ffmpeg: this must stay milliseconds,
 * because it is on the `bun run verify` critical path and the generator that
 * produced the table is not.
 *
 * The two halves are no longer symmetric in what they APPLY: a kit's trim is the
 * committed `trimDb`, resolved by name at `setDrumKit`; a preset's is
 * `patch.common.outputGainDb`, inside the patch itself, so the committed entry
 * records only the measurement and its provenance. `TrimDomain.appliedDb` is
 * where that difference lives, and it is the only place it does.
 *
 * DEV-387 design change: `DRUM_TRIMS` is keyed by drum KIT, not by kit+voice — a
 * drum kit's voices are not independent, so one measurement and one trim cover
 * the whole kit (see the comment on `DRUM_TRIMS` in src/data/trimTable.ts). Every
 * collector below therefore iterates kits, never kit->voice.
 */
import { DRUM_KITS } from '@/data/drumKits';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { DRUM_TRIMS, PRESET_TRIMS, type TrimEntry } from '@/data/trimTable';
import { toDbfs, toDecibels } from '@/utils/gainUnits';
import { isWithinTolerance } from '@/utils/trimMath';
import { drumLoudnessHash, presetLoudnessHash } from './loudnessConfig.ts';

export interface LevelFinding {
  id: string;
  detail: string;
}

const REGENERATE = 'run `bun run calibration:generate`';

/**
 * The two halves of every check, stated once. Each collector below asks its one
 * question of both — so the drum half and the preset half cannot answer it
 * differently, which is what four hand-written pairs allowed: the same question
 * was implemented twice per check, with wording that had already drifted apart.
 *
 * `noun` is what a message calls the thing. It is per-domain rather than baked
 * into a message because a finding naming the wrong noun ("a kit that no longer
 * exists" against a preset id) reads as a harness bug and sends the reader to
 * the wrong table — the point of these messages is that a human acts on them.
 *
 * `liveIds` is a function, not a precomputed array: it is the LIVE data's answer
 * at call time, and the whole reason the collectors walk it rather than the
 * committed table (see `findMissingEntries`).
 */
interface TrimDomain {
  noun: string;
  /**
   * The committed table for this half, read through a function rather than
   * captured: `DRUM_TRIMS`/`PRESET_TRIMS` are live ESM bindings, and the lock
   * test swaps the whole module for an empty one (Ruling 8's vacuity guard). A
   * table captured once at module init would keep pointing at the real one and
   * make that test pass against data it was never given.
   */
  trims: () => Record<string, TrimEntry>;
  /** Ids that exist in today's data, whether or not the table knows them. */
  liveIds: () => string[];
  /** Recomputes the loudness-config hash for a live id from current data. */
  hashOf: (id: string) => string;
  /**
   * The dB that is ACTUALLY applied on top of `measuredDbfs`, or null when
   * nothing live claims the id.
   *
   * The two halves answer this from different places, and that asymmetry is
   * the whole shape of the synth-engine change: a kit's trim is a measured
   * number this table owns and `setDrumKit` resolves by name, while a
   * preset's is `patch.common.outputGainDb` — inside the patch, so a patch a
   * user edits, saves or exports carries its own calibration. Reading the
   * table's `trimDb` for a preset would check a number nothing applies.
   *
   * null for a committed entry no live id claims: there is no applied gain to
   * combine, and an orphan is `findOrphanEntries`' finding, not this one's.
   */
  appliedDb: (id: string, entry: TrimEntry) => number | null;
}

/** Live presets by id, so a domain's `hashOf` is a lookup rather than a scan. */
const PRESETS_BY_ID = new Map(SYNTH_PRESETS.map((preset) => [preset.id, preset]));

const TRIM_DOMAINS: readonly TrimDomain[] = [
  {
    noun: 'kit',
    trims: () => DRUM_TRIMS,
    liveIds: () => Object.keys(DRUM_KITS),
    hashOf: (id) => drumLoudnessHash(id),
    // A kit's trim is applied by name (`setDrumKit` -> `drumTrimGainFor`), so
    // the table IS the live value and an orphan entry is still self-checkable.
    appliedDb: (_id, entry) => entry.trimDb,
  },
  {
    noun: 'preset',
    trims: () => PRESET_TRIMS,
    liveIds: () => [...PRESETS_BY_ID.keys()],
    // Only ever called with an id `liveIds` just produced, so the lookup cannot miss.
    hashOf: (id) => presetLoudnessHash(PRESETS_BY_ID.get(id)!),
    appliedDb: (id) => PRESETS_BY_ID.get(id)?.patch.common.outputGainDb ?? null,
  },
];

/**
 * Ruling 8: the empty table is indistinguishable from "never generated" — an
 * empty `DRUM_TRIMS`/`PRESET_TRIMS` has no marker saying so. A collector that
 * only diffs the entries PRESENT against the live config would pass vacuously
 * on `{}`, which guards nothing. This walks every LIVE kit and preset instead,
 * so an empty (or partially-emptied) table fails loudly, for the right reason.
 */
export function findMissingEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  for (const domain of TRIM_DOMAINS) {
    for (const id of domain.liveIds()) {
      if (!domain.trims()[id]) {
        findings.push({ id, detail: `no committed entry — ${REGENERATE}` });
      }
    }
  }
  return findings;
}

export function findOrphanEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  for (const domain of TRIM_DOMAINS) {
    const live = new Set(domain.liveIds());
    for (const id of Object.keys(domain.trims())) {
      if (!live.has(id)) {
        findings.push({
          id,
          detail: `entry for a ${domain.noun} that no longer exists — ${REGENERATE}`,
        });
      }
    }
  }
  return findings;
}

/**
 * A subtlety worth knowing before reading a mismatch as wrong: the hash can
 * move while the measurement would not. `drumLoudnessHash` fingerprints every
 * voice in the kit, but the shared reference pattern (`DRUM_KIT_BAR`) only ever
 * plays kick, snare and closed hihat — so retuning e.g. `ride.gain` moves the
 * kit's hash (correctly: the config changed) even though regenerating would
 * reproduce the identical `measuredDbfs`. That is intended, not a harness bug:
 * the hash is deliberately broader than the pattern it is meant to guard.
 */
export function findDriftedEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  for (const domain of TRIM_DOMAINS) {
    for (const id of domain.liveIds()) {
      const entry = domain.trims()[id];
      if (!entry) continue; // findMissingEntries owns this case
      if (domain.hashOf(id) !== entry.configHash) {
        findings.push({
          id,
          detail: `a loudness-affecting param changed since it was calibrated — ${REGENERATE}`,
        });
      }
    }
  }
  return findings;
}

/**
 * "Does the measurement, plus the gain that is actually applied on top of it,
 * land on target" — where `domain.appliedDb` is what "actually applied" means
 * for each half, and they differ (see its docblock).
 *
 * A hand-edited or corrupted table, not an unusual patch: a kit needing more
 * than the +/-12 dB fader range still PASSES here, because its trim is honoured
 * (the engine applies it directly, not through a fader) and so
 * `measuredDbfs + trimDb` still lands at TARGET_DBFS. The fader-range flag is
 * a generator-time advisory for a human, not a tolerance failure — it does not
 * live here.
 *
 * For a preset this is the ONLY gate on `common.outputGainDb`, since that field
 * is deliberately outside the config hash: an authored gain that leaves the
 * patch outside the band fails here, in milliseconds, with no render.
 */
export function findOutOfToleranceEntries(): LevelFinding[] {
  const findings: LevelFinding[] = [];
  // The COMMITTED entries, not the live ids: this asks whether the measurement
  // and the applied gain agree, which an entry that has drifted out of range
  // fails whether or not anything else in the table is wrong.
  for (const domain of TRIM_DOMAINS) {
    for (const [id, entry] of Object.entries(domain.trims())) {
      const appliedDb = domain.appliedDb(id, entry);
      // Nothing live applies a gain for this id — findOrphanEntries' finding.
      if (appliedDb === null) continue;
      if (!isWithinTolerance(toDbfs(entry.measuredDbfs), toDecibels(appliedDb))) {
        findings.push({
          id,
          detail: `${entry.measuredDbfs.toFixed(1)} dBFS + ${appliedDb.toFixed(1)} dB lands outside the band`,
        });
      }
    }
  }
  return findings;
}
