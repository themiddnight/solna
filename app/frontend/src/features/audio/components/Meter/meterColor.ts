import type { MeterZone } from "@/shared/audio/meterZones";

// Fixed per-zone colors, NOT a gradient painted on the fill element — this is the fix for the
// "bar tip is red at every level" bug: the fill's color is chosen ONCE from the current peak's
// zone, not from a gradient that rescales with the fill's width.
export function meterColorForZone(zone: MeterZone): string {
  switch (zone) {
    case "tooQuiet":
      return "var(--color-base-content-30, #9ca3af)";
    case "good":
      return "var(--color-success, #22c55e)";
    case "hot":
      return "var(--color-warning, #eab308)";
    case "over":
      return "var(--color-error, #ef4444)";
  }
}
