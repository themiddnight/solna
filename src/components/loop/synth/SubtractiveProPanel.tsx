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
 * then motion, then voice. It is stated by the ORDER and by each module's own
 * heading, not by a caption above the grid: the prototype's flow ribbon spelled
 * the same four stages out a second time in a row of its own, which cost a
 * whole band of vertical space on the densest surface in the app to repeat what
 * the modules underneath it already say. A reader who needs the chain named
 * reads the module headings left to right.
 */
export function SubtractiveProPanel({ channel }: { channel: SynthChannel }) {
  const activeSynth = channel.activeSynth;
  const patch: SubtractivePatch = activeSynth.patch;
  const onPatch = (next: SubtractivePatch) =>
    channel.setActiveSynth({ ...activeSynth, patch: next });

  return (
    /* One module column on a phone, two at tablet width, the prototype's
       four-column circuit above `xl`, at the prototype's own column ratios
       (the dual oscillator needs the widest column; the Voice module the
       narrowest). The two widest modules — the dual oscillator and ENV 1 —
       span the tablet grid rather than being squeezed into half of it; the
       modulation row always spans the whole width.

       Bare layout, deliberately: no padding, no border, no ground of its own.
       Each module already draws its own recessed card, so a second surface
       around them inset the whole rack from the section card that holds it and
       bought nothing but a frame around a frame. */
    <div className="w-full min-w-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.45fr_1.08fr_1fr_1.1fr] gap-2">
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
  );
}
