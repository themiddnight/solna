import { useRef, useState } from 'react';
import type { LfoParams, LfoRate, LfoWaveform, NoteDivision, NoteDivisionModifier, NoteDivisionValue } from '@/types/synth';
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import { LFO_WAVEFORMS, WAVEFORM_LABELS, WaveformIcon } from './WaveformIcon';
import { LFO_DB_ROUTE_LIMIT } from '@/utils/synthPatch';
import {
  KnobGrid,
  ProModule,
  RouteRow,
  ToggleButton,
  ToggleRow,
  type PatchPanelProps,
} from './proControls';

/**
 * Pro-Mode module 6 — the LFO (prototype Variant A's modulation row).
 *
 * One route slot, deliberately: `LfoParams.route` is a single nullable route,
 * and the LFO's whole output is `depth * route.amount`. A second row here would
 * have nowhere to store what it collected.
 */
const LFO_COLOR = 'text-module-lfo' as const;

const DIVISION_VALUES: readonly NoteDivisionValue[] = [1, 2, 4, 8, 16, 32];
const DIVISION_MODIFIERS: readonly NoteDivisionModifier[] = ['straight', 'dotted', 'triplet'];

/** `1/8`, `1/8 dotted`, `1/8 triplet` — the names a musician reads on a clock. */
function divisionLabel({ value, modifier }: NoteDivision): string {
  const base = value === 1 ? '1/1' : `1/${value}`;
  return modifier === 'straight' ? base : `${base} ${modifier}`;
}

/** The select's option value, and the division it decodes back to. */
const divisionKey = ({ value, modifier }: NoteDivision) => `${value}-${modifier}`;

function divisionFromKey(key: string): NoteDivision {
  const [value, modifier] = key.split('-');
  return { value: Number(value) as NoteDivisionValue, modifier: modifier as NoteDivisionModifier };
}

const DIVISIONS: readonly NoteDivision[] = DIVISION_VALUES.flatMap((value) =>
  DIVISION_MODIFIERS.map((modifier) => ({ value, modifier })),
);

/** The rate the INACTIVE clock mode is holding, so the switch is reversible. */
export interface ParkedLfoRate {
  hz: number;
  division: NoteDivision;
}

/** What each mode starts at when nothing has been parked for it yet. */
export const DEFAULT_PARKED_RATE: ParkedLfoRate = {
  hz: 4,
  division: { value: 8, modifier: 'straight' },
};

/** The parked pair that remembers whichever mode `rate` is NOT in. */
function parkedRateFor(rate: LfoRate): ParkedLfoRate {
  return rate.mode === 'hz'
    ? { ...DEFAULT_PARKED_RATE, hz: rate.hz }
    : { ...DEFAULT_PARKED_RATE, division: rate.division };
}

/**
 * Switching the clock between free-running Hz and tempo-synced divisions.
 *
 * `LfoRate` is a union that stores ONE mode, so flipping the switch has to put
 * the outgoing value somewhere or it is gone: a user who set 7.5 Hz, looked at
 * Sync and came back used to find 4 Hz. This parks the outgoing value and
 * restores whatever the incoming mode was last left at, which makes the switch
 * a view of two remembered settings rather than a destructive edit.
 *
 * Pure, and exported, because the memory is the behaviour — a test that went
 * through the component could only check the markup of one half of it.
 */
export function switchLfoRateMode(
  rate: LfoRate,
  parked: ParkedLfoRate,
  target: LfoRate['mode'],
): { rate: LfoRate; parked: ParkedLfoRate } {
  if (rate.mode === target) return { rate, parked };
  const next: ParkedLfoRate =
    rate.mode === 'hz' ? { ...parked, hz: rate.hz } : { ...parked, division: rate.division };
  return {
    rate: target === 'hz' ? { mode: 'hz', hz: next.hz } : { mode: 'sync', division: next.division },
    parked: next,
  };
}

