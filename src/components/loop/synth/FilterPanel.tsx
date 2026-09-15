import type { FilterParams, FilterType } from '@/types/synth';
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import {
  FILTER_TYPES,
  FILTER_TYPE_CODES,
  FILTER_TYPE_LABELS,
  FilterTypeIcon,
} from './FilterTypeIcon';
import {
  KnobGrid,
  ProModule,
  ToggleButton,
  type PatchPanelProps,
} from './proControls';

/**
 * Pro-Mode module 3 — filter and drive (prototype Variant A's
 * `filter-primary`).
 *
 * Four types now, not three: `FilterParams` has carried `notch` since the
 * engine cutover, and a type the patch can hold but the panel cannot show is a
 * preset a user can load and then never get back to.
 *
 * `resonance` is the unitless 0..1 synth control, NOT the Web Audio `Q` the
 * biquad adapter maps it onto — the old panel's 0.1..20 range was the Q, which
 * is why it is gone.
 */
const FILTER_COLOR = 'text-module-filter' as const;

export function FilterPanel({ patch, onPatch }: PatchPanelProps) {
  const filter = patch.synth.filter;
  const write = (next: Partial<FilterParams>) =>
    onPatch({ ...patch, synth: { ...patch.synth, filter: { ...filter, ...next } } });

  return (
    <ProModule
      badge={4}
      title="Filter + drive"
      color={FILTER_COLOR}
    >
      <div>
        <span className={FIELD_LABEL} id="label-filter-type">
          Response
        </span>
        <div
          role="group"
          aria-labelledby="label-filter-type"
          className="grid grid-cols-4 gap-1"
        >
          {FILTER_TYPES.map((type: FilterType) => (
            <ToggleButton
              key={type}
              id={`btn-filter-${type}`}
              label={FILTER_TYPE_LABELS[type]}
              pressed={filter.type === type}
              color={FILTER_COLOR}
              onPress={() => write({ type })}
              className="flex-col gap-0 h-auto py-1 px-0"
            >
              <FilterTypeIcon type={type} />
              <span className="text-[9px] leading-none">{FILTER_TYPE_CODES[type]}</span>
            </ToggleButton>
          ))}
        </div>
      </div>

      <KnobGrid
        color={FILTER_COLOR}
        size="md"
        specs={[
          {
            id: 'slider-filter-cutoff',
            label: 'Cutoff',
            value: filter.cutoffHz,
            min: 20,
            max: 20_000,
            step: 1,
            scale: 'log',
            format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`),
            onChange: (cutoffHz) => write({ cutoffHz }),
          },
          {
            id: 'slider-filter-resonance',
            label: 'Reso',
            value: filter.resonance,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${Math.round(v * 100)}%`,
            onChange: (resonance) => write({ resonance }),
          },
          {
            id: 'slider-filter-drive',
            label: 'Drive',
            value: filter.driveDb,
            min: 0,
            max: 24,
            step: 0.5,
            format: (v) => `${v.toFixed(1)} dB`,
            onChange: (driveDb) => write({ driveDb }),
          },
          {
            id: 'slider-filter-keytrack',
            label: 'Key track',
            value: filter.keyTrack,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${Math.round(v * 100)}%`,
            onChange: (keyTrack) => write({ keyTrack }),
          },
        ]}
      />
    </ProModule>
  );
}
