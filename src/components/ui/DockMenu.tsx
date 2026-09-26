import type { ReactNode } from 'react';
import { Popup } from './Popup';
import { usePopupMenu } from './usePopupMenu';

/** The panel's box, the look the CSS-only dropdown's list wore. */
const DOCK_MENU_PANEL = 'mb-1 w-36 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg';

const listId = (idPrefix: string) => `${idPrefix}-list`;

interface DockMenuListProps<T extends string> {
  options: readonly T[];
  current: T;
  /** The list is `${idPrefix}-list`; each item is `${idPrefix}-${option}`. */
  idPrefix: string;
  labels: Readonly<Record<T, string>>;
  titles?: Readonly<Record<T, string>>;
  onPick: (option: T) => void;
}

/**
 * A dock menu's items: one button per option, the current one marked. Not
 * `role="menu"` — that promises arrow-key navigation this list does not
 * have; Tab reaches each button, as it always has.
 */
export function DockMenuList<T extends string>({ options, current, idPrefix, labels, titles, onPick }: DockMenuListProps<T>) {
  return (
    <ul id={listId(idPrefix)} className="menu menu-sm w-full p-0">
      {options.map((option) => (
        <li key={option}>
          <button
            id={`${idPrefix}-${option}`}
            type="button"
            aria-current={current === option ? 'true' : undefined}
            onClick={() => onPick(option)}
            className={current === option ? 'active font-bold' : ''}
            title={titles?.[option]}
          >
            {labels[option]}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface DockMenuProps<T extends string> extends DockMenuListProps<T> {
  triggerId: string;
  triggerLabel: string;
  triggerTitle: string;
  triggerClassName: string;
  /** Locked: the trigger is disabled and an open menu shuts (R341's armed lock). */
  disabled?: boolean;
  /** The trigger's visible content. */
  children: ReactNode;
}

/**
 * A dock header menu (the target chip, the keyboard mode chip) on `ui/Popup`
 * (R328). It opens upward, over the dock, from the trigger's start edge, and
 * a pick closes it. The wrapper is `flex` so a trigger inside a `join` keeps
 * the group's height.
 */
export function DockMenu<T extends string>({
  triggerId,
  triggerLabel,
  triggerTitle,
  triggerClassName,
  disabled = false,
  children,
  onPick,
  ...list
}: DockMenuProps<T>) {
  const menu = usePopupMenu(onPick, disabled);
  return (
    <Popup
      open={menu.open}
      onClose={menu.close}
      align="start"
      side="top"
      className="flex"
      panelClassName={DOCK_MENU_PANEL}
      trigger={
        <button
          type="button"
          id={triggerId}
          aria-label={triggerLabel}
          aria-expanded={menu.open}
          aria-controls={listId(list.idPrefix)}
          disabled={disabled}
          onClick={menu.toggle}
          className={triggerClassName}
          title={triggerTitle}
        >
          {children}
        </button>
      }
    >
      <DockMenuList {...list} onPick={menu.pick} />
    </Popup>
  );
}
