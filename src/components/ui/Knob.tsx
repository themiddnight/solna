import React, { useRef } from 'react';
import {
  AXIS_PICK_THRESHOLD_PX,
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  angleForT,
  clamp,
  detentAngle,
  dragDeltaT,
  nextKeyValue,
  progressDash,
  snapToStep,
  tToValue,
  valueToT,
} from '../../utils/knob';
import type { KeyDir, KnobIndicator, KnobScale, KnobSize } from '../../utils/knob';

export type { KnobIndicator, KnobScale, KnobSize };

/** Runtime list so tests can assert the badge map is exhaustive. */
export const KNOB_COLORS = [
  'text-primary',
  'text-secondary',
  'text-accent',
  'text-success',
  'text-error',
  'text-module-chord',
  'text-module-bass',
  'text-module-osc',
  'text-module-filter',
  'text-module-env-vca',
  'text-module-env-vcf',
  'text-module-lfo',
  'text-module-arp',
] as const;

export type KnobColor = (typeof KNOB_COLORS)[number];

/**
 * Badge tint for the descriptor, keyed off the knob's own colour so the badge
 * and the needle always agree.
 *
 * Written out as literals on purpose: Tailwind v4 scans source statically, so
 * a class assembled from `--color-${token}` at runtime would never be emitted.
 */
const BADGE_COLOR: Record<KnobColor, string> = {
  'text-primary': '[--badge-color:var(--color-primary)]',
  'text-secondary': '[--badge-color:var(--color-secondary)]',
  'text-accent': '[--badge-color:var(--color-accent)]',
  'text-success': '[--badge-color:var(--color-success)]',
  'text-error': '[--badge-color:var(--color-error)]',
  'text-module-chord': '[--badge-color:var(--color-module-chord)]',
  'text-module-bass': '[--badge-color:var(--color-module-bass)]',
  'text-module-osc': '[--badge-color:var(--color-module-osc)]',
  'text-module-filter': '[--badge-color:var(--color-module-filter)]',
  'text-module-env-vca': '[--badge-color:var(--color-module-env-vca)]',
  'text-module-env-vcf': '[--badge-color:var(--color-module-env-vcf)]',
  'text-module-lfo': '[--badge-color:var(--color-module-lfo)]',
  'text-module-arp': '[--badge-color:var(--color-module-arp)]',
};

export function badgeColorFor(color: KnobColor = 'text-primary'): string {
  return BADGE_COLOR[color];
}

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: KnobScale;
  size?: KnobSize;
  label?: string;
  /**
   * Plain-language reading of the current value, shown as a badge under the
   * knob (vertical layout only). Use it where the number alone does not say
   * what the user will hear — decay in seconds, cutoff in Hz — and NOT for
   * percentages or dB, which already read plainly.
   *
   * LIMITATION: silently ignored when `layout === 'horizontal'` — there is no
   * horizontal rendering for it yet. Passing `descriptor` to a horizontal
   * knob compiles and renders with no error or warning, it just never shows.
   * Do not rely on it for a horizontal knob until horizontal support lands.
   */
  descriptor?: string;
  /** Needle + progress arc + value tint. Token classes only (default 'text-primary'). */
  color?: KnobColor;
  format?: (v: number) => string;
  indicator?: KnobIndicator;
  detent?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** 'horizontal' = compact row: col[label, value] left of the knob. */
  layout?: 'vertical' | 'horizontal';
}

/** Per-gesture drag state (a ref — survives re-renders mid-drag). */
interface GestureState {
  axis: 'x' | 'y' | null;
  startT: number;
  startX: number;
  startY: number;
}

/**
 * Shared rotary knob primitive. Controlled-only (value/onChange).
 * Drag: pointer capture; the axis with the larger accumulated delta wins
 * (past AXIS_PICK_THRESHOLD_PX) and sticks for the whole gesture. Right/up
 * increase, left/down decrease; Shift divides sensitivity by 10.
 * Keyboard: role="slider" with arrows/page/Home/End (spec §4.3). Ring per
 * `indicator` + optional fixed detent tick (visual only). The needle and the
 * progress-arc tip are derived from the same t (spec §5 invariant).
 */
