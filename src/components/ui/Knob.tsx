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
} from '@/utils/knob';
import type { KeyDir, KnobIndicator, KnobScale, KnobSize } from '@/utils/knob';

export type { KnobScale, KnobSize };

/** Runtime list so tests can assert the badge map is exhaustive. */
export const KNOB_COLORS = [
  'text-primary',
  'text-secondary',
  'text-accent',
  'text-success',
  'text-error',
  'text-module-chord',
  'text-module-bass',
  'text-module-pad',
  'text-module-osc',
  'text-module-filter',
  'text-module-env-amp',
  'text-module-env-mod',
  'text-module-voice',
  'text-module-lfo',
  'text-module-arp',
  'text-module-fx',
  'text-drum-kick',
  'text-drum-snare',
  'text-drum-rimshot',
  'text-drum-clap',
  'text-drum-hihat',
  'text-drum-openhat',
  'text-drum-hitom',
  'text-drum-lowtom',
  'text-drum-ride',
  'text-drum-crash',
  'text-drum-bell',
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
  'text-module-pad': '[--badge-color:var(--color-module-pad)]',
  'text-module-osc': '[--badge-color:var(--color-module-osc)]',
  'text-module-filter': '[--badge-color:var(--color-module-filter)]',
  'text-module-env-amp': '[--badge-color:var(--color-module-env-amp)]',
  'text-module-env-mod': '[--badge-color:var(--color-module-env-mod)]',
  'text-module-voice': '[--badge-color:var(--color-module-voice)]',
  'text-module-lfo': '[--badge-color:var(--color-module-lfo)]',
  'text-module-arp': '[--badge-color:var(--color-module-arp)]',
  'text-module-fx': '[--badge-color:var(--color-module-fx)]',
  'text-drum-kick': '[--badge-color:var(--color-drum-kick)]',
  'text-drum-snare': '[--badge-color:var(--color-drum-snare)]',
  'text-drum-rimshot': '[--badge-color:var(--color-drum-rimshot)]',
  'text-drum-clap': '[--badge-color:var(--color-drum-clap)]',
  'text-drum-hihat': '[--badge-color:var(--color-drum-hihat)]',
  'text-drum-openhat': '[--badge-color:var(--color-drum-openhat)]',
  'text-drum-hitom': '[--badge-color:var(--color-drum-hitom)]',
  'text-drum-lowtom': '[--badge-color:var(--color-drum-lowtom)]',
  'text-drum-ride': '[--badge-color:var(--color-drum-ride)]',
  'text-drum-crash': '[--badge-color:var(--color-drum-crash)]',
  'text-drum-bell': '[--badge-color:var(--color-drum-bell)]',
};

export function badgeColorFor(color: KnobColor = 'text-primary'): string {
  return BADGE_COLOR[color];
}

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  /**
   * Called exactly once when a gesture ends by committing — pointerup, or a
   * single keypress (which is its own whole gesture). Optional: a caller that
   * omits it gets exactly today's behavior, since `onChange` already fires on
   * every intermediate move/keypress.
   */
  onCommit?: (value: number) => void;
  /**
   * Called exactly once when a gesture ends by cancelling — pointercancel or
   * a lost pointer capture — and never together with `onCommit` for the same
   * gesture. Optional, same rule as `onCommit`.
   */
  onCancel?: () => void;
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
  /**
   * The accessible name, when the visible `label` is not enough to tell this
   * knob from another one on screen. Defaults to `label`.
   *
   * It exists because a knob's visible label is squeezed into ~48px — "Oct",
   * "Semi", "Attack" — and the synth's Pro panel draws the same four labels
   * under OSC 1 and OSC 2, and the same ADSR four under ENV 1 and ENV 2. A
   * screen-reader user hearing "Attack" four times cannot tell which envelope
   * is which, and widening the visible label to say so would break the grid.
   *
   * It must CONTAIN the visible label (WCAG 2.5.3, Label in Name): "OSC 1 Oct"
   * is a legal name for a knob captioned "Oct", "OSC 1 octave trim" is not.
   */
  ariaLabel?: string;
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
export interface KnobGestureState {
  axis: 'x' | 'y' | null;
  startT: number;
  startX: number;
  startY: number;
  /** The last value `onChange` was called with, committed on a terminal event. */
  latestValue: number;
}

