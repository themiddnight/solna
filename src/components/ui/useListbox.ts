import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { ListboxGroup, ListboxOption } from './Listbox';
import { isCommandChord, listboxKey } from './listboxKeys';

/** An option with its flat index across every group: the index its id and the highlight use. */
export interface IndexedOption extends ListboxOption {
  index: number;
}

export interface IndexedGroup {
  label: string;
  options: readonly IndexedOption[];
}

interface IndexedListbox {
  groups: readonly IndexedGroup[];
  /** Every option's value, in flat order. */
  values: readonly string[];
  /** Every option's label, in flat order (type-ahead reads these). */
  labels: readonly string[];
}

/** An option's DOM id: from its flat index, never its value — scale keys contain spaces. */
export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

/** A group heading's DOM id, referenced by the group's `aria-labelledby`. */
export function groupHeadingId(listboxId: string, groupIndex: number): string {
  return `${listboxId}-grp-${groupIndex}`;
}

/** Numbers every option across groups, in order. */
export function indexGroups(groups: readonly ListboxGroup[]): IndexedListbox {
  const values: string[] = [];
  const labels: string[] = [];
  const indexed = groups.map((group) => ({
    label: group.label,
    options: group.options.map((option) => {
      values.push(option.value);
      labels.push(option.label);
      return { ...option, index: values.length - 1 };
    }),
  }));
  return { groups: indexed, values, labels };
}

/** Where the highlight starts: the selected option, or the first when the value is not an option; none in an empty list. */
export function activeForValue(values: readonly string[], value: string): number {
  if (values.length === 0) return -1;
  return Math.max(0, values.indexOf(value));
}

/**
 * The highlight after `value` may have changed. While `value` stands, the
 * highlight is the user's (arrows, Home/End, type-ahead, hover) and is kept.
 * When `value` changed from outside, it re-seeds onto the new value's option.
 * A commit also changes `value`, onto the option already highlighted, so the
 * re-seed lands where the highlight already is.
 */
export function nextActive(prevValue: string, value: string, active: number, values: readonly string[]): number {
  return prevValue === value ? active : activeForValue(values, value);
}

/** A `data-option-index` attribute as an option index, or `null` when it names no option. */
export function parseOptionIndex(raw: string | null | undefined, count: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
}

/**
 * The listbox's own `scrollTop` that brings an option fully into view, or the
 * current one when it already shows. Only the listbox's scroll box moves:
 * `scrollIntoView` would also scroll every ancestor, including the app's
 * `overflow-hidden` root on a short screen, with no way to scroll it back.
 * `option.top` is measured from the top of the scroll content.
 */
export function revealScrollTop(
  box: { scrollTop: number; height: number },
  option: { top: number; height: number },
): number {
  if (option.top < box.scrollTop) return option.top;
  const bottom = option.top + option.height;
  if (bottom > box.scrollTop + box.height) return bottom - box.height;
  return box.scrollTop;
}

/** The option row under an event target (clicks and hover are delegated to the listbox root). */
function optionIndexAt(target: EventTarget, count: number): number | null {
  if (!(target instanceof Element)) return null;
  return parseOptionIndex(target.closest('[data-option-index]')?.getAttribute('data-option-index'), count);
}

export interface UseListbox {
  groups: readonly IndexedGroup[];
  /** The highlighted flat index, `-1` in an empty list. */
  active: number;
  /** The highlighted option's id for `aria-activedescendant`. */
  activeId: string | undefined;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
}

interface ListboxOptions {
  id: string;
  groups: readonly ListboxGroup[];
  value: string;
  onCommit: (value: string) => void;
}

/**
 * `ui/Listbox`'s logic (R357). Focus stays on the listbox root; the
 * highlight is `aria-activedescendant`. Keys go through `listboxKey`, and a
 * handled key is kept from the page's `window` shortcuts, so type-ahead never
 * plays a note. Hover moves the highlight; a click or Enter/Space commits.
 */
export function useListbox({ id, groups, value, onCommit }: ListboxOptions): UseListbox {
  const model = useMemo(() => indexGroups(groups), [groups]);
  const [active, setActive] = useState(() => activeForValue(model.values, value));
  // "Adjusting state during render", not an effect: the re-seeded highlight
  // paints in the same frame as the new value. Guarded by the comparison, so
  // it runs once per value change and never loops.
  const [seededValue, setSeededValue] = useState(value);
  if (seededValue !== value) {
    setSeededValue(value);
    setActive(nextActive(seededValue, value, active, model.values));
  }

  // Hover already points at a visible row; scrolling under the pointer would
  // make the list jump, so only keyboard and initial moves reveal.
  const revealRef = useRef(true);

  useEffect(() => {
    const reveal = revealRef.current;
    revealRef.current = true;
    if (active < 0 || !reveal) return;
    const option = document.getElementById(optionId(id, active));
    const box = document.getElementById(id);
    if (!option || !box) return;
    const boxRect = box.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    box.scrollTop = revealScrollTop(
      { scrollTop: box.scrollTop, height: box.clientHeight },
      { top: optionRect.top - boxRect.top - box.clientTop + box.scrollTop, height: optionRect.height },
    );
  }, [id, active]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (isCommandChord(e)) return;
      const next = listboxKey({ active, labels: model.labels }, e.key);
      if (!next.handled) return;
      e.preventDefault();
      e.stopPropagation();
      setActive(next.active);
      if (next.commit) onCommit(model.values[next.active]);
    },
    [active, model, onCommit],
  );

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const index = optionIndexAt(e.target, model.values.length);
      if (index === null) return;
      setActive(index);
      onCommit(model.values[index]);
    },
    [model, onCommit],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const index = optionIndexAt(e.target, model.values.length);
      if (index === null || index === active) return;
      revealRef.current = false;
      setActive(index);
    },
    [model, active],
  );

  return {
    groups: model.groups,
    active,
    activeId: active >= 0 ? optionId(id, active) : undefined,
    onKeyDown,
    onClick,
    onPointerMove,
  };
}
