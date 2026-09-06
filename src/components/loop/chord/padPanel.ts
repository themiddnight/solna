import { SCALES, getDiatonicChordForDegree } from '@/utils/musicTheory';
import type { CategoryPresetGroup } from '@/audio/synthPresets';

/**
 * One button per degree of the ACTIVE scale — five for Hirajoshi, seven for
 * Major. Labels come from getDiatonicChordForDegree, which already lower-cases
 * minor and diminished numerals.
 *
 * The active button is `selected % length`, matching the wrap the resolver
 * performs, so the highlight always shows the degree that is actually heard.
 * The stored value is never clamped here.
 */
export function droneDegreeButtons(
  scaleRoot: string,
  scaleType: string,
  selected: number,
): { index: number; label: string; active: boolean }[] {
  const scale = SCALES[scaleType] ?? SCALES.Major;
  const length = scale.intervals.length;
  const activeIndex = ((selected % length) + length) % length;
  return Array.from({ length }, (_, index) => ({
    index,
    label: getDiatonicChordForDegree(index, scaleRoot, scaleType, false).degreeName,
    active: index === activeIndex,
  }));
}

/**
 * The Pad preset <select>'s option groups: the curated `Pad` category, PLUS
 * whichever group holds the currently selected preset (if any), so the
 * control never falls back to its blank placeholder for a real, non-Pad
 * sound loaded onto the pad channel through AdjustSynthButton. A selection
 * already inside `Pad`, or one that resolves to no preset at all (including a
 * deleted custom preset), never adds a second copy of `Pad` or a phantom
 * group.
 */
export function padPresetGroups(
  groups: CategoryPresetGroup[],
  selectedPresetName: string,
): CategoryPresetGroup[] {
  return groups.filter(
    (g) =>
      g.category === 'Pad' ||
      (selectedPresetName !== '' &&
        g.presets.some((p) => p.name === selectedPresetName)),
  );
}