/** Detent angle in degrees, or null when no detent is configured. */
function detentAngleFor(
  detent: number | undefined,
  min: number,
  max: number,
  scale: KnobScale,
): number | null {
  return detent !== undefined ? detentAngle(detent, min, max, scale) : null;
}

/** The knob's resolved props, as the drag hook needs them. */
interface KnobDrag {
  value: number;
  min: number;
  max: number;
  step: number | undefined;
  scale: KnobScale;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onCancel?: () => void;
}

/**
 * Starts a drag gesture: captures the starting t (so a resumed drag begins
 * from the CURRENT value, not from a stale ref) and the pointer's origin.
 * Pure — no DOM, no React — so the whole gesture lifecycle is testable by
 * calling these three functions directly.
 */
export function beginKnobGesture(
  value: number,
  min: number,
  max: number,
  scale: KnobScale,
  clientX: number,
  clientY: number,
): KnobGestureState {
  return {
    axis: null,
    startT: clamp(valueToT(value, min, max, scale), 0, 1),
    startX: clientX,
    startY: clientY,
    latestValue: value,
  };
}

/**
 * Advances a gesture by one pointer move: picks the drag axis once the
 * accumulated delta clears `AXIS_PICK_THRESHOLD_PX` (and it sticks for the
 * rest of the gesture), then maps the delta to a value. Mutates `gesture`'s
 * `axis` and `latestValue` in place — the ref IS the gesture's identity, the
 * same way `useRef` state survives re-renders — and returns the next value,
 * or null while still below the axis-pick threshold (nothing to report yet).
 */
export function updateKnobGesture(
  gesture: KnobGestureState,
  min: number,
  max: number,
  scale: KnobScale,
  step: number | undefined,
  clientX: number,
  clientY: number,
  shiftKey: boolean,
): number | null {
  const dx = clientX - gesture.startX;
  const dy = clientY - gesture.startY;
  if (gesture.axis === null) {
    if (Math.abs(dx) < AXIS_PICK_THRESHOLD_PX && Math.abs(dy) < AXIS_PICK_THRESHOLD_PX) {
      return null;
    }
    gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  }
  const delta = gesture.axis === 'x' ? dx : -dy;
  const nextT = clamp(gesture.startT + dragDeltaT(delta, shiftKey), 0, 1);
  const next = snapToStep(tToValue(nextT, min, max, scale), min, step);
  gesture.latestValue = next;
  return next;
}

export type KnobGestureOutcome = 'commit' | 'cancel';

/**
 * Ends a gesture exactly once. The ref is cleared BEFORE either callback
 * runs, so a terminal event arriving after the gesture is already finished —
 * pointerup followed by a lost-capture, the two `pointercancel`/
 * `lostpointercapture` handlers on the same release — reads a cleared ref and
 * is a no-op. A double terminal callback is therefore structurally
 * impossible, not merely unlikely: there is no branch in which both `if`
 * bodies below can run for the same gesture.
 */
export function finishKnobGesture(
  gestureRef: { current: KnobGestureState | null },
  outcome: KnobGestureOutcome,
  onCommit?: (value: number) => void,
  onCancel?: () => void,
): void {
  const gesture = gestureRef.current;
  gestureRef.current = null;
  if (!gesture) return;
  if (outcome === 'commit') {
    // A gesture that never picked an axis never cleared
    // `AXIS_PICK_THRESHOLD_PX`, so `latestValue` is still the value the knob
    // already had and `onChange` never fired: there is nothing to commit and
    // nothing previewed to restore. Committing it anyway made a bare TAP on a
    // knob cost a whole-patch `structuredClone`, a store write mirrored into
    // the active loop, a persist re-serialise and a full engine re-install —
    // for a pointer down/up that changed nothing.
    if (gesture.axis === null) return;
    onCommit?.(gesture.latestValue);
  } else {
    onCancel?.();
  }
}

