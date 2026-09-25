import { ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { SCALES } from '@/data/scales';
import { KEY_OPTIONS, formatKeyLabel, getTonicSpelling } from '@/utils/noteSpelling';
import { HEADER_FIELD_SHELL, HEADER_SELECT } from '@/components/ui/fieldClasses';
import { ScaleTypeOptions } from '@/components/ui/ScaleTypeOptions';

/**
 * The dropdown trigger inside its field box: a content-box `h-8`, the
 * `select-sm` height of the selects in the boxes beside it, so the padding and
 * border land on top exactly as theirs do.
 */
const SCALE_TRIGGER =
  'box-content h-8 cursor-pointer list-none select-none text-xs font-bold hover:bg-base-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

interface ScaleSelectsProps {
  idPrefix: string;
  stacked?: boolean;
}

/**
 * The two master scale selects. They render twice — inline from `xl` up, and
 * inside a dropdown below it — so each instance takes its own id prefix rather
 * than duplicating ids into the DOM (the hidden copy is still rendered).
 */
export function ScaleSelects({
  idPrefix,
  stacked,
}: ScaleSelectsProps) {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const setScaleRoot = useAppStore((s) => s.setScaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);

  return (
    <>
      <select
        id={`${idPrefix}-root`}
        value={scaleRoot}
        onChange={(e) => setScaleRoot(e.target.value)}
        // `w-*`, never `min-w-*`: a min-width keeps the select from ever
        // shrinking, which is what makes HEADER_SELECT's ellipsis unreachable.
        // The widths are tuned against how much room the navbar has; a name
        // too long for one ellipsises and stays whole in `title`. The dropdown
        // copy is `w-full`, where there is room for all of it.
        className={`${HEADER_SELECT} text-primary ${stacked ? 'w-full' : 'w-18'}`}
        title="Root Note"
      >
        {KEY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        id={`${idPrefix}-type`}
        value={scaleType}
        onChange={(e) => setScaleType(e.target.value)}
        className={`${HEADER_SELECT} text-base-content/80 ${stacked ? 'w-full' : 'w-36'}`}
        title="Scale Type"
      >
        <ScaleTypeOptions />
      </select>
    </>
  );
}

/** The master key/scale group: an inline field from `xl` up, a dropdown below it. */
export function ScaleMenu() {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  return (
    <>
      {/* Scale Picker Compact (Desktop >= xl) */}
      <div className={`hidden xl:flex ${HEADER_FIELD_SHELL}`}>
        <ScaleSelects idPrefix="select-master-scale" />
      </div>

      {/* Below `xl` (mobile and landscape/portrait tablet): Compact Scale Picker Dropdown */}
      {/* Right-aligned (`dropdown-end`): the 224px panel hangs left from the
          trigger's right edge. Below `md` the trigger sits at the right end of
          the mobile top bar, beside the menu button, so a centred panel ran
          ~31px off a 375px phone; from `md` up the trigger sits far enough
          right in the desktop header for the same alignment to clear. */}
      <details className="dropdown dropdown-end xl:hidden">
        {/* The trigger wears the navbar's field box (`HEADER_FIELD_SHELL`) around
            a select-height row, so it stands the same height as the loop picker
            or project name beside it, at every width it shows. */}
        <summary
          id="btn-scale-dropdown"
          className={`${HEADER_FIELD_SHELL} ${SCALE_TRIGGER}`}
          title={`Key & Scale — ${formatKeyLabel(scaleRoot, scaleType, { long: true })}`}
        >
          <span className="text-primary">{getTonicSpelling(scaleRoot, scaleType)}</span>
          {/* Dropped below 390px — the width at which brand + this group
              stop sharing one row and the navbar grows a third one. The
              cut is `max-[390px]` rather than `sm` so the 390px+ phones
              that DO fit keep the scale name; narrower ones keep the root
              note, the full name in the `title`, and both selects one tap
              away in the dropdown. */}
          <span className="text-[10px] text-base-content/70 max-w-12 truncate max-[390px]:hidden">
            {SCALES[scaleType]?.abbr ?? scaleType}
          </span>
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        </summary>
        <div className="dropdown-content z-50 mt-1 w-56 p-2.5 flex flex-col gap-2 bg-base-100 border border-base-300 rounded-box shadow-xl">
          <div className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider px-1">
            Master Key & Scale
          </div>
          <ScaleSelects idPrefix="select-master-scale-compact" stacked />
        </div>
      </details>
    </>
  );
}
