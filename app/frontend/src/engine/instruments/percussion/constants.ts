import type { Instrument } from "@/shared/types";

import { PERCUSSION_SETS } from "./percussionSets";

export { DEFAULT_PERCUSSION_SET_ID } from "./percussionSets";

/**
 * The selectable percussion sets, derived from the set registry so a new set
 * appears in the UI/catalog by adding a config entry (DEV-283) — no edits here.
 */
export const PERCUSSION_INSTRUMENTS: Instrument[] = Object.values(PERCUSSION_SETS).map(
  (set) => ({
    value: set.id,
    label: set.label,
    defaultControlType: set.controlType,
    icon: set.icon,
  }),
);
