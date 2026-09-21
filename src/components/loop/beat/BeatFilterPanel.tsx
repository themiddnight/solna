import { Knob } from '@/components/ui/Knob';
import { Field } from '@/components/ui/Field';
import { BEAT_FILTER_CONTROLS } from './beatControlSchema';
import type { BeatFilterParams, BeatFilterType } from '@/types';

const FILTER_TYPES: readonly BeatFilterType[] = ['lowpass', 'bandpass', 'highpass'];
const FILTER_CODES: Record<BeatFilterType, string> = {
  lowpass: 'LPF',
  bandpass: 'BPF',
  highpass: 'HPF',
};

export interface BeatFilterPanelProps {
  /** The DRAFT filter — what a knob mid-drag is showing and previewing. */
  filter: BeatFilterParams;
  /** Writes into the draft and previews it; no persisted write. */
  onDraft: (patch: Partial<BeatFilterParams>) => void;
  /** Ends a gesture by committing the draft. */
  onCommit: () => void;
  /** Ends a gesture by discarding it. */
  onCancel: () => void;
}

/**
 * The Beat-wide bus filter: type, cutoff, resonance — the LEFT half of the kit
 * row, opposite the kit selector.
 *
 * It is deliberately NOT a card. A card in this editor means ONE VOICE: eleven
 * of them sit below in a grid and every one is a kit piece you shape. The bus
 * filter is not a kit piece — it is the bus all eleven feed — so wearing the
 * voice shell would file it under the wrong kind of thing, however well the
 * shell fits. Its zone is the row that already states bus-level facts: which
 * kit is loaded, and how the whole kit is filtered. Everything below that row
 * is per-voice.
 *
 * The type switch is a click, and a click is a whole gesture: it drafts and
 * commits in one call rather than leaving a preview in flight that nothing
 * would ever end. The two knobs are pointer gestures and follow the section's
 * draft/commit/cancel contract instead.
 */
export function BeatFilterPanel({ filter, onDraft, onCommit, onCancel }: BeatFilterPanelProps) {
  const setType = (type: BeatFilterType) => {
    onDraft({ type });
    onCommit();
  };

  return (
    <div className="flex items-start gap-5 flex-wrap">
      <Field label="Bus filter">
        <div className="join">
          {FILTER_TYPES.map((type) => (
            <button
              key={type}
              id={`btn-beat-filter-${type}`}
              type="button"
              className={`btn btn-sm join-item text-[10px] font-semibold uppercase ${
                filter.type === type ? 'btn-secondary' : 'btn-ghost'
              }`}
              aria-pressed={filter.type === type}
              onClick={() => setType(type)}
            >
              {FILTER_CODES[type]}
            </button>
          ))}
        </div>
      </Field>

      {/* The two knobs come from the SCHEMA, like every voice knob: a second
          inline formatter here is what made one editor read `4400 Hz` in its
          filter and `4.4 kHz` two rows below, and inline ranges are what put
          these two outside the factory-range containment test. */}
      {BEAT_FILTER_CONTROLS.map((knob) => (
        <Field key={knob.key} label={knob.label}>
          <Knob
            id={`knob-beat-filter-${knob.key}`}
            size="sm"
            color="text-secondary"
            layout="horizontal"
            ariaLabel={`Beat filter ${knob.label}`}
            value={filter[knob.key as 'cutoff' | 'resonance']}
            min={knob.min}
            max={knob.max}
            step={knob.step}
            scale={knob.scale}
            format={knob.format}
            onChange={(value) => onDraft({ [knob.key]: value })}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        </Field>
      ))}
    </div>
  );
}
