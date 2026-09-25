/**
 * The keyboard half of `ui/Listbox` (R357), pure so it can be tested
 * without a DOM. Arrows, Home, End and type-ahead only move the highlight;
 * a value commits on Enter or Space (or a click, handled in `useListbox`).
 * Browsing never writes: the header's scale commit re-renders the app and
 * can reharmonize.
 */

/** What `listboxKey` reads: the highlighted flat index (`-1` = none) and every option's label, in flat order. */
export interface ListboxKeyState {
  active: number;
  labels: readonly string[];
}

/** What a key does to the listbox. */
export interface ListboxKeyResult {
  /** The highlighted flat index after the key. */
  active: number;
  /** Commit the option at `active`. */
  commit: boolean;
  /**
   * The listbox owns this key: the caller prevents its default (arrows and
   * Space would scroll) and stops it reaching the page's note and transport
   * shortcuts, which listen on `window`.
   */
  handled: boolean;
}

const OPEN_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

function moved(active: number): ListboxKeyResult {
  return { active, commit: false, handled: true };
}

/** The next label after `active` that starts with `char`, wrapping; `active` itself last. No match keeps `active`. */
function typeAhead(labels: readonly string[], active: number, char: string): number {
  const needle = char.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (active + step) % labels.length;
    if (labels[index].toLowerCase().startsWith(needle)) return index;
  }
  return active;
}

/**
 * One key against the listbox. Arrows move one option and stop at the ends
 * (no wrap, as in a native select); Home/End jump; Enter and Space commit;
 * a printable single character jumps to the next label starting with it
 * (case-insensitive, wrapping). Space is `' '` — a printable character — so
 * it is matched before type-ahead and always commits. Any other key is not
 * handled. An empty list handles nothing.
 */
export function listboxKey(state: ListboxKeyState, key: string): ListboxKeyResult {
  const { active, labels } = state;
  const last = labels.length - 1;
  if (last < 0) return { active: -1, commit: false, handled: false };
  switch (key) {
    case 'ArrowDown':
      return moved(Math.min(active + 1, last));
    case 'ArrowUp':
      return moved(Math.max(active - 1, 0));
    case 'Home':
      return moved(0);
    case 'End':
      return moved(last);
    case 'Enter':
    case ' ':
      return { active, commit: active >= 0 && active <= last, handled: true };
    default:
      break;
  }
  if (key.length !== 1) return { active, commit: false, handled: false };
  return moved(typeAhead(labels, active, key));
}

/** The keys that open a listbox from its trigger button. */
export function isOpenKey(key: string): boolean {
  return OPEN_KEYS.has(key);
}

/**
 * A key held with Ctrl, Meta or Alt is a browser or OS command (Cmd+R,
 * Ctrl+F), never type-ahead: the listbox leaves it alone. Shift is not a
 * command — Shift+M is just an upper-case M.
 */
export function isCommandChord(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}
