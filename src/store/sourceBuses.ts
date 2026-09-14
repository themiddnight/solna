import type { SynthControlTarget } from '@/utils/synthControl';
import type { AppStore } from './types';

/**
 * Every source bus the store owns, as `[volume field, mute field, engine
 * source, solo track]`. Both the snapshot pass and the subscription block
 * below are driven from this one table, on the `synthSources` precedent
 * further down — the two used to be ten hand-written lines each, and a bus
 * added to one and forgotten in the other is silent until the first apply.
 *
 * The field names are table data rather than a `${source}Volume` convention on
 * purpose: 'sequencer' is irregular (`masterSequencerVolume` / `drumMuted`),
 * and encoding that as a special case in the loop would cost more than
 * spelling all twelve names out.
 *
 * `solo` is the same irregularity in the other direction: the ENGINE calls the
 * drum bus 'sequencer' and the lead bus 'synth', while the USER-facing solo
 * vocabulary (store/trackAudibility.ts) calls them 'drums' and 'lead'. The
 * translation is written once, here, because this table is already the place
 * that owns the per-bus name mapping.
 */
export const SOURCE_BUSES = [
  { source: 'synth', volume: 'synthVolume', muted: 'synthMuted', solo: 'lead' },
  { source: 'chord', volume: 'chordVolume', muted: 'chordMuted', solo: 'chord' },
  { source: 'bass', volume: 'bassVolume', muted: 'bassMuted', solo: 'bass' },
  { source: 'pad', volume: 'padVolume', muted: 'padMuted', solo: 'pad' },
  { source: 'fx', volume: 'fxVolume', muted: 'fxMuted', solo: 'fx' },
  { source: 'sequencer', volume: 'masterSequencerVolume', muted: 'drumMuted', solo: 'drums' },
] as const;

/**
 * The engine's name for a mix bus — 'sequencer', not the store's 'drum' and
 * not the screen's 'Beat'. `components/mixLayers.ts` types the source it hands
 * `audioEngine.getSourceLevelAnalyser()` with this: a mixer row naming a bus
 * this table does not would otherwise be a meter that stays flat with nothing
 * failing.
 */
export type SourceBusId = (typeof SOURCE_BUSES)[number]['source'];

/** One row of the table, for callers that take a bus rather than a name. */
export type SourceBus = (typeof SOURCE_BUSES)[number];

/** Narrow a bus name to its row. Undefined is impossible for a `SourceBusId`. */
export function sourceBus(id: SourceBusId): SourceBus {
  return SOURCE_BUSES.find((bus) => bus.source === id) as SourceBus;
}




/**
 * The store field holding each synth bus's patch, keyed by control target.
 *
 * The `SOURCE_BUSES` idea one column over, and its own table rather than a
 * sixth column there, because the drum bus has no patch — a `null` cell would
 * make every reader test for it. This map was previously spelled FOUR times
 * (engineSync's snapshot pass, engineSync's subscription block, the input
 * deck's focused-params selector, SoundView's channel record), and three of
 * those failed silently when they disagreed: the engine simply never received
 * the new bus's patch, and the arp went on reading Lead's.
 *
 * `satisfies` rather than a type annotation, so the values stay literal — a
 * caller indexing the store with one gets `ActiveSynth`, not the union of
 * every `AppStore` field's type.
 */
export const SYNTH_PARAM_FIELD = {
  synth: 'synthParams',
  chord: 'chordSynthParams',
  bass: 'bassSynthParams',
  pad: 'padSynthParams',
  fx: 'fxSynthParams',
} as const satisfies Record<SynthControlTarget, keyof AppStore>;

/**
 * The store field holding each bus's Arp settings, keyed by the same control
 * target.
 *
 * A SECOND table rather than a `${target}ArpSettings` convention derived from
 * the one above, for the reason `SOURCE_BUSES` spells its irregular names out:
 * a convention has to be right for every row forever, and the moment one row
 * needs an exception the convention becomes a special case nobody can see from
 * the call site. Two tables side by side are checkable by eye.
 *
 * Arp is NOT in `SYNTH_PARAM_FIELD`'s patches, deliberately: it is performance
 * state, not patch state, so `engineSync` pushes a patch change to the DSP and
 * an Arp change reaches only the Arp player.
 */
export const SYNTH_ARP_FIELD = {
  synth: 'synthArpSettings',
  chord: 'chordArpSettings',
  bass: 'bassArpSettings',
  pad: 'padArpSettings',
  fx: 'fxArpSettings',
} as const satisfies Record<SynthControlTarget, keyof AppStore>;

/**
 * The store ACTION that writes each bus's patch, keyed by the same control
 * target — the write half of `SYNTH_PARAM_FIELD`.
 *
 * A third table beside the two above rather than a convention, for the reason
 * spelled out there: the names are irregular (`setSynthParams`, not
 * `setLeadSynthParams`) and two tables side by side are checkable by eye. It
 * It exists for the ONE module that writes a patch to a target chosen at
 * runtime: `store/synthPresetInstall.ts`, which every preset surface goes
 * through — the Sound-tab browser follows the focused track, and the three
 * module panels hand it their own fixed target. A panel writing its own bus
 * for any other reason (a knob, a toggle) names its setter directly and must
 * not reach through here.
 */
export const SYNTH_SETTER_FIELD = {
  synth: 'setSynthParams',
  chord: 'setChordSynthParams',
  bass: 'setBassSynthParams',
  pad: 'setPadSynthParams',
  fx: 'setFxSynthParams',
} as const satisfies Record<SynthControlTarget, keyof AppStore>;

/** The control targets, in canonical order, derived from the map above. */
export const SYNTH_PARAM_TARGETS = Object.keys(SYNTH_PARAM_FIELD) as SynthControlTarget[];