/** Free-running Hz or a tempo-locked division — the same field, two units. */
function LfoRateField({ rate, onRate }: { rate: LfoRate; onRate: (next: LfoRate) => void }) {
  if (rate.mode === 'sync') {
    return (
      <div className="min-w-0 flex-1">
        <label className={FIELD_LABEL} htmlFor="select-lfo-division">
          Rate
        </label>
        <select
          id="select-lfo-division"
          className="select select-xs w-full text-[11px] font-semibold"
          value={divisionKey(rate.division)}
          onChange={(e) => onRate({ mode: 'sync', division: divisionFromKey(e.target.value) })}
        >
          {DIVISIONS.map((division) => (
            <option key={divisionKey(division)} value={divisionKey(division)}>
              {divisionLabel(division)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <KnobGrid
      className="flex-1"
      color={LFO_COLOR}
      columns={1}
      specs={[
        {
          id: 'slider-lfo-rate',
          label: 'Rate',
          ariaLabel: 'LFO Rate',
          value: rate.hz,
          min: 0.01,
          max: 20,
          scale: 'log',
          format: (v) => `${v.toFixed(2)} Hz`,
          onChange: (hz) => onRate({ mode: 'hz', hz }),
        },
      ]}
    />
  );
}

/**
 * The rate for the mode the LFO is NOT in.
 *
 * Local, and deliberately not patch state: `LfoRate` has no field for the mode
 * it is not in, and a rate the user is not currently using is not part of the
 * sound.
 *
 * Re-seeded whenever a rate arrives that the panel did not write, because a
 * lazy initializer runs ONCE per mounted instance and this instance outlives
 * the patch it mounted on, twice over. A preset install would otherwise hand
 * back the division parked at mount rather than its own; and the panel is a
 * single instance whose patch swaps with `focusTrack` (`useSynthChannel`) with
 * nothing unmounting it in between, so Lead's parked 7.5 Hz would surface on
 * Chord. `lastWritten` tells the two apart — the panel's own writes keep the
 * parked value, anything else re-derives it.
 */
function useParkedRate(
  rate: LfoRate,
  writeRate: (next: LfoRate) => void,
): {
  parked: ParkedLfoRate;
  setParked: (next: ParkedLfoRate) => void;
  writeRate: (next: LfoRate) => void;
} {
  const [parked, setParked] = useState<ParkedLfoRate>(() => parkedRateFor(rate));
  const [seen, setSeen] = useState<LfoRate>(rate);
  const lastWritten = useRef<LfoRate | null>(null);
  if (seen !== rate) {
    if (lastWritten.current !== rate) setParked(parkedRateFor(rate));
    setSeen(rate);
  }
  return {
    parked,
    setParked,
    writeRate: (next) => {
      lastWritten.current = next;
      writeRate(next);
    },
  };
}

export function LfoPanel({ patch, onPatch }: PatchPanelProps) {
  const lfo = patch.synth.lfo;
  const write = (next: Partial<LfoParams>) =>
    onPatch({ ...patch, synth: { ...patch.synth, lfo: { ...lfo, ...next } } });

  const { parked, setParked, writeRate } = useParkedRate(lfo.rate, (rate) => write({ rate }));
  const selectRateMode = (mode: LfoRate['mode']) => {
    const next = switchLfoRateMode(lfo.rate, parked, mode);
    setParked(next.parked);
    writeRate(next.rate);
  };

  return (
    <ProModule
      badge={7}
      title="LFO"
      color={LFO_COLOR}
    >
      <div role="group" aria-label="LFO waveform" className="grid grid-cols-5 gap-1">
        {LFO_WAVEFORMS.map((waveform: LfoWaveform) => (
          <ToggleButton
            key={waveform}
            id={`btn-lfo-wave-${waveform}`}
            label={`LFO ${WAVEFORM_LABELS[waveform]}`}
            pressed={lfo.waveform === waveform}
            color={LFO_COLOR}
            onPress={() => write({ waveform })}
            className="px-0"
          >
            <WaveformIcon waveform={waveform} />
          </ToggleButton>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ToggleRow
          idPrefix="btn-lfo-rate-mode"
          caption="Clock"
          color={LFO_COLOR}
          value={lfo.rate.mode}
          options={[
            { value: 'hz', label: 'Hz, free running', content: 'Hz' },
            { value: 'sync', label: 'Sync to tempo', content: 'Sync' },
          ]}
          onSelect={selectRateMode}
        />
        <ToggleRow
          idPrefix="btn-lfo-trigger"
          caption="Trigger"
          color={LFO_COLOR}
          value={lfo.triggerMode}
          options={[
            { value: 'transport', label: 'Transport, one shared phase', content: 'Transport' },
            { value: 'note', label: 'Note, per voice from its own phase', content: 'Note' },
          ]}
          onSelect={(triggerMode) => write({ triggerMode })}
        />
      </div>

      <div className="flex items-end gap-2">
        <LfoRateField rate={lfo.rate} onRate={writeRate} />
        <KnobGrid
          className="flex-2"
          color={LFO_COLOR}
          columns={2}
          specs={[
            {
              id: 'slider-lfo-depth',
              label: 'Depth',
              ariaLabel: 'LFO Depth',
              value: lfo.depth,
              min: 0,
              max: 1,
              step: 0.01,
              format: (v) => `${Math.round(v * 100)}%`,
              onChange: (depth) => write({ depth }),
            },
            {
              id: 'slider-lfo-phase',
              label: 'Phase',
              ariaLabel: 'LFO Phase',
              value: lfo.phaseDegrees,
              min: 0,
              max: 360,
              step: 1,
              format: (v) => `${Math.round(v)}°`,
              onChange: (phaseDegrees) => write({ phaseDegrees }),
            },
          ]}
        />
      </div>

      <RouteRow
        dbRange={{ min: -LFO_DB_ROUTE_LIMIT, max: LFO_DB_ROUTE_LIMIT }}
        idPrefix="lfo-route"
        caption="Target"
        amountLabel="LFO route Amount"
        route={lfo.route}
        color={LFO_COLOR}
        onChange={(route) => write({ route })}
      />
    </ProModule>
  );
}
