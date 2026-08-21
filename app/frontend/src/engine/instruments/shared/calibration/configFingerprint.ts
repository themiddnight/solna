import { createHash } from "node:crypto";

/** Recursively sort object keys so JSON.stringify output is order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // JSON.stringify(undefined) returns undefined, not a string; coerce it to ensure type contract
    return String(JSON.stringify(value));
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Hashes the parts of an instrument's config that affect its measured loudness (soundfont
 * asset reference, envelope/ADSR values, any gain-affecting provider params) — NOT
 * presentation fields like label/icon. A mismatch between this and the committed table's
 * stored hash (Task 10) means the instrument was edited since it was last calibrated.
 */
export function hashInstrumentConfig(input: {
  instrumentId: string;
  loudnessRelevantConfig: unknown;
}): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}
