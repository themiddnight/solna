/**
 * Lookups, grouping and application over SYNTH_PRESETS.
 *
 * Every export here is a COMPUTATION, which is why none of it lives in
 * src/data/. It sits in src/utils/ rather than src/audio/ because nothing in
 * it touches the engine: a preset is store data, and the audio layer is only
 * one of its readers. This module is the one definition — the `presetRegistry`
 * that used to re-export it from `src/audio/` is gone.
 */
import type { ActiveSynth, ArpSettings } from '../types/synth';
import type {
  SynthPreset,
  SynthPresetCategory,
  SynthPresetCategoryMeta,
} from '../data/synthPresets';
import { SYNTH_CATEGORIES, SYNTH_PRESETS } from '../data/synthPresets';

/**
 * Load a preset onto a track: the preset's engine and its COMPLETE patch,
 * plus the Arp the caller was already holding.
 *
 * Two things this deliberately does not do. It does not merge over a current
 * patch — the old `applyPreset(base, preset)` spread a `Partial` onto the live
 * params, so a preset that omitted a field inherited whatever the last one
 * set, and no two orders of selection gave the same sound. And it does not
 * choose an Arp: Arp is performance state, so it is threaded THROUGH rather
 * than produced, which is what makes "a preset never re-arms the arpeggiator"
 * a property of the signature instead of a rule callers must remember.
 *
 * The patch is cloned. The library is module-scope literal data and a loaded
 * patch is about to be edited by knobs; handing back the array inside
 * `SYNTH_PRESETS` would let one drag rewrite the factory entry for the rest of
 * the session.
 */
export function applySynthPreset(
  currentArp: ArpSettings,
  preset: SynthPreset,
): { activeSynth: ActiveSynth; arpSettings: ArpSettings } {
  return {
    activeSynth: {
      engine: preset.engine,
      patch: structuredClone(preset.patch),
      sourcePresetId: preset.id,
    },
    arpSettings: currentArp,
  };
}

export function getAllSynthPresets(custom: SynthPreset[]): SynthPreset[] {
  return [...custom, ...SYNTH_PRESETS];
}

/**
 * Built once at module load, exactly like PROGRESSIONS_BY_ID in
 * audio/chordProgressions.ts. A linear `find` over the whole factory library
 * ran four to five times per vibe apply (three voices plus an optional pad),
 * plus once at boot for every track default in store/initialState.ts.
 */
const PRESETS_BY_ID = new Map(SYNTH_PRESETS.map((p) => [p.id, p]));

/**
 * Library reference resolution: id -> preset. Ids are stable and are
 * referenced by the Instant Vibes table and by the track defaults in
 * store/initialState.ts.
 *
 * They do NOT reach a .solna body: a loop stores a resolved `ActiveSynth`, and
 * the `sourcePresetId` it carries is display provenance the readers treat as
 * optional. The only preset id that persists as an identity at all is a
 * user-authored `user-preset-<timestamp>-<rand>` inside `customSynthPresets`,
 * which is in `partialize` but not in PROJECT_CONTENT_KEYS.
 */
export function presetById(id: string): SynthPreset<'subtractive'> | undefined {
  if (!id) return undefined;
  return PRESETS_BY_ID.get(id);
}

/**
 * The neutral patch every fallback lands on.
 *
 * It lives HERE, beside the library it comes out of, and not in
 * `store/initialState.ts` where the per-track defaults live: `src/audio/` may
 * not import `src/store/`, and the engine's own fixtures need a known-good
 * patch to build voices from. A preset id is the library's business; which
 * preset a new PROJECT starts each track on is the store's.
 *
 * Manually switching engine loads the target engine's init preset, which is
 * why the id is exported and not only its resolved value.
 */
export const SUBTRACTIVE_INIT_PRESET_ID = 'factory-subtractive-init';

/**
 * Resolve a factory preset into an `ActiveSynth` at module load.
 *
 * THROWS on an unresolvable id, deliberately. Every other unknown-id path in
 * the app falls back to a track default, but the values built with this ARE
 * the defaults: the only thing left to fall back to would be a second literal
 * patch body, which is exactly what the preset cutover deleted. A data test
 * pins that no id used here can go missing, so the throw is unreachable rather
 * than lurking.
 *
 * Cloned, so a module-scope default can never ALIAS the library entry it came
 * from. Without it, one in-place write through `TRACK_SYNTH_DEFAULTS` would
 * edit the factory preset for the rest of the session, and every assertion
 * comparing the two would go on passing because they are the same object.
 */
export function resolveFactorySynth(id: string): ActiveSynth<'subtractive'> {
  const preset = presetById(id);
  if (!preset) {
    throw new Error(`unknown factory synth preset id: ${id}`);
  }
  return { engine: preset.engine, patch: structuredClone(preset.patch), sourcePresetId: preset.id };
}

export const SUBTRACTIVE_INIT: ActiveSynth<'subtractive'> = resolveFactorySynth(
  SUBTRACTIVE_INIT_PRESET_ID,
);

export function findPresetByName(
  name: string,
  presets: SynthPreset[],
): SynthPreset | undefined {
  if (!name) return undefined;
  return presets.find((p) => p.name === name);
}

export interface CategoryPresetGroup {
  category: SynthPresetCategory;
  label: string;
  badgeClass: string;
  description: string;
  presets: SynthPreset[];
}

/**
 * Organizes presets into structured categories ('Bass', 'Lead', 'Pad',
 * 'Keys', 'Pluck', 'Brass', 'FX', 'User') instead of a single flat list.
 *
 * 'User' is the odd one and always last: it holds every CUSTOM preset
 * whatever category it was saved under, so a patch saved as a Lead is still
 * findable under Custom rather than hiding among 30 factory leads.
 */
export function groupPresets(allPresets: SynthPreset[]): CategoryPresetGroup[] {
  // Derived from the table, never re-typed. `order` is typed
  // `SynthPresetCategory[]`, so a hand-written list that misses a category is
  // legal TypeScript — and every preset in the missed one would then vanish
  // from the only source the `<optgroup>` picker and the Pro drawer read,
  // while still existing, resolving and playing. `SYNTH_CATEGORIES` already
  // declares them in display order, which is what `getCategoryMeta` below
  // reads them out of.
  const order = SYNTH_CATEGORIES.map((meta) => meta.id);
  const groups: CategoryPresetGroup[] = [];

  for (const cat of order) {
    // Same lookup, same fallback as a lone category badge: getCategoryMeta is
    // the one place the unknown-category default is written.
    const meta = getCategoryMeta(cat);

    const matching = allPresets.filter((p) => {
      if (cat === 'User') {
        return !p.isFactory || p.category === 'User';
      }
      return p.isFactory && p.category === cat;
    });

    if (matching.length > 0) {
      groups.push({
        category: cat,
        label: cat === 'User' ? `Custom / Saved (${matching.length})` : `${meta.label} (${matching.length})`,
        badgeClass: meta.badgeClass,
        description: meta.description,
        presets: matching,
      });
    }
  }

  return groups;
}

export function getCategoryMeta(category: SynthPresetCategory): SynthPresetCategoryMeta {
  return (
    SYNTH_CATEGORIES.find((c) => c.id === category) ?? {
      id: category,
      label: category,
      shortLabel: category,
      badgeClass: 'badge badge-ghost',
      description: '',
    }
  );
}
