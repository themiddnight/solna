import React from 'react';
import { Play, Square, X } from 'lucide-react';
import type { PlayerState } from '../../store/types';

export interface TransportButtons {
  main: {
    icon: 'play' | 'stop';
    label: string;
    className: string;
    disabled: boolean;
  };
  hard: { disabled: boolean };
}

/**
 * Pure state -> button appearance mapping, exported so the behaviour can be
 * tested without rendering React (the repo has no DOM test setup).
 *
 * `hard.disabled` is decided by the CALLER for aggregate transports — see
 * isHardStopEnabled in transportSlice.ts, which deliberately does not follow
 * the aggregate state. This default covers the single-player case.
 */
export function resolveTransportButtons(state: PlayerState): TransportButtons {
  switch (state) {
    case 'playing':
      return {
        main: { icon: 'stop', label: 'Soft Stop', className: 'btn-warning', disabled: false },
        hard: { disabled: false },
      };
    case 'stopping':
      return {
        main: { icon: 'stop', label: 'Stopping', className: 'btn-warning animate-pulse', disabled: true },
        hard: { disabled: false },
      };
    default:
      return {
        main: { icon: 'play', label: 'Play', className: 'btn-success', disabled: false },
        hard: { disabled: true },
      };
  }
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
}

export const PlayerTransport: React.FC<PlayerTransportProps> = ({
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
}) => {
  const buttons = resolveTransportButtons(state);
  const MainIcon = buttons.main.icon === 'play' ? Play : Square;
  const sizeClass = size === 'xs' ? 'btn-xs' : 'btn-sm';
  const buttonsMarkup = (
    <>
      <button
        id={id}
        type="button"
        onClick={state === 'playing' ? onSoftStop : onPlay}
        disabled={buttons.main.disabled}
        title={buttons.main.label}
        className={`btn ${sizeClass} join-item gap-1.5 font-bold text-xs ${buttons.main.className}`}
      >
        <MainIcon className="w-3.5 h-3.5 fill-current shrink-0" />
        <span className={compact ? 'hidden lg:inline' : 'hidden sm:inline'}>
          {buttons.main.label}
        </span>
      </button>

      {showHardStop && (
        <button
          id={id ? `${id}-hard` : undefined}
          type="button"
          onClick={onHardStop}
          disabled={hardStopDisabled ?? buttons.hard.disabled}
          title="Hard Stop (cut now)"
          className={`btn ${sizeClass} join-item btn-error gap-1.5 font-bold text-xs`}
        >
          <X className="w-3.5 h-3.5 shrink-0" />
          <span className={compact ? 'hidden lg:inline' : 'hidden sm:inline'}>Hard Stop</span>
        </button>
      )}
    </>
  );

  if (unwrapped) return buttonsMarkup;

  return <div className="join">{buttonsMarkup}</div>;
};
