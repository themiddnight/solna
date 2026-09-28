import React from 'react';
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
        main: { icon: 'stop', label: 'Stop', title: 'Stop', className: 'btn-warning', disabled: false, action: 'softStop' },
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
        },
        hard: { disabled: false },
      };
    default:
      return {
        main: { icon: 'play', label: 'Play', title: 'Play', className: 'btn-success', disabled: false, action: 'play' },
        hard: { disabled: true },
      };
  }
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
  const { action } = buttons.main;
  const onMain = action === 'play' ? onPlay : action === 'softStop' ? onSoftStop : onHardStop;
  // A transport with no hard-stop handler keeps the old inert stopping button.
  const mainDisabled = buttons.main.disabled || onMain === undefined;
  const buttonsMarkup = (
    <>
      <button
        id={id}
        type="button"
        onClick={onMain}
        disabled={mainDisabled}
        title={buttons.main.title}
        aria-describedby={describedBy}
        className={`btn ${sizeClass} join-item gap-1.5 font-bold text-xs ${buttons.main.className}`}
      >
        <MainIcon className="w-3.5 h-3.5 fill-current shrink-0" />
        {showLabel && (
          <span className={transportLabelClass(state, compact)}>
            {buttons.main.label}
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
