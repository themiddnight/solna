/**
 * A content key for a loop list's ids, and its inverse. The mirrored per-loop
 * field write in loopSync rebuilds the whole `loops` array (and re-spreads
 * every loop object) on every knob/fader change to the active loop, so keying
 * ArrangeView's sortable id list on the array's IDENTITY rebuilds that list at
 * pointer rate — and dnd-kit re-renders every card through context as a
 * result. Keying on the id CONTENT instead means the list only changes when
 * membership or ordering actually does.
 *
 * Separator safety: ids come only from DEFAULT_LOOP_ID ('loop-default-1',
 * store/loopSlice.ts) and newLoopId() (`loop-${Date.now()}-${base36}`,
 * store/loop.ts) — lowercase alphanumerics and '-', never user-authored, so a
 * newline cannot appear inside one.
 */
const SEPARATOR = '\n';

export function loopIdKeyOf(loops: readonly { id: string }[]): string {
  let key = '';
  for (let i = 0; i < loops.length; i++) {
    if (i > 0) key += SEPARATOR;
    key += loops[i].id;
  }
  return key;
}

export function loopIdsFromKey(key: string): string[] {
  return key === '' ? [] : key.split(SEPARATOR);
}
