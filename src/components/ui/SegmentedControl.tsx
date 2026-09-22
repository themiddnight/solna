import React from 'react';
import { focusForSegment, segmentForFocus } from '@/store/focusTrack';
import { useLiveStore } from './useLiveStore';
import { PATTERN_SEGMENTS } from '../viewMeta';
import { HEADER_GROUP } from './fieldClasses';

/**
 * The chrome's segmented control: a `join` of icon+label buttons where exactly
 * one is current.
 *
 * Two of them exist — Pattern's Lead/Accompaniment/Beat row (`viewControls`)
 * and the Sound tab's depth switch (`actions`) — and they render through the
 * same shared card, `viewControls` and `actions` apart: the depth switch used
 * to sit in `viewControls` too, before Sound's focus chips took that slot and
 * put depth on the opposite side (see `ui/ViewHeader.tsx`). They were two
 * copies of one class string in two files, which is a match held by
 * coincidence: the next padding or active-colour tweak would have landed on
 * whichever file the author opened.
 *
 * It lives in `ui/` rather than beside the nav in `Header.tsx` because
 * `ui/SegmentHeader` renders one of them, and a `ui/` primitive reaching back
 * into the app shell for it pulled the whole navbar module graph — LoopSelector,
 * SCALES, noteSpelling — into every importer, with an import cycle one render
 * away. `HEADER_GROUP` is what keeps it in visual step with the tab bar and the
 * layer switcher, and that token already lives here.
 *
 * `TabButton` deliberately stays its own thing: it carries a different padding
 * ramp (`px-2 sm:px-2.5 xl:px-3`) because the tab bar has to survive widths the
 * header card never sees.
 */
const SEGMENTED_BUTTON =
  'btn btn-sm join-item shrink min-w-0 px-2 sm:px-3 gap-1 sm:gap-1.5 text-xs font-bold';

/** The one place selected-vs-not is spelled for a segmented button. */
function segmentedButtonClass(active: boolean): string {
  return `${SEGMENTED_BUTTON} ${active ? 'btn-active btn-primary' : 'btn-ghost'}`;
}

export interface SegmentedGroupProps {
  children: React.ReactNode;
}

/**
 * The `join` shell the tab bar and the layer switcher also wear. `max-w-full`
 * caps HEADER_GROUP's `shrink-0` at its container, so on a 320px phone the
 * buttons (`min-w-0`, labels `truncate`) shrink instead of running off it.
 */
export function SegmentedGroup({ children }: SegmentedGroupProps) {
  return <div className={`${HEADER_GROUP} inline-flex items-center max-w-full`}>{children}</div>;
}

export interface SegmentedButtonProps {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onSelect: () => void;
  /** Defaults to `label`; Simple/Pro says "Simple Mode" instead. */
  title?: string;
}

export function SegmentedButton({
  id,
  icon: Icon,
  label,
  active,
  onSelect,
  title,
}: SegmentedButtonProps) {
  return (
    <button
      id={id}
      type="button"
      // BOTH, and they answer different questions. `aria-current` says which
      // view the app is showing — what the tab bar and the layer switcher use,
      // and what Header.test.tsx pins. `aria-pressed` says whether THIS button
      // is the selected one, which is the only cue a screen-reader user gets
      // for a mutually-exclusive selector whose selected state is otherwise
      // carried by `btn-active` colour alone. Without it the Sound tab's
      // Simple/Pro switcher announced neither option as chosen.
      aria-current={active ? 'page' : undefined}
      aria-pressed={active}
      aria-label={label}
      onClick={onSelect}
      className={segmentedButtonClass(active)}
      title={title ?? label}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Pattern's three segments.
 *
 * It is RENDERED by PatternView, not by Header: the spec puts the row on its
 * own line under the vibes bar, and mounting it inside the branch that already
 * gates on `activeTab === 'pattern'` makes "only on Pattern" structural rather
 * than a second comparison that could disagree with the first.
 *
 * Unlike TabButton the labels are never hidden. There are only three of them
 * and they carry the whole of the user's sense of where they are inside the
 * tab; the tab buttons can afford icon-only below `xl` because the view header
 * underneath repeats the name, and here the view header IS per segment.
 */
export function PatternSegmentRow() {
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);
  const activeSegment = segmentForFocus(focusTrack);

  return (
    <SegmentedGroup>
      {PATTERN_SEGMENTS.map(({ id, label, icon }) => (
        <SegmentedButton
          key={id}
          id={`segment-${id}`}
          icon={icon}
          label={label}
          active={activeSegment === id}
          // `accompaniment` always sends `chord` — see focusForSegment for why
          // there is deliberately no memory of which of the three was last
          // used. Consequence, on the record: focus `pad`, go to Beat, press
          // Accompaniment and you land on `chord`, not `pad`. That is one
          // click, and all three grids are on screen either way.
          onSelect={() => setFocusTrack(focusForSegment(id))}
        />
      ))}
    </SegmentedGroup>
  );
}
