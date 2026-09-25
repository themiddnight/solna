import { SCALES } from '@/data/scales';
import { SCALE_GROUPS } from '@/components/ui/scaleGroups';

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
