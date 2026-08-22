import React from 'react';
import {
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  angleForT,
  clamp,
  detentAngle,
  progressDash,
  tToValue,
  valueToT,
} from '../../utils/knob';
import type { KnobIndicator, KnobScale, KnobSize } from '../../utils/knob';

export type { KnobIndicator, KnobScale, KnobSize };

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: KnobScale;
  size?: KnobSize;
  label?: string;
  format?: (v: number) => string;
  indicator?: KnobIndicator;
  detent?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Shared rotary knob primitive. Controlled-only (value/onChange).
 * Static render: ring per `indicator` ('progress' arc / 'none' thin ring /
 * 'full' static ring) + optional detent tick + rotating needle + center dot
 * + label/value row. Pointer drag (Task 4) and keyboard/ARIA (Task 5) are
 * layered on top. The needle and the progress-arc tip are both derived from
 * the same t, so they always point in the same direction (spec §5).
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
  format = String,
  indicator = 'progress',
  detent,
  disabled = false,
  id,
  className,
}: KnobProps) => {
  const pixelSize = SIZE_PX[size];
  const t = clamp(valueToT(value, min, max, scale), 0, 1);
  const angle = angleForT(t);
  const dash = progressDash(t);
  const display = format(value);
  const detentAngleDeg = detent !== undefined ? detentAngle(detent, min, max, scale) : null;

  return (
    <div className={className}>
      {label !== undefined && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400 font-medium">{label}</span>
          <span className="font-mono text-indigo-300">{display}</span>
        </div>
      )}
      <svg
        id={id}
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 100 100"
        className={`block text-[#877dca] touch-none select-none rounded-full ${
          disabled ? 'opacity-40' : 'cursor-pointer'
        }`}
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
              stroke="#252B48"
              strokeWidth="10"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${PROGRESS_ARC_UNITS} ${100 - PROGRESS_ARC_UNITS}`}
              transform="rotate(-135 50 50)"
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
              transform="rotate(-135 50 50)"
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
            stroke="#252B48"
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
        {/* Static indicator notch at 3 o'clock, per the Figma border reference. */}
        <line
          x1="82"
          y1="51"
          x2="94"
          y2="51"
          stroke="#252B48"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Detent tick — short radial line on the ring at the detent angle;
            drawn only when the detent is inside [min, max]; visual only. */}
        {detentAngleDeg !== null && (
          <g transform={`rotate(${detentAngleDeg} 50 50)`}>
            <line
              x1="50"
              y1="14"
              x2="50"
              y2="1"
              stroke="#94a3b8"
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
    </div>
  );
};
