import type { ReactNode } from 'react';
import type { NoiseColor, UtilitySourceParams } from '@/types/synth';
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import { SYNTH_GAIN_FLOOR_DB } from '@/utils/synthPatch';
import { EnableToggle, KnobGrid, ProModule, ToggleRow, type PatchPanelProps } from './proControls';

/**
 * Pro-Mode module 2 — the utility source (prototype Variant A's "OSC 3").
 *
 * It wears `module-osc`, the same identity the two full oscillators wear,
 * because it IS a source: the prototype paints its utility column with the
 * oscillator colour for the same reason. The sub and the noise are two framed
 * halves inside it rather than two modules, since neither is a full oscillator
 * — the sub has no waveform choice and the noise has no pitch.
 */
const OSC_COLOR = 'text-module-osc' as const;

const NOISE_COLORS: readonly { value: NoiseColor; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'pink', label: 'Pink' },
  { value: 'brown', label: 'Brown' },
];

const levelDb = (value: number) => `${value.toFixed(1)} dB`;

/** The frame each half sits in — a source you can switch off is its own object. */
function UtilityHalf({
  title,
  enabledId,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabledId: string;
  enabled: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-box border border-base-300 bg-base-100 p-2 space-y-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold text-base-content">{title}</span>
        <EnableToggle
          id={enabledId}
          name={title}
          enabled={enabled}
          color={OSC_COLOR}
          onToggle={onToggle}
        />
      </div>
      {children}
    </div>
  );
}

export function UtilitySourcePanel({ patch, onPatch }: PatchPanelProps) {
  const utility = patch.synth.utility;
  const write = (next: Partial<UtilitySourceParams>) =>
    onPatch({ ...patch, synth: { ...patch.synth, utility: { ...utility, ...next } } });

  return (
    <ProModule
      badge={3}
      title="Sub & Noise"
      color={OSC_COLOR}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <UtilityHalf
          title="SUB OSC"
          enabledId="btn-sub-enabled"
          enabled={utility.subEnabled}
          onToggle={() => write({ subEnabled: !utility.subEnabled })}
        >
          <ToggleRow
            idPrefix="btn-sub-octave"
            caption="Sine, octave down"
            color={OSC_COLOR}
            value={utility.subOctave === -1 ? 'minus1' : 'minus2'}
            options={[
              // The captions are bare numbers: "−1 OCT" wrapped onto two lines
              // in the narrowest column, and the caption above already says
              // what the number counts. The full phrase is the button's name.
              { value: 'minus1', label: '−1, one octave down', content: '−1' },
              { value: 'minus2', label: '−2, two octaves down', content: '−2' },
            ]}
            onSelect={(value) => write({ subOctave: value === 'minus1' ? -1 : -2 })}
          />
          <KnobGrid
            color={OSC_COLOR}
            columns={1}
            specs={[
              {
                id: 'slider-sub-level',
                label: 'Sub level',
                value: utility.subLevelDb,
                // `SYNTH_GAIN_FLOOR_DB`, not -60: factory presets park a
                // silent sub at the floor, and a knob that cannot reach it
                // reports a value below its own minimum. See OscillatorPanel.
                min: SYNTH_GAIN_FLOOR_DB,
                max: 0,
                step: 0.5,
                format: levelDb,
                onChange: (subLevelDb) => write({ subLevelDb }),
              },
            ]}
          />
        </UtilityHalf>

        <UtilityHalf
          title="NOISE"
          enabledId="btn-noise-enabled"
          enabled={utility.noiseEnabled}
          onToggle={() => write({ noiseEnabled: !utility.noiseEnabled })}
        >
          {/* A select, not a segmented row. Three colour chips plus their
              caption overflowed this column at the narrow breakpoint, and a
              row that scrolls sideways inside a card reads as a broken card. */}
          <div>
            <label className={FIELD_LABEL} htmlFor="select-noise-color">
              Noise type
            </label>
            <select
              id="select-noise-color"
              className="select select-xs w-full text-[11px] font-semibold"
              value={utility.noiseColor}
              onChange={(e) => write({ noiseColor: e.target.value as NoiseColor })}
            >
              {NOISE_COLORS.map((color) => (
                <option key={color.value} value={color.value}>
                  {color.label}
                </option>
              ))}
            </select>
          </div>
          <KnobGrid
            color={OSC_COLOR}
            columns={1}
            specs={[
              {
                id: 'slider-noise-level',
                label: 'Noise level',
                value: utility.noiseLevelDb,
                min: SYNTH_GAIN_FLOOR_DB,
                max: 0,
                step: 0.5,
                format: levelDb,
                onChange: (noiseLevelDb) => write({ noiseLevelDb }),
              },
            ]}
          />
        </UtilityHalf>
      </div>
    </ProModule>
  );
}
