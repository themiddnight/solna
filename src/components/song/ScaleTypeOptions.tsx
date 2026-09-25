import { SCALES } from '@/data/scales';
import { SCALE_GROUPS } from '@/components/ui/scaleGroups';

/**
 * The scale-type `<option>`s for a native `<select>`, one `<optgroup>` per
 * category. The value is the persisted SCALES key; the text is the display
 * name. The key-change dialog's scale select: a pick inside a `Modal` stays
 * native (R327); the header's scale type is `header/ScaleTypeListbox`.
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
