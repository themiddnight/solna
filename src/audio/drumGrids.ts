// Lookups over DRUM_GRIDS. Returns values built per call, which is why this
// cannot travel with the table.

import { DRUM_GRIDS, type DrumGrid } from '@/data/drumGrids';

/**
 * Look up an authored drum grid by library id.
 *
 * Returns a grid whose `rows` are a FRESH deep copy on every call — never the
 * module's own arrays. This ensures DRUM_GRIDS stays authoritative and
 * immutable: callers cannot mutate the library through a grid reference, and
 * `applyVibeToStore` writes the resolved rows straight into store state.
 * `resolveProgression` follows the same rule and also returns freshly built
 * objects every call.
 */
export function drumGridById(id: string): DrumGrid | undefined {
  const grid = DRUM_GRIDS[id];
  if (!grid) return undefined;
  const rows: Record<string, boolean[]> = {};
  for (const [row, steps] of Object.entries(grid.rows)) {
    rows[row] = [...steps];
  }
  return { ...grid, rows };
}
