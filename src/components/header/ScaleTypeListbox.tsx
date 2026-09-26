import type { KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { SCALES } from '@/data/scales';
import { Listbox } from '@/components/ui/Listbox';
import { Popup } from '@/components/ui/Popup';
import { SCALE_LISTBOX_GROUPS } from './scaleListboxGroups';
import { useScaleTypeListbox } from './useScaleTypeListbox';

/**
 * Matches the ghost `select-sm` it replaced (`HEADER_SELECT`): 32px tall,
 * bold 12px text, a chevron at the end, and ONE fixed width (`w-36`, never a
 * `min-w-*`) so the name ellipsises instead of pushing the navbar.
 */
const SCALE_TYPE_TRIGGER =
  'flex items-center justify-between gap-1 w-36 h-8 ps-3 pe-2 rounded-field text-xs font-bold text-base-content/80 cursor-pointer hover:bg-base-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** `p-1.5` leaves room for the listbox's 2px focus outline at its 2px offset. */
const PANEL = 'mt-1 w-80 max-w-[calc(100vw-1rem)] p-1.5 bg-base-100 border border-base-300 rounded-box shadow-xl';

interface ScaleTypeTriggerProps {
  name: string;
  open: boolean;
  onToggle: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

function ScaleTypeTrigger({ name, open, onToggle, onKeyDown }: ScaleTypeTriggerProps) {
  return (
    <button
      type="button"
      id="btn-scale-type"
      className={SCALE_TYPE_TRIGGER}
      title={`Scale Type — ${name}`}
      // The visible text is only the name; the select this replaced was named "Scale Type".
      aria-label={`Scale Type: ${name}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="truncate">{name}</span>
      <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
    </button>
  );
}

/**
 * The master Scale Type from `xl` up: a trigger in place of the old native
 * select, opening a `Popup` whose `Listbox` shows each scale's name and
 * description by category. A commit closes it; so do Escape, an outside
 * click and tabbing away.
 */
export function ScaleTypeListbox() {
  const { scaleType, open, toggle, close, onTriggerKeyDown, listboxRef, onCommit } = useScaleTypeListbox();
  const name = SCALES[scaleType]?.name ?? scaleType;
  return (
    <Popup
      open={open}
      onClose={close}
      align="end"
      panelClassName={PANEL}
      initialFocusRef={listboxRef}
      trigger={<ScaleTypeTrigger name={name} open={open} onToggle={toggle} onKeyDown={onTriggerKeyDown} />}
    >
      <Listbox
        ref={listboxRef}
        id="listbox-master-scale-type"
        label="Scale Type"
        groups={SCALE_LISTBOX_GROUPS}
        value={scaleType}
        onCommit={onCommit}
        className="max-h-96 overflow-y-auto overscroll-contain"
      />
    </Popup>
  );
}
