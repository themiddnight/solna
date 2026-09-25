import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx';
import { groupHeadingId, optionId, useListbox, type IndexedGroup, type IndexedOption } from './useListbox';

export interface ListboxOption {
  value: string;
  label: string;
  /** One line under the label; wraps, never truncates. */
  description?: string;
}

export interface ListboxGroup {
  label: string;
  options: readonly ListboxOption[];
}

interface ListboxProps {
  id: string;
  /** The listbox's accessible name (`aria-label`). */
  label: string;
  groups: readonly ListboxGroup[];
  /** The committed value; its option is `aria-selected` and checked. */
  value: string;
  /** Called on Enter, Space or a click — never on an arrow key or hover. */
  onCommit: (value: string) => void;
  /** Classes for the root, which is also the scroll box (`max-h-*`, `overflow-y-auto`). */
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Matches the "Master Key & Scale" heading's look. */
const GROUP_HEADING = 'px-2 pt-2 pb-1 text-[11px] uppercase font-bold tracking-wider text-base-content/60';
const ROW = 'flex items-center gap-2 px-2 py-1.5 rounded-field cursor-pointer';
const ROOT = 'rounded-box focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

interface ListboxRowProps {
  listboxId: string;
  option: IndexedOption;
  active: boolean;
  selected: boolean;
}

function ListboxRow({ listboxId, option, active, selected }: ListboxRowProps) {
  return (
    <div
      id={optionId(listboxId, option.index)}
      role="option"
      aria-selected={selected}
      data-option-index={option.index}
      className={cx(ROW, active && 'bg-base-200')}
    >
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm font-medium', selected && 'text-primary')}>{option.label}</div>
        {option.description && <div className="text-xs text-base-content/70">{option.description}</div>}
      </div>
      {selected && <Check className="w-4 h-4 shrink-0 text-primary" />}
    </div>
  );
}

interface ListboxSectionProps {
  listboxId: string;
  group: IndexedGroup;
  groupIndex: number;
  active: number;
  value: string;
}

function ListboxSection({ listboxId, group, groupIndex, active, value }: ListboxSectionProps) {
  const headingId = groupHeadingId(listboxId, groupIndex);
  return (
    <div role="group" aria-labelledby={headingId}>
      <div id={headingId} className={GROUP_HEADING}>{group.label}</div>
      {group.options.map((option) => (
        <ListboxRow
          key={option.value}
          listboxId={listboxId}
          option={option}
          active={option.index === active}
          selected={option.value === value}
        />
      ))}
    </div>
  );
}

/**
 * The one custom listbox (R357): grouped options with an optional
 * description line, a check on the selected one, `aria-activedescendant`
 * focus and explicit commit. Clicks and hover are delegated to the root, so
 * DOM focus never leaves it.
 */
export function Listbox({ id, label, groups, value, onCommit, className, ref }: ListboxProps) {
  const listbox = useListbox({ id, groups, value, onCommit });
  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={listbox.activeId}
      onKeyDown={listbox.onKeyDown}
      onClick={listbox.onClick}
      onPointerMove={listbox.onPointerMove}
      className={cx(ROOT, className)}
    >
      {listbox.groups.map((group, groupIndex) => (
        <ListboxSection
          key={group.label}
          listboxId={id}
          group={group}
          groupIndex={groupIndex}
          active={listbox.active}
          value={value}
        />
      ))}
    </div>
  );
}
