import type { OscillatorParams, OscillatorWaveform } from '@/types/synth';
import { SYNTH_GAIN_FLOOR_DB } from '@/utils/synthPatch';
import { OSCILLATOR_WAVEFORMS, WAVEFORM_LABELS, WaveformIcon } from './WaveformIcon';
import { EnableToggle, KnobGrid, ProModule, ToggleButton, type PatchPanelProps } from './proControls';

/**
 * Pro-Mode module 1 — the two full oscillators (prototype Variant A's
 * `main-osc`).
 *
 * Two INSET units rather than one row of eight knobs: OSC 1 and OSC 2 hold the
 * same five parameters, and a flat row of "Oct / Semi / Fine / Level / Oct /
 * Semi / Fine / Level" gives a reader nothing to tell the halves apart.
 *
 * A recorded departure from the prototype, alongside Voice's Drift: the
 * prototype's OSC 1 carries a "Shape" knob. `OscillatorParams` has no shape or
 * pulse-width parameter, so that knob would write nowhere; OSC 1 shows the same
 * Semi trim OSC 2 does, and a shape control is its own spec.
 */
const OSC_COLOR = 'text-module-osc' as const;

const signedInt = (value: number) => (value > 0 ? `+${value}` : String(value));

/** One oscillator: its on/off state, its waveform, and its four trims. */
/** Split out of `OscUnit` only to stay under `max-lines-per-function`. */
function OscWaveformRow({
  name,
  id,
  waveform,
  onSelect,
}: {
  name: string;
  id: string;
  waveform: OscillatorWaveform;
  onSelect: (next: OscillatorWaveform) => void;
}) {
  return (
    <div role="group" aria-label={`${name} waveform`} className="grid grid-cols-4 gap-1">
      {OSCILLATOR_WAVEFORMS.map((option: OscillatorWaveform) => (
        <ToggleButton
          key={option}
          id={`btn-${id}-wave-${option}`}
          label={`${name} ${WAVEFORM_LABELS[option]}`}
          pressed={waveform === option}
          color={OSC_COLOR}
          onPress={() => onSelect(option)}
          className="px-0"
        >
          <WaveformIcon waveform={option} />
        </ToggleButton>
      ))}
    </div>
  );
}

function OscUnit({
  index,
  osc,
  onOsc,
  onOscCommitted,
  onCommit,
  onCancel,
}: {
  index: 0 | 1;
  osc: OscillatorParams;
  /** Previews a knob drag — no store write. */
  onOsc: (next: OscillatorParams) => void;
  /** A discrete pick (enable toggle, waveform button): previews AND commits
   *  in the same synchronous call, since neither has a `pointerup` of its
   *  own to hook a separate commit onto. */
  onOscCommitted: (next: OscillatorParams) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const name = `OSC ${index + 1}`;
  const id = `osc${index + 1}`;
  return (
    <div className="min-w-0 rounded-box border border-base-300 bg-base-100 p-2 space-y-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold text-base-content">{name}</span>
        <EnableToggle
          id={`btn-${id}-enabled`}
          name={name}
          enabled={osc.enabled}
          color={OSC_COLOR}
          onToggle={() => onOscCommitted({ ...osc, enabled: !osc.enabled })}
        />
      </div>

      <OscWaveformRow
        name={name}
        id={id}
        waveform={osc.waveform}
        onSelect={(waveform) => onOscCommitted({ ...osc, waveform })}
      />

      <KnobGrid
        color={OSC_COLOR}
        specs={[
          {
            id: `slider-${id}-octave`,
            label: 'Oct',
            ariaLabel: `${name} Oct`,
            value: osc.octave,
            min: -4,
            max: 4,
            step: 1,
            format: signedInt,
            onChange: (octave) => onOsc({ ...osc, octave }),
            onCommit,
            onCancel,
          },
          {
            id: `slider-${id}-semitone`,
            label: 'Semi',
            ariaLabel: `${name} Semi`,
            value: osc.semitone,
            min: -12,
            max: 12,
            step: 1,
            format: signedInt,
            onChange: (semitone) => onOsc({ ...osc, semitone }),
            onCommit,
            onCancel,
          },
          {
            id: `slider-${id}-fine`,
            label: 'Fine',
            ariaLabel: `${name} Fine`,
            value: osc.fineCents,
            min: -100,
            max: 100,
            step: 1,
            format: (v) => `${signedInt(v)} ct`,
            onChange: (fineCents) => onOsc({ ...osc, fineCents }),
            onCommit,
            onCancel,
          },
          {
            id: `slider-${id}-level`,
            label: 'Level',
            ariaLabel: `${name} Level`,
            value: osc.levelDb,
            // The patch's own floor, not a comfortable-looking round number:
            // 50 factory presets park a disabled-sounding oscillator at
            // -96 dB, and a knob whose min stopped at -60 reported an
            // aria-valuenow below its own aria-valuemin and could never be
            // dragged back down to the value it was loaded with.
            min: SYNTH_GAIN_FLOOR_DB,
            max: 0,
            step: 0.5,
            format: (v) => `${v.toFixed(1)} dB`,
            onChange: (levelDb) => onOsc({ ...osc, levelDb }),
            onCommit,
            onCancel,
          },
        ]}
      />
    </div>
  );
}

export function OscillatorPanel({ patch, onPatch, onCommit, onCancel }: PatchPanelProps) {
  const [osc1, osc2] = patch.synth.oscillators;
  const writeOsc = (index: 0 | 1, next: OscillatorParams) =>
    onPatch({
      ...patch,
      synth: {
        ...patch.synth,
        oscillators: index === 0 ? [next, osc2] : [osc1, next],
      },
    });
  const writeOscCommitted = (index: 0 | 1, next: OscillatorParams) => {
    writeOsc(index, next);
    onCommit();
  };

  return (
    <ProModule
      badge={2}
      title="Oscillators"
      color={OSC_COLOR}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <OscUnit
          index={0}
          osc={osc1}
          onOsc={(next) => writeOsc(0, next)}
          onOscCommitted={(next) => writeOscCommitted(0, next)}
          onCommit={onCommit}
          onCancel={onCancel}
        />
        <OscUnit
          index={1}
          osc={osc2}
          onOsc={(next) => writeOsc(1, next)}
          onOscCommitted={(next) => writeOscCommitted(1, next)}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </div>
    </ProModule>
  );
}