/**
 * Pointer behaviour for the knob, on a `useRef` that survives re-renders
 * mid-drag: pointer capture, the axis with the larger accumulated delta winning
 * (past AXIS_PICK_THRESHOLD_PX) and sticking for the whole gesture, right/up
 * increasing and left/down decreasing, Shift dividing sensitivity by 10.
 * `onCommit`/`onCancel` are optional: a caller that omits them gets exactly
 * today's behavior, since the callbacks are only ever invoked through `?.`.
 */
function useKnobDrag({ value, min, max, scale, step, disabled, onChange, onCommit, onCancel }: KnobDrag) {
  const gestureRef = useRef<KnobGestureState | null>(null);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = beginKnobGesture(value, min, max, scale, e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (disabled || !gesture) return;
    const next = updateKnobGesture(gesture, min, max, scale, step, e.clientX, e.clientY, e.shiftKey);
    if (next !== null) onChange(next);
  };

  const finishGesture = (outcome: KnobGestureOutcome) => (e: React.PointerEvent<SVGSVGElement>) => {
    finishKnobGesture(gestureRef, outcome, onCommit, onCancel);
    e.currentTarget.blur();
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: finishGesture('commit'),
    handlePointerCancel: finishGesture('cancel'),
    handleLostPointerCapture: finishGesture('cancel'),
  };
}

/**
 * The direction a key asks for, or null when the key is not the knob's
 * (spec §4.3: arrows, page, Home/End).
 */
function keyDirFor(key: string): KeyDir | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return 'inc';
    case 'ArrowDown':
    case 'ArrowLeft':
      return 'dec';
    case 'PageUp':
      return 'page-inc';
    case 'PageDown':
      return 'page-dec';
    case 'Home':
      return 'min';
    case 'End':
      return 'max';
    default:
      return null;
  }
}

/**
 * Keyboard gesture: a single keypress is its own whole gesture, so it goes
 * straight to `onChange` then `onCommit` — never a preview left uncommitted.
 * Exported so the exact function the `<svg onKeyDown>` handler calls is what
 * a test drives, not a re-implementation of it. Returns false (and calls
 * neither callback) for a key the knob does not bind or while disabled.
 *
 * AUTO-REPEAT IS A DRAG, NOT A STREAM OF GESTURES. A held arrow key repeats at
 * the platform rate (~30/s), and committing each repeat made the keyboard the
 * one path that still did per-event persisted writes: every repeat ran a whole
 * patch `structuredClone`, a store write mirrored into the active loop, a
 * persist re-serialise and a full engine re-install — exactly what the pointer
 * path's draft/commit machine exists to prevent. While `repeat` is set the key
 * therefore PREVIEWS only, and the commit lands once on `keyup`.
 */
export function handleKnobKeyDown(
  key: string,
  config: {
    value: number;
    min: number;
    max: number;
    step: number | undefined;
    disabled: boolean;
    repeat?: boolean;
  },
  onChange: (value: number) => void,
  onCommit?: (value: number) => void,
): boolean {
  if (config.disabled) return false;
  const dir = keyDirFor(key);
  if (!dir) return false;
  const next = nextKeyValue(config.value, config.min, config.max, config.step, dir);
  onChange(next);
  if (!config.repeat) onCommit?.(next);
  return true;
}

/** Ring rendering behind the needle, per `indicator`: progress arc on a dark
    270° ring, thin uniform ring (pan/balance), or full static ring. */
const IndicatorRing = ({ indicator, dash }: { indicator: KnobIndicator; dash: number }) => (
  <>
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
  </>
);

