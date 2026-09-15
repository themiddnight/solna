/**
 * What "this entry is still calibrated" means, in one place.
 *
 * The rule: a field is in the hash if changing it changes the K-weighted energy of
 * the rendered, DRY voice. `ebur128` is K-weighted, so pitch and filter fields are
 * spectral gain — a kick at 35 Hz and one at 60 Hz genuinely measure several dB
 * apart, and excluding them would let a real level change ship unmeasured.
 *
 * The two exclusion lists below are the whole argument, and they are short on
 * purpose: an over-broad hash fires on cosmetic edits and trains people to
 * regenerate without thinking, which is the failure mode this test exists to
 * prevent.
 *
 * Lives in scripts/ because it needs `node:crypto`; nothing in the bundle may.
 *
 * Canonical serialization, decided here so it never has to be re-decided per call
 * site:
 *  - Object keys are sorted recursively at every level, so two objects with the
 *    same contents in different key order (a reformat, a merge with a different
 *    spread order) hash identically.
 *  - Arrays are NOT key-sorted — order is significant content there — but each
 *    element is still canonicalized recursively.
 *  - A number is serialized via `JSON.stringify`, i.e. `Number.prototype.toString`
 *    under the hood. That format is pinned by the ECMAScript spec (the shortest
 *    round-tripping decimal), not by platform or libc, so the same double prints
 *    the same string on every machine this runs on.
 *  - `undefined` and a missing key hash the same: a key whose value is
 *    `undefined` is dropped before serializing, exactly like `JSON.stringify`
 *    already drops it in object position. That makes a partial that omits a
 *    field and a partial that sets it to `undefined` indistinguishable, which is
 *    the property `omit()` below relies on for the excluded-field lists.
 */
import { createHash } from 'node:crypto';
import { BEAT_PRESETS, BEAT_VOICE_IDS } from '@/data/beatPresets';
import type { SynthPreset } from '@/data/synthPresets';

/**
 * `reverbSend` only feeds the drum reverb send, and the calibration render zeroes
 * `reverbGain` — so it cannot move a measurement and must not fire the lock test.
 * Applied per voice, inside `beatLoudnessHash`'s whole-patch hash, below.
 * A preset's `reference` is not here because it is not part of a voice's params
 * at all: it sits on the FACTORY entry beside `patch`, and `triggerDrum` never
 * reads it.
 */
export const BEAT_HASH_EXCLUDED = ['reverbSend'] as const;

/**
 * One field, from `patch.common` — NOT from the top level, which is why
 * `presetLoudnessHash` omits it one level down rather than through the same
 * top-level `omit()` the drum half uses.
 *
 * The list used to hold the display name and the four arpeggiator fields,
 * because a flat `SynthParams` carried all five inside the thing being
 * measured. It no longer does: a name is a sibling of `patch`, not a field in
 * it, and Arp is performance state that never enters a patch at all.
 *
 * `outputGainDb` is here because it is the one field of an `EnginePatch` the
 * measurement provably cannot see: `renderPreset` neutralises it for the
 * uncalibrated pass (renderOffline.ts), so `measuredDbfs` is the same number
 * whatever it is set to. Hashing it would make retuning a preset's applied
 * gain demand a multi-minute regeneration that reproduced the identical
 * measurement — and would train people to regenerate without thinking, which
 * is exactly what the two short exclusion lists exist to prevent. Nothing is
 * left unguarded by the omission: `findOutOfToleranceEntries` reads
 * `outputGainDb` off the LIVE patch on every `check:levels` run, so a retune
 * that lands the preset outside the band fails in milliseconds instead.
 */
export const SYNTH_HASH_EXCLUDED = ['outputGainDb'] as const;

/** Recursively sort object keys so the digest is order-independent: a reformat of
 *  a data table must not read as a retune. Arrays keep their order — position is
 *  content there, not incidental structure. A key whose value is `undefined` is
 *  dropped, so an omitted field and a field explicitly set to `undefined` hash
 *  the same. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function hashLoudnessConfig(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function omit(source: Record<string, unknown>, excluded: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!excluded.includes(key)) kept[key] = source[key];
  }
  return kept;
}

/**
 * Hashes the WHOLE patch — every voice plus the bus filter, folded into one
 * fingerprint — because the patch is what a single measurement now covers:
 * `DRUM_TRIMS` is keyed by Beat preset id, not by voice (see src/data/trimTable.ts),
 * and the reference pattern that measures a preset plays several voices together.
 * Retuning ANY voice must fire the lock test for that preset, so no voice may be
 * measured, or hashed, alone.
 *
 * `outputTrimDb` is deliberately outside the hash, for the same reason
 * `common.outputGainDb` is on the synth half: the uncalibrated pass withholds it
 * (`renderBeatPreset` names the preset only when `applyTrim` is set), so it
 * provably cannot move `measuredDbfs`. Hashing it would make a retune demand a
 * multi-minute regeneration that reproduced the identical measurement. Nothing is
 * left unguarded: `findOutOfToleranceEntries` reads it off the live patch on every
 * `check:levels` run, and the lock test compares it with the table's `trimDb`.
 *
 * Consequence worth knowing before treating a hash mismatch as drift: the hash
 * can move while `measuredDbfs` does not. `DRUM_KIT_BAR` (renderOffline.ts) only
 * plays kick, snare and hihat — retuning a voice the pattern never sounds (e.g.
 * `ride.gain`) moves that preset's hash here (correctly: the config changed) but a
 * regeneration reproduces the identical `measuredDbfs`, because the render never
 * exercised the changed voice. That is safe and intended, not a harness bug —
 * `bun run check:levels` should expect and report it as "hash moved, measurement
 * unchanged" rather than as a discrepancy.
 */
export function beatLoudnessHash(presetId: string): string {
  const preset = BEAT_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`No such beat preset: ${presetId}`);
  const patch = preset.patch as unknown as { voices: Record<string, Record<string, unknown>> };
  const voices: Record<string, unknown> = {};
  for (const voice of BEAT_VOICE_IDS) {
    voices[voice] = omit(patch.voices[voice]!, BEAT_HASH_EXCLUDED);
  }
  return hashLoudnessConfig({ preset: presetId, filter: preset.patch.filter, voices });
}

export function presetLoudnessHash(preset: SynthPreset): string {
  // The patch as authored — there is no resolution step any more, because an
  // entry is complete. A preset's measured level therefore depends on that
  // entry alone, where it used to move whenever the shared flat defaults did.
  // `common` is rebuilt without the applied output gain; every other field of
  // both blocks is hashed. See SYNTH_HASH_EXCLUDED for why that one is out.
  const patch = {
    engine: preset.engine,
    ...preset.patch,
    common: omit(preset.patch.common as unknown as Record<string, unknown>, SYNTH_HASH_EXCLUDED),
  } as unknown as Record<string, unknown>;
  return hashLoudnessConfig({ preset: preset.id, params: patch });
}
