import { SCALES, SCALE_CATEGORIES, type ScaleCategory } from '@/data/scales';

/**
 * Each scale category with its SCALES keys, in display order. Shared by the
 * native `ScaleTypeOptions` (the key-change dialog) and the header's scale
 * listbox, so it lives in `ui/` (R276). Built once: SCALES is static content.
 */
export const SCALE_GROUPS: readonly { category: ScaleCategory; keys: readonly string[] }[] = SCALE_CATEGORIES.map(
  (category) => ({
    category,
    keys: Object.keys(SCALES).filter((key) => SCALES[key].category === category),
  }),
);
