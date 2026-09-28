import React, { useId, useRef } from 'react';
import { Play, Square, X } from 'lucide-react';
import { IconButton } from './IconButton';
import type { PlayerState } from '@/store/types';

/** What a press of the main button does. */
type TransportMainAction = 'play' | 'softStop' | 'hardStop';

export interface TransportButtons {
  main: {
    icon: 'play' | 'stop';
    label: string;
    title: string;
    className: string;
    disabled: boolean;
    action: TransportMainAction;
    /**
     * What a press does beyond the label, for assistive tech and touch:
     * joined into the button's `aria-describedby`, since a caller's own
     * description outranks `title`. null when the label says it all.
     */
    hint: string | null;
  };
  hard: { disabled: boolean };
}

/**
 * Pure state -> button appearance mapping, exported so the behaviour can be
 * tested without rendering React (the repo has no DOM test setup).
 *
 * `hard.disabled` is decided by the CALLER for aggregate transports — see
 * isAnyPlayerActive in transportSlice.ts, which deliberately does not follow
 * the aggregate state. This default covers the single-player case.
 */
export function resolveTransportButtons(state: PlayerState): TransportButtons {
  switch (state) {
    case 'playing':
      return {
        main: {
          icon: 'stop',
          label: 'Stop',
          title: 'Stop',
          className: 'btn-warning',
          disabled: false,
          action: 'softStop',
          hint: null,
        },
        hard: { disabled: false },
      };
    case 'stopping':
      return {
        // Live, not disabled (UX F-06): a second press while the tail rings out
        // means "stop now", so it hard-stops — the same action as the X beside it.
        main: {
          icon: 'stop',
          label: 'Stopping…',
          title: 'Stopping… — press again to stop immediately',
          className: 'btn-warning animate-pulse',
          disabled: false,
          action: 'hardStop',
          hint: 'Press again to stop immediately',
        },
        hard: { disabled: false },
      };
    default:
      return {
        main: {
          icon: 'play',
          label: 'Play',
          title: 'Play',
          className: 'btn-success',
          disabled: false,
          action: 'play',
          hint: null,
        },
        hard: { disabled: true },
      };
  }
}

/**
 * How long after this button soft-stopped a press may hard-stop. The stopping
 * button is live (UX F-06), so without a window the second click of a
 * double-click — or a double-tap, since the viewport disables double-tap zoom —
 * hard-stopped at once and the bar-line soft stop was lost.
 */
export const HARD_STOP_ARM_MS = 300;

/**
 * Whether a main-button press at `now` runs `action`. Only a hard stop is ever
 * held back, and only inside HARD_STOP_ARM_MS of the soft stop this same
 * button made (`softStopAt`, null when stopping began some other way). Both
 * times are event timestamps, so they share a clock.
 */
export function isPressArmed(action: TransportMainAction, softStopAt: number | null, now: number): boolean {
  if (action !== 'hardStop' || softStopAt === null) return true;
  return now - softStopAt >= HARD_STOP_ARM_MS;
}

/**
 * The main button's text-label classes. The label is icon-only below the
 * breakpoint EXCEPT while stopping (UX F-06): play and stop read from their
 * icons, but a soft stop's ringing tail showed only a grey pulsing square on
 * the phone, which read as a stuck button. A class, not a viewport read (R315).
 */
export function transportLabelClass(state: PlayerState, compact: boolean): string {
  if (state === 'stopping') return 'inline';
  return compact ? 'hidden lg:inline' : 'hidden sm:inline';
}

/**
 * The main button's press and description wiring: which handler a press runs,
 * the hard-stop arm window (HARD_STOP_ARM_MS), and the hint joined into
 * `aria-describedby` while stopping.
 */
