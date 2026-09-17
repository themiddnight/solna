import type { SynthChannel, SynthControlTarget } from '@/utils/synthControl';
import { ArpeggiatorPanel } from './ArpeggiatorPanel';
import { AmpEnvelopePanel, ModEnvelopePanel } from './EnvelopePanel';
import { FilterPanel } from './FilterPanel';
import { LfoPanel } from './LfoPanel';
import { OscillatorPanel } from './OscillatorPanel';
import { UtilitySourcePanel } from './UtilitySourcePanel';
import { VoicePanel } from './VoicePanel';
import { useSynthPatchDraft } from './useSynthPatchDraft';

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
 * Voice leads, and everything after it is the order the signal travels:
 * sources, then shape, then motion. Voice sits outside that sequence because
 * it is not a point in it — mono/poly, unison, spread, glide and width settle
 * how a voice is BUILT before there is a signal to shape, which is the same
 * reading that gave it its own hue rather than the amp envelope's borrowed one
 * (see index.css's palette note). The chain is stated by the ORDER and by each
 * module's own heading, not by a caption above the rack: the prototype's flow
 * ribbon spelled the same stages out a second time in a row of its own, which
 * cost a whole band of vertical space on the densest surface in the app to
 * repeat what the modules underneath it already say. A reader who needs the
 * chain named reads the module headings in order.
 */
export function SubtractiveProPanel({
  channel,
  synthTarget,
}: {
  channel: SynthChannel;
  /** Which of the five melodic buses `channel` belongs to — this component
   *  is the SAME instance for Lead, Chord, Bass, Pad and FX, so the engine
   *  preview needs to be told which bus to move. See useSynthPatchDraft.ts. */
  synthTarget: SynthControlTarget;
}) {
  // Previews every module's drag straight to the engine and writes the store
  // exactly once on release — see useSynthPatchDraft.ts for why, and why it
  // is not simply useBeatParamDraft reused.
  const draft = useSynthPatchDraft(channel, synthTarget);

  return (
    /* A flex WRAP, not a grid. It replaced two nested grids that named their
       column counts and fraction ratios per breakpoint, plus a `col-span`
       override on each of the two widest modules — a layout that had to be
       re-tuned by hand every time a module was added, removed or reordered,
       and which silently left those overrides behind when it went. Here a
       module is as wide as its own content and `grow` shares out the slack, so
       the row count follows the viewport rather than a breakpoint table, and
       reordering a module is moving one line below.

       Bare layout, deliberately: no padding, no border, no ground of its own.
       Each module already draws its own recessed card, so a second surface
       around them inset the whole rack from the section card that holds it and
       bought nothing but a frame around a frame. */
    <div className="w-full min-w-0 flex flex-wrap gap-2">
      <VoicePanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      <OscillatorPanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      <UtilitySourcePanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      <FilterPanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      <AmpEnvelopePanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      <ModEnvelopePanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      <LfoPanel patch={draft.patch} onPatch={draft.onPatch} onCommit={draft.onCommit} onCancel={draft.onCancel} />
      {/* Arp takes the Arp object and no patch — see ArpeggiatorPanel. Arp
          settings write straight to the store on every change already (no
          engine preview to protect), so this task leaves it untouched. */}
      <ArpeggiatorPanel arp={channel.arpSettings} onArp={channel.setArpSettings} />
    </div>
  );
}
