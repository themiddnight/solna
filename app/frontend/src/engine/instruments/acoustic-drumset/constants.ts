import type { Instrument } from "@/shared/types";

import { ACOUSTIC_DRUM_KITS } from "./acousticDrumKits";

export { DEFAULT_ACOUSTIC_DRUMSET_ID } from "./acousticDrumKits";

/**
 * The selectable acoustic drum sets, derived from the kit registry so a new kit
 * appears in the UI/catalog by adding a config entry (DEV-282) — no edits here.
 */
export const ACOUSTIC_DRUMSET_INSTRUMENTS: Instrument[] = Object.values(
  ACOUSTIC_DRUM_KITS,
).map((kit) => ({
  value: kit.id,
  label: kit.label,
  defaultControlType: kit.controlType,
  icon: kit.icon,
}));
