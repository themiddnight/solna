import React from 'react';
import { Slider } from './Slider';
import { FADER_POSITION_STEP } from '@/store/levelUnits';
import { SILENCE_DB, UNITY_DB, dbToSliderPos, formatDb, sliderPosTodB } from '@/utils/gainUnits';

/**
 * THE dB fader. Every user-facing level in the app renders through this
 * component: the transport master, the five ChannelStrip layers, the five bus
 * faders on a loop card and the eleven per-track drum faders — about twenty
 * call sites. That is the point. The taper, the readout, the unity reset and
 * the silence detent are behaviour, and behaviour written twenty times is not
 * a contract, it is twenty chances to disagree. A caller passes decibels and
 * gets decibels back; this is the only COMPONENT that converts a slider
 * position. `src/store/midiInput.ts` is the one other call site — it sweeps
 * a live MIDI CC across the same `sliderPosTodB` curve under a deliberate
 * eslint exemption, because a hardware fader reports a 0..1 position with no
 * component in the loop to hand it to. If the taper ever changes, that file
 * must move with it.
 *
 * It is deliberately NOT a channel strip: no meter, no mute, no solo, no
 * name. DEV-389 pairs it with a meter to build one and owns the visual
 * design — this file owns only what the control DOES.
 */

/**
 * Position (0..1 of physical travel) -> decibels, with the bottom HALF-STEP
 * (not just pos===0) pinned to the silence sentinel.
 *
 * The pin is not cosmetic. `faderDbToGain` maps `db <= SILENCE_DB` to a linear
 * 0, so silence has to arrive as EXACTLY SILENCE_DB. At pos===0 that already
 * falls out of `sliderPosTodB`'s own `clampedPos <= 0` clamp (an earlier
 * version of this comment claimed that clamp was float arithmetic that could
 * drift — it is not; it is an exact early return). What the half-step width
 * actually buys is the range strictly ABOVE 0: without it, e.g. pos=0.001
 * taper-interpolates to -59.92 dB — a real, audible-in-principle level, not
 * silence — and only the exact pos===0 boundary would read as off. Widening
 * the pin to `pos <= FADER_POSITION_STEP / 2` turns the bottom detent into a
 * dead zone wide enough to hit deliberately (native `<input step>` drags
 * quantise onto the step lattice today, so 0 is the only value that path
 * produces, but a future pointer-driven fader — DEV-389's redesign — need not
 * quantise the same way, and this is what keeps "near the bottom" reading as
 * silence rather than a fraction of a dB above it).
 */
export function faderPositionToDb(pos: number): number {
  return pos <= FADER_POSITION_STEP / 2 ? SILENCE_DB : sliderPosTodB(pos);
}

interface VolumeFaderProps {
  id: string;
  /**
   * The accessible name AND the tooltip prefix — "Chord Layer Gain" renders
   * as `aria-label="Chord Layer Gain"` and `title="Chord Layer Gain: -6.0 dB"`.
   * One prop, because a fader whose tooltip and screen-reader name disagree is
   * two controls to a reader who uses both.
   */
  label: string;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. Never a position,
   *  never a linear gain. */
  valueDb: number;
  onChangeDb: (db: number) => void;
  /** Full daisyUI class list for the range, e.g. 'range range-xs range-accent w-16'. */
  className?: string;
  showReadout?: boolean;
  readoutClassName?: string;
}

export function VolumeFader({
  id,
  label,
  valueDb,
  onChangeDb,
  className = 'range range-xs range-primary w-full',
  showReadout = true,
  readoutClassName = 'text-[10px] tabular-nums w-14 text-right shrink-0 text-base-content/80',
}: VolumeFaderProps) {
  // formatDb is the ONE formatter for a dB value; the readout and the tooltip
  // are the same string, so they cannot round differently.
  const readout = formatDb(valueDb);
  return (
    <>
      {/* The control's value is a POSITION on the DAW taper (0..1, unity at
          0.75), and `step` is therefore a POSITION step: a fixed dB step on a
          tapered fader is coarse at the bottom and absurdly fine at the top.
          Rounding for humans is formatDb's job, not the control's. */}
      <Slider
        id={id}
        min={0}
        max={1}
        step={FADER_POSITION_STEP}
        value={dbToSliderPos(valueDb)}
        onChange={(pos) => onChangeDb(faderPositionToDb(pos))}
        // Double-click returns to unity. It is the DAW convention and it only
        // means anything on a dB fader, where 0 is a real home rather than an
        // arbitrary point on a 0..1.5 ramp.
        onDoubleClick={() => onChangeDb(UNITY_DB)}
        className={className}
        ariaLabel={label}
        title={`${label}: ${readout}`}
      />
      {showReadout && <span className={readoutClassName}>{readout}</span>}
    </>
  );
}
