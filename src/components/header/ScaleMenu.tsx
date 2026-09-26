import type { RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { SCALES } from '@/data/scales';
import { KEY_OPTIONS, formatKeyLabel, getTonicSpelling } from '@/utils/noteSpelling';
import { HEADER_FIELD_SHELL, HEADER_SELECT } from '@/components/ui/fieldClasses';
import { Listbox } from '@/components/ui/Listbox';
import { Popup } from '@/components/ui/Popup';
import { SCALE_LISTBOX_GROUPS } from './scaleListboxGroups';
import { ScaleTypeListbox } from './ScaleTypeListbox';
import { useScaleMenu } from './useScaleMenu';

/**
 * The compact trigger inside its field box: a content-box `h-8`, the
 * `select-sm` height of the selects in the boxes beside it, so the padding and
 * border land on top exactly as theirs do.
 */
const SCALE_TRIGGER =
  'box-content h-8 cursor-pointer select-none text-xs font-bold hover:bg-base-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** `max-w` plus `popupShift` keep the 320px panel inside a 375px phone. */
const COMPACT_PANEL =
  'mt-1 w-80 max-w-[calc(100vw-1rem)] p-2.5 flex flex-col gap-2 bg-base-100 border border-base-300 rounded-box shadow-xl';

interface RootSelectProps {
  id: string;
  stacked?: boolean;
}

/** The master root note: a native select everywhere (R327). */
export function RootSelect({ id, stacked }: RootSelectProps) {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const setScaleRoot = useAppStore((s) => s.setScaleRoot);
  return (
    <select
      id={id}
      value={scaleRoot}
      onChange={(e) => setScaleRoot(e.target.value)}
      // `w-*`, never `min-w-*`: a min-width keeps the select from ever
      // shrinking, which is what makes HEADER_SELECT's ellipsis unreachable.
      // The panel copy is `w-full`, where there is room for all of it.
      className={`${HEADER_SELECT} text-primary ${stacked ? 'w-full' : 'w-18'}`}
      title="Root Note"
    >
      {KEY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface CompactTriggerProps {
  scaleRoot: string;
  scaleType: string;
  open: boolean;
  onToggle: () => void;
}

/**
 * The trigger wears the navbar's field box (`HEADER_FIELD_SHELL`) around a
 * select-height row, so it stands the same height as the loop picker or
 * project name beside it, at every width it shows.
 */
function CompactTrigger({ scaleRoot, scaleType, open, onToggle }: CompactTriggerProps) {
  return (
    <button
      type="button"
      id="btn-scale-dropdown"
      className={`${HEADER_FIELD_SHELL} ${SCALE_TRIGGER}`}
      title={`Key & Scale — ${formatKeyLabel(scaleRoot, scaleType, { long: true })}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="text-primary">{getTonicSpelling(scaleRoot, scaleType)}</span>
      {/* Dropped below 390px — the width at which brand + this group stop
          sharing one row and the navbar grows a third one. Narrower phones
          keep the root note, the full name in the `title`, and both pickers
          one tap away in the panel. */}
      <span className="text-[10px] text-base-content/70 max-w-12 truncate max-[390px]:hidden">
        {SCALES[scaleType]?.abbr ?? scaleType}
      </span>
      <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
    </button>
  );
}

interface ScaleMenuPanelProps {
  scaleType: string;
  listboxRef: RefObject<HTMLDivElement | null>;
  onCommit: (value: string) => void;
}

/** The compact panel's body: heading, native root select, then the scale listbox inline. */
export function ScaleMenuPanel({ scaleType, listboxRef, onCommit }: ScaleMenuPanelProps) {
  return (
    <>
      <div className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider px-1">
        Master Key & Scale
      </div>
      <RootSelect id="select-master-scale-compact-root" stacked />
      <Listbox
        ref={listboxRef}
        id="listbox-master-scale-type-compact"
        label="Scale Type"
        groups={SCALE_LISTBOX_GROUPS}
        value={scaleType}
        onCommit={onCommit}
        className="max-h-80 overflow-y-auto overscroll-contain"
      />
    </>
  );
}

/**
 * The master key/scale group: an inline field from `xl` up (root select +
 * scale-type listbox), a `Popup` panel below it. The panel hangs from the
 * trigger's right edge (`align="end"`): below `md` the trigger sits at the
 * right end of the mobile top bar, and `popupShift` pulls any overflow back.
 */
export function ScaleMenu() {
  const { scaleRoot, scaleType, open, toggle, close, listboxRef, onCommit } = useScaleMenu();
  return (
    <>
      <div className={`hidden xl:flex ${HEADER_FIELD_SHELL}`}>
        <RootSelect id="select-master-scale-root" />
        <ScaleTypeListbox />
      </div>
      <div className="xl:hidden">
        <Popup
          open={open}
          onClose={close}
          align="end"
          panelClassName={COMPACT_PANEL}
          initialFocusRef={listboxRef}
          trigger={<CompactTrigger scaleRoot={scaleRoot} scaleType={scaleType} open={open} onToggle={toggle} />}
        >
          <ScaleMenuPanel scaleType={scaleType} listboxRef={listboxRef} onCommit={onCommit} />
        </Popup>
      </div>
    </>
  );
}
