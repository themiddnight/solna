import { SCALES } from '@/data/scales';
import type { ListboxGroup } from '@/components/ui/Listbox';
import { SCALE_GROUPS } from '@/components/ui/scaleGroups';

/**
 * The scale library as listbox groups: the SCALES key is the value (the
 * persisted identity), the display name the label, the one-line mood/genre
 * line the description. Static content, built once. Its own module, not
 * `ScaleTypeListbox.tsx`: a non-component export beside a component stops
 * Vite's Fast Refresh from hot-swapping that file.
 */
export const SCALE_LISTBOX_GROUPS: readonly ListboxGroup[] = SCALE_GROUPS.map(({ category, keys }) => ({
  label: category,
  options: keys.map((key) => ({ value: key, label: SCALES[key].name, description: SCALES[key].description })),
}));