function useMainButton(
  main: TransportButtons['main'],
  handlers: Pick<PlayerTransportProps, 'onPlay' | 'onSoftStop' | 'onHardStop' | 'describedBy'>,
) {
  const { action, hint } = main;
  const onMain =
    action === 'play' ? handlers.onPlay : action === 'softStop' ? handlers.onSoftStop : handlers.onHardStop;
  // When THIS button last soft-stopped: a hard stop arms HARD_STOP_ARM_MS later.
  const softStopAt = useRef<number | null>(null);
  const onMainClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isPressArmed(action, softStopAt.current, e.timeStamp)) return;
    softStopAt.current = action === 'softStop' ? e.timeStamp : null;
    onMain?.();
  };
  const hintId = useId();
  const description = [handlers.describedBy, hint === null ? undefined : hintId].filter(Boolean).join(' ');
  return {
    onMainClick,
    // A transport with no hard-stop handler keeps the old inert stopping button.
    mainDisabled: main.disabled || onMain === undefined,
    hintId,
    description: description === '' ? undefined : description,
  };
}

export interface PlayerTransportProps {
  state: PlayerState;
  onPlay: () => void;
  onSoftStop: () => void;
  onHardStop?: () => void;
  /** Render the hard-stop button. Header transports omit it by design. */
  showHardStop?: boolean;
  /** Overrides the derived hard-stop disabled state (aggregate transports). */
  hardStopDisabled?: boolean;
  size?: 'xs' | 'sm';
  /** Hide the text label on narrow viewports; the icon always shows. */
  compact?: boolean;
  id?: string;
  /**
   * Omit the component's own `.join` wrapper and render the buttons as a
   * fragment instead. Their `join-item` class then applies directly to a
   * *direct child* of the caller's own `.join` element, which is required
   * for daisyUI's join-item sibling selectors (`:not(:first-child)` etc.)
   * to fire — a nested `.join` inside a `.join` is not a documented
   * pattern and produces a visible border seam. Use when placing this
   * component inside another `.join` (e.g. Header's tab+transport groups).
   */
  unwrapped?: boolean;
  showLabel?: boolean;
  /**
   * Id of an element (e.g. a play-target label) whose text describes what
   * this transport's main button will start. Forwarded as `aria-describedby`
   * so assistive tech reaches that text even where it is visually hidden or
   * lives outside this component. Optional so no other call site changes.
   */
  describedBy?: string;
}

export function PlayerTransport({
  state,
  onPlay,
  onSoftStop,
  onHardStop,
  showHardStop = false,
  hardStopDisabled,
  size = 'sm',
  compact = false,
  id,
  unwrapped = false,
  showLabel = false,
  describedBy,
}: PlayerTransportProps) {
  const buttons = resolveTransportButtons(state);
  const MainIcon = buttons.main.icon === 'play' ? Play : Square;
  const sizeClass = size === 'xs' ? 'btn-xs' : 'btn-sm';
  const { hint } = buttons.main;
  const { onMainClick, mainDisabled, hintId, description } = useMainButton(buttons.main, {
    onPlay,
    onSoftStop,
    onHardStop,
    describedBy,
  });
  const buttonsMarkup = (
    <>
      <button
        id={id}
        type="button"
        onClick={onMainClick}
        disabled={mainDisabled}
        title={buttons.main.title}
        aria-describedby={description}
        className={`btn ${sizeClass} join-item gap-1.5 font-bold text-xs ${buttons.main.className}`}
      >
        <MainIcon className="w-3.5 h-3.5 fill-current shrink-0" />
        {showLabel && (
          <span className={transportLabelClass(state, compact)}>
            {buttons.main.label}
          </span>
        )}
        {/* `hidden` keeps it out of the button's name; aria-describedby still
            reads a hidden element. Inside the button so no extra child lands
            in the caller's `.join`. */}
        {hint !== null && (
          <span id={hintId} hidden>
            {hint}
          </span>
        )}
      </button>

      {showLabel && showHardStop && (
        <IconButton
          id={id ? `${id}-hard` : undefined}
          label="Stop immediately"
          icon={<X className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
          size={size}
          variant="error"
          onClick={onHardStop}
          disabled={hardStopDisabled ?? buttons.hard.disabled}
          className="join-item font-bold text-xs"
        />
      )}
    </>
  );

  if (unwrapped) return buttonsMarkup;

  return <div className="join">{buttonsMarkup}</div>;
}
