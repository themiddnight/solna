/**
 * Lookups, merges and groupings over SYNTH_PRESETS. Every export here is a
 * computation, which is why none of it lives in src/data/.
 */
import type {
  SynthPresetCategory,
  SynthPresetCategoryMeta,
  SynthPresetItem,
} from '@/data/synthPresets';
import { SYNTH_CATEGORIES, SYNTH_PRESETS } from '@/data/synthPresets';
import type { SynthParams } from '../types';

/**
 * Load a preset over a base patch. The three call sites (SynthView's preset
 * picker, the audition preview, and instantVibes' library resolver) all wrote
 * this same three-line spread, and all three overwrite `params.preset` with the
 * preset's name — which is why no preset needs to carry its own name in params.
 */
export function applyPreset(base: SynthParams, preset: SynthPresetItem): SynthParams {
  return { ...base, ...preset.params, preset: preset.name };
}

export function getAllSynthPresets(custom: SynthPresetItem[]): SynthPresetItem[] {
  return [...custom, ...SYNTH_PRESETS];
}

/**
 * Built once at module load, exactly like PROGRESSIONS_BY_ID in
 * audio/chordProgressions.ts. A linear `find` over the whole factory library
 * ran four to five times per vibe apply (three voices plus an optional pad),
 * plus once at boot for the resolved-at-boot bass default in
 * store/initialState.ts.
 */
const PRESETS_BY_ID = new Map(SYNTH_PRESETS.map((p) => [p.id, p]));

/**
 * Library reference resolution: id -> preset. Ids are stable and are referenced
 * by the Instant Vibes table and by the two resolved-at-boot defaults in
 * store/initialState.ts.
 *
 * They do NOT reach a .solna body: a loop stores resolved SynthParams, not a
 * preset id, and the only preset id that persists at all is a user-authored
 * `user-preset-<timestamp>-<rand>` inside `customSynthPresets`, which is in
 * `partialize` but not in PROJECT_CONTENT_KEYS. This comment used to claim
 * otherwise; the claim was false and is how a constraint that belongs to
 * nothing spreads.
 */
export function presetById(id: string): SynthPresetItem | undefined {
  if (!id) return undefined;
  return PRESETS_BY_ID.get(id);
}

export function findPresetByName(
  name: string,
  presets: SynthPresetItem[],
): SynthPresetItem | undefined {
  if (!name) return undefined;
  return presets.find((p) => p.name === name);
}

export interface CategoryPresetGroup {
  category: SynthPresetCategory;
  label: string;
  badgeClass: string;
  description: string;
  presets: SynthPresetItem[];
}

/**
 * Organizes presets into structured categories ('Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Brass', 'FX', 'User')
 * instead of a single flat list.
 */
export function getPresetsGroupedByCategory(allPresets: SynthPresetItem[]): CategoryPresetGroup[] {
  const order: SynthPresetCategory[] = ['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Brass', 'FX', 'User'];
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
