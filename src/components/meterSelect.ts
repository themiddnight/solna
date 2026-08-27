import { METERS, METER_IDS, getMeter, isMeterId, type MeterId } from '../utils/meter';

/**
 * Option model for the transport meter select, kept out of TransportBar.tsx so
 * it can be tested without rendering React (this repo has no DOM test setup).
 */
export interface MeterOption {
  value: MeterId;
  label: string;
  title: string;
}

export const METER_OPTIONS: MeterOption[] = METER_IDS.map((value) => {
  const meter = METERS[value];
  const grouping = meter.accentGroups.join('+');
  return {
    value,
    label: meter.label,
    title: `${meter.label} — ${meter.stepsPerBar} steps per bar, beats of ${grouping}`,
  };
});

/**
 * A `<select>` hands back a raw string. Guard it: an unknown value would reach
 * the clock, and falling back to the CURRENT meter (rather than to 4/4) means a
 * stale DOM value can never silently reset the user's time signature.
 */
export function coerceMeterChoice(raw: string, current: MeterId): MeterId {
  return isMeterId(raw) ? raw : current;
}


/**
 * A pattern's meter tag against the active transport meter.
 *
 * `patternMeter` is optional because RhythmPattern.meter and BassPattern.meter
 * are — inline test literals omit it. `getMeter` resolves undefined to the 4/4
 * row, which is exactly what playback does, so an untagged pattern reads as 4/4
 * here and sounds as 4/4 there.
 */
export function isMeterMismatch(
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): boolean {
  return getMeter(patternMeter).id !== getMeter(activeMeter).id;
}

/** `'4/4'` when it matches the active meter, `'4/4 → 6/8'` when it does not. */
export function patternMeterLabel(
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): string {
  const native = getMeter(patternMeter);
  const active = getMeter(activeMeter);
  return !isMeterMismatch(patternMeter, activeMeter)
    ? native.label
    : `${native.label} → ${active.label}`;
}

/**
 * The visible `<option>` text. Every pattern stays listed and selectable in
 * every meter — the user keeps the freedom to run a 4/4 pattern in 6/8 — and the
 * label is what stops the result being a surprise.
 */
export function patternOptionLabel(
  name: string,
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): string {
  return `${name} · ${patternMeterLabel(patternMeter, activeMeter)}`;
}

/**
 * The `<option title>` explaining what adaptation will actually do. THREE cases,
 * not two: a longer source bar is trimmed, a shorter one is looped, and a source
 * bar of the SAME length in a different meter is neither — it is re-grouped.
 * 3/4 and 6/8 are both 12 steps and differ only in accentGroups, which is the
 * whole reason bar length alone is not a sufficient tag.
 */
export function patternMeterTitle(
  name: string,
  patternMeter: MeterId | undefined,
  activeMeter: MeterId,
): string {
  const native = getMeter(patternMeter);
  const active = getMeter(activeMeter);
  if (!isMeterMismatch(patternMeter, activeMeter)) {
    return `${name} — written in ${native.label}, the active meter`;
  }
  if (native.stepsPerBar === active.stepsPerBar) {
    return `${name} — written in ${native.label}; same ${native.stepsPerBar}-step bar, re-grouped as ${active.accentGroups.join('+')}`;
  }
  const verb = native.stepsPerBar > active.stepsPerBar ? 'trimmed' : 'looped';
  return `${name} — written in ${native.label}; ${verb} to fill a ${active.label} bar of ${active.stepsPerBar} steps`;
}
