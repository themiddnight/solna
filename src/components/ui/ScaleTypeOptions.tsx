import { SCALES, SCALE_CATEGORIES } from '@/data/scales';

/** Each category with its SCALES keys, in display order. Built once: SCALES is static content. */
const SCALE_GROUPS = SCALE_CATEGORIES.map((category) => ({
  category,
  keys: Object.keys(SCALES).filter((key) => SCALES[key].category === category),
}));

/**
 * The scale-type `<option>`s for a native `<select>`, one `<optgroup>` per
 * category. The value is the persisted SCALES key; the text is the display
 * name. Shared by the header's scale select and the key-change dialog's.
 */
export function ScaleTypeOptions() {
  return (
    <>
      {SCALE_GROUPS.map(({ category, keys }) => (
        <optgroup key={category} label={category}>
          {keys.map((key) => (
            <option key={key} value={key}>
              {SCALES[key].name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
