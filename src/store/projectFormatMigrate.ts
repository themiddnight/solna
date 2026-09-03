/**
 * The `.solna` format migration chain. Separate from the persist chain in
 * store.ts on purpose (see projectFormat.ts): a project file is an external
 * contract, the persist payload is private. Empty at v1 — the structure exists
 * so adding v2 does not mean inventing it under pressure.
 *
 * Each step must be pure and a no-op on an already-current payload. Add steps
 * as `if (fromVersion < 2) next = addSomething(next);` in version order.
 */
export function migrateProjectBody(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  void fromVersion; // no steps yet
  return { ...raw };
}
