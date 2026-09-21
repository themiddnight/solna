import type { DrumPad } from '@/types';

/**
 * The pads as the grid shows and plays them: each pad's velocity is the
 * slider's in-flight DRAFT if one is being dragged, else the persisted
 * OVERRIDE from the ui slice, else the pad's own `DEFAULT_PADS` volume. Keyed
 * by pad id, which is the Beat voice id. A pad with nothing overriding it is
 * handed back as the same object, so an unchanged pad keeps its identity.
 */
export function padsWithVelocities(
  defaults: readonly DrumPad[],
  overrides: Readonly<Partial<Record<string, number>>>,
  draft: Readonly<Partial<Record<string, number>>>,
): DrumPad[] {
  return defaults.map((pad) => {
    const volume = draft[pad.id] ?? overrides[pad.id];
    return volume === undefined || volume === pad.volume ? pad : { ...pad, volume };
  });
}
