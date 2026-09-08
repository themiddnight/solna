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
import { mergeDrumKit } from '@/audio/drumKits';
import { applyPreset } from '@/audio/presetRegistry';
import { DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';
import type { SynthPresetItem } from '@/data/synthPresets';
import { INITIAL_SYNTH_PARAMS } from '@/store/initialState';

/**
 * `reverbSend` only feeds the drum reverb send, and the calibration render zeroes
 * `reverbGain` — so it cannot move a measurement and must not fire the lock test.
 * Applied per voice, inside `drumLoudnessHash`'s whole-kit hash, below.
 * `DRUM_KITS[name].reference` is not here because it is not part of a voice's
 * params at all: it lives on the DRUM_KITS entry type, deliberately off `DrumKit`,
 * and `triggerDrum` never reads it.
 */
export const DRUM_HASH_EXCLUDED = ['reverbSend'] as const;

/**
 * `preset` is a display name. The four arp fields drive a SCHEDULER above the
 * engine: the calibration pattern triggers notes directly, the arpeggiator never
 * runs, and it cannot change what one triggered note sounds like. Everything else
 * in SynthParams is in — including lfoTarget/lfoRate/lfoDepth (the 'volume' target
 * is literally a tremolo gain) and octave (pitch, therefore K-weighted energy).
 */
export const SYNTH_HASH_EXCLUDED = ['preset', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves'] as const;

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
 * Hashes the WHOLE kit — every voice, folded into one fingerprint — because the
 * kit is what a single measurement now covers: `DRUM_TRIMS` is keyed by kit name,
 * not voice (see src/data/trimTable.ts), and the reference pattern that measures
 * a kit plays several voices together. Retuning ANY voice in the kit must fire
 * the lock test for that kit, so no voice may be measured, or hashed, alone.
 *
 * Consequence worth knowing before treating a hash mismatch as drift: the hash
 * can move while `measuredDbfs` does not. `DRUM_KIT_BAR` (renderOffline.ts) only
 * plays kick, snare and hihat — retuning a voice the pattern never sounds (e.g.
 * `ride.gain`) moves that kit's hash here (correctly: the config changed) but a
 * regeneration reproduces the identical `measuredDbfs`, because the render never
 * exercised the changed voice. That is safe and intended, not a harness bug —
 * `bun run check:levels` should expect and report it as "hash moved, measurement
 * unchanged" rather than as a discrepancy.
 */
export function drumLoudnessHash(kitName: string): string {
  const partial = DRUM_KITS[kitName];
  if (!partial) throw new Error(`No such drum kit: ${kitName}`);
  // The MERGED kit, not the partial: a change to DEFAULT_DRUM_KIT changes what
  // a partial kit actually renders as, and must fire.
  const merged = mergeDrumKit(partial) as unknown as Record<string, Record<string, unknown>>;
  const voices: Record<string, unknown> = {};
  for (const voice of DRUM_TYPES) {
    voices[voice] = omit(merged[voice]!, DRUM_HASH_EXCLUDED);
  }
  return hashLoudnessConfig({ kit: kitName, voices });
}

export function presetLoudnessHash(preset: SynthPresetItem): string {
  // The RESOLVED params, for the same reason: a change to INITIAL_SYNTH_PARAMS
  // changes what a partial preset renders as.
  const params = applyPreset(INITIAL_SYNTH_PARAMS, preset) as unknown as Record<string, unknown>;
  return hashLoudnessConfig({ preset: preset.id, params: omit(params, SYNTH_HASH_EXCLUDED) });
}
