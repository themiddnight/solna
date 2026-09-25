import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
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

/** A `data-option-index` attribute as an option index, or `null` when it names no option. */
export function parseOptionIndex(raw: string | null | undefined, count: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
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

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(id, active))?.scrollIntoView({ block: 'nearest' });
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
      if (index !== null) setActive(index);
    },
    [model],
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