export const Knob = ({
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  scale = 'linear',
  size = 'md',
  label,
  descriptor,
  color,
  format = String,
  indicator = 'progress',
  detent,
  disabled = false,
  id,
  className,
  layout = 'vertical',
}: KnobProps) => {
  const gestureRef = useRef<GestureState | null>(null);
  const pixelSize = SIZE_PX[size];
  const t = clamp(valueToT(value, min, max, scale), 0, 1);
  const angle = angleForT(t);
  const dash = progressDash(t);
  const display = format(value);
  const detentAngleDeg = detent !== undefined ? detentAngle(detent, min, max, scale) : null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = {
      axis: null,
      startT: clamp(valueToT(value, min, max, scale), 0, 1),
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (disabled || !gesture) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (gesture.axis === null) {
      if (Math.abs(dx) < AXIS_PICK_THRESHOLD_PX && Math.abs(dy) < AXIS_PICK_THRESHOLD_PX) {
        return;
      }
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    const delta = gesture.axis === 'x' ? dx : -dy;
    const nextT = clamp(gesture.startT + dragDeltaT(delta, e.shiftKey), 0, 1);
    onChange(snapToStep(tToValue(nextT, min, max, scale), min, step));
  };

  const endGesture = (e: React.PointerEvent<SVGSVGElement>) => {
    gestureRef.current = null;
    e.currentTarget.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    let dir: KeyDir | null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        dir = 'inc';
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        dir = 'dec';
        break;
      case 'PageUp':
        dir = 'page-inc';
        break;
      case 'PageDown':
        dir = 'page-dec';
        break;
      case 'Home':
        dir = 'min';
        break;
      case 'End':
        dir = 'max';
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(nextKeyValue(value, min, max, step, dir));
  };

  return (
    <div className={`flex ${layout === 'horizontal' ? 'flex-row items-center gap-2' : 'flex-col items-center gap-1'} ${color ?? 'text-primary'} ${className ?? ''}`}>
      {layout === 'horizontal' && (
        <div className="flex flex-col items-end shrink-0">
          {label !== undefined && (
            <span className="text-[10px] text-base-content/60 block">
              {label}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-current block">
            {display}
          </span>
        </div>
      )}
      {layout === 'vertical' && label !== undefined && (
        <span className="text-[10px] text-base-content/60 block text-center">
          {label}
        </span>
      )}
      <svg
        id={id}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 100 100"
        className={`block touch-none select-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary/70 ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onKeyDown={handleKeyDown}
      >
        {/* indicator="progress": dark 270° ring (same thickness as the arc,
            spec §5) + progress arc from min (−135°) to the current angle. */}
        {indicator === 'progress' && (
          <>
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              className="stroke-base-300"
              strokeWidth="10"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${PROGRESS_ARC_UNITS} ${100 - PROGRESS_ARC_UNITS}`}
              transform="rotate(135 50 50)"
            />
            {/* Butt caps keep the arc tip exactly on the needle. */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              pathLength={100}
              strokeDasharray={`${dash} ${100 - dash}`}
              transform="rotate(135 50 50)"
            />
          </>
        )}
        {/* indicator="none": thin uniform full ring, no arc (pan/balance). */}
        {indicator === 'none' && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            className="stroke-base-300"
            strokeWidth="2"
          />
        )}
        {/* indicator="full": full-circle static thick ring, no dasharray. */}
        {indicator === 'full' && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
          />
        )}
        {/* Detent tick — short radial line on the ring at the detent angle;
            drawn only when the detent is inside [min, max]; visual only. */}
        {detentAngleDeg !== null && (
          <g transform={`rotate(${detentAngleDeg} 50 50)`}>
            <line
              x1="50"
              y1="14"
              x2="50"
              y2="1"
              className="stroke-base-content/50"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        )}
        {/* Needle — rotates around the knob center; same t as the arc tip. */}
        <g transform={`rotate(${angle} 50 50)`}>
          <rect x="46" y="16" width="8" height="36" rx="4" fill="currentColor" />
          <circle cx="50" cy="50" r="10" fill="currentColor" />
        </g>
      </svg>
      {layout === 'vertical' && (
        <span className="text-[10px] tabular-nums text-current block text-center">
          {display}
        </span>
      )}
      {layout === 'vertical' && descriptor !== undefined && (
        <span
          className={`badge badge-sm badge-soft text-[10px] font-semibold ${badgeColorFor(color)}`}
        >
          {descriptor}
        </span>
      )}
    </div>
  );
};
