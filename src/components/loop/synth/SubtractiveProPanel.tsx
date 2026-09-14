import type { SynthChannel } from '@/utils/synthControl';
import { ArpeggiatorPanel } from './ArpeggiatorPanel';
import { AmpEnvelopePanel, ModEnvelopePanel } from './EnvelopePanel';
import { FilterPanel } from './FilterPanel';
import { LfoPanel } from './LfoPanel';
import { OscillatorPanel } from './OscillatorPanel';
import { UtilitySourcePanel } from './UtilitySourcePanel';
import { VoicePanel } from './VoicePanel';
import type { SubtractivePatch } from './proControls';

/**
 * The approved Subtractive Pro surface — prototype Variant A, reconstructed
 * with production components
 * (docs/superpowers/prototypes/2026-09-14-synth-lab-approved-ui.html; Variant C
 * is historical and non-normative).
 *
 * It is the layout's ONE subscriber: it takes a `SynthChannel` and hands each
 * module the whole patch plus a writer. A module that reached into the store
 * for itself would re-derive the focus routing eight times, and the patch is
 * one object anyway — every module re-renders on every write regardless of who
 * subscribed.
 *
 * The order on screen is the order the signal travels: sources, then shape,
 * then motion, then voice. The ribbon above the grid says so in words, because
 * a four-column grid does not read as a chain on its own.
 */
const FLOW_STAGES: readonly { id: string; step: string; detail: string; tone: string }[] = [
  { id: 'source', step: 'SOURCE', detail: 'OSC 1 + OSC 2 + SUB + NOISE', tone: 'text-module-osc' },
  { id: 'shape', step: 'SHAPE', detail: 'DRIVE + FILTER', tone: 'text-module-filter' },
  { id: 'motion', step: 'MOTION', detail: 'ENV + LFO', tone: 'text-module-lfo' },
  { id: 'voice', step: 'VOICE', detail: 'AMP + UNISON', tone: 'text-module-env-vca' },
];

/** The ribbon: the chain in words, scrollable rather than wrapped on a phone. */
function FlowRibbon() {
  return (
    <ol className="flex items-center gap-3 overflow-x-auto no-scrollbar px-3 py-2 text-[9px] text-base-content/60 bg-base-300 border border-base-300 rounded-t-box">
      {FLOW_STAGES.map((stage) => (
        <li key={stage.id} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className={`font-bold tracking-wider ${stage.tone}`}>{stage.step}</span>
          <span aria-hidden="true" className={`w-4 h-px bg-current ${stage.tone}`} />
          <span>{stage.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export function SubtractiveProPanel({ channel }: { channel: SynthChannel }) {
  const activeSynth = channel.activeSynth;
  const patch: SubtractivePatch = activeSynth.patch;
  const onPatch = (next: SubtractivePatch) =>
    channel.setActiveSynth({ ...activeSynth, patch: next });

  return (
    <div className="w-full min-w-0">
      <FlowRibbon />
      {/* One module column on a phone, two at tablet width, the prototype's
          four-column circuit above `xl`, at the prototype's own column ratios
          (the dual oscillator needs the widest column; the Voice module the
          narrowest). The two widest modules — the dual
          oscillator and ENV 1 — span the tablet grid rather than being squeezed
          into half of it; the modulation row always spans the whole width. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.45fr_1.08fr_1fr_1.1fr] gap-2 p-2 border border-base-300 border-t-0 rounded-b-box bg-base-300/40">
        <OscillatorPanel patch={patch} onPatch={onPatch} />
        <UtilitySourcePanel patch={patch} onPatch={onPatch} />
        <FilterPanel patch={patch} onPatch={onPatch} />
        <AmpEnvelopePanel patch={patch} onPatch={onPatch} />

        <div className="col-span-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.22fr_1.08fr_0.94fr_1.08fr] gap-2">
          <ModEnvelopePanel patch={patch} onPatch={onPatch} />
          <LfoPanel patch={patch} onPatch={onPatch} />
          <VoicePanel patch={patch} onPatch={onPatch} />
          {/* Arp takes the Arp object and no patch — see ArpeggiatorPanel. */}
          <ArpeggiatorPanel arp={channel.arpSettings} onArp={channel.setArpSettings} />
        </div>
      </div>
    </div>
  );
}