/** Fixed detent tick on the ring, drawn only when the detent is inside [min, max]. */
const DetentTick = ({ angleDeg }: { angleDeg: number | null }) => (
  <>
    {/* Detent tick — short radial line on the ring at the detent angle;
        drawn only when the detent is inside [min, max]; visual only. */}
    {angleDeg !== null && (
      <g transform={`rotate(${angleDeg} 50 50)`}>
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
  </>
);

/** Needle — rotates around the knob center; same t as the arc tip. */
const Needle = ({ angle }: { angle: number }) => (
  <>
    <g transform={`rotate(${angle} 50 50)`}>
      <rect x="46" y="16" width="8" height="36" rx="4" fill="currentColor" />
      <circle cx="50" cy="50" r="10" fill="currentColor" />
    </g>
  </>
);

/** Horizontal layout: label + value column left of the knob. */
const HorizontalReadout = ({ label, display }: { label: string | undefined; display: string }) => (
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
);

/** Vertical layout: optional label above the knob. */
const VerticalLabel = ({ label }: { label: string | undefined }) => (
  <>
    {label !== undefined && (
      <span className="text-[10px] text-base-content/60 block text-center">
        {label}
      </span>
    )}
  </>
);

/** Vertical layout: value + optional descriptor badge below the knob. */
const VerticalReadout = ({
  display,
  descriptor,
  color,
}: {
  display: string;
  descriptor: string | undefined;
  color: KnobColor | undefined;
}) => (
  <>
    <span className="text-[10px] tabular-nums text-current block text-center">
      {display}
    </span>
    {descriptor !== undefined && (
      <span
        className={`badge badge-sm badge-soft text-[10px] font-semibold ${badgeColorFor(color)}`}
      >
        {descriptor}
      </span>
    )}
  </>
);

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
  onCommit,
  onCancel,
  min = 0,
  max = 1,
  step,
  scale = 'linear',
  size = 'md',
  label,
  ariaLabel,
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
  const pixelSize = SIZE_PX[size];
  const t = clamp(valueToT(value, min, max, scale), 0, 1);
  const angle = angleForT(t);
  const dash = progressDash(t);
  const display = format(value);
  const detentAngleDeg = detentAngleFor(detent, min, max, scale);

  const { handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handleLostPointerCapture } =
    useKnobDrag({
      value,
      min,
      max,
      scale,
      step,
      disabled,
      onChange,
      onCommit,
      onCancel,
    });

  // Set while an auto-repeat run is previewing, so `keyup` knows it owes a
  // commit. A single press commits inside `handleKnobKeyDown` and leaves this
  // false, so the `keyup` below is a no-op for it.
  const keyRepeatingRef = useRef(false);

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (handleKnobKeyDown(e.key, { value, min, max, step, disabled, repeat: e.repeat }, onChange, onCommit)) {
      if (e.repeat) keyRepeatingRef.current = true;
      e.preventDefault();
    }
  };

  const handleKeyUp = () => {
    if (!keyRepeatingRef.current) return;
    keyRepeatingRef.current = false;
    if (!disabled) onCommit?.(value);
  };

  return (
    <div className={`flex ${layout === 'horizontal' ? 'flex-row items-center gap-2' : 'flex-col items-center gap-1'} ${color ?? 'text-primary'} ${className ?? ''}`}>
      {layout === 'horizontal' && <HorizontalReadout label={label} display={display} />}
      {layout === 'vertical' && <VerticalLabel label={label} />}
      <svg
        id={id}
        role="slider"
        aria-label={ariaLabel ?? label}
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
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        <IndicatorRing indicator={indicator} dash={dash} />
        <DetentTick angleDeg={detentAngleDeg} />
        <Needle angle={angle} />
      </svg>
      {layout === 'vertical' && (
        <VerticalReadout display={display} descriptor={descriptor} color={color} />
      )}
    </div>
  );
};
