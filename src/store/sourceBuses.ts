import type { BeatMix } from '@/types';
import type { SynthControlTarget } from '@/utils/synthControl';
import type { AppStore } from './types';

/**
 * Every source bus the store owns, as `[level reader, mute reader, engine
 * source, solo track]`. Both the snapshot pass and the subscription block in
 * `engineSync.ts` are driven from this one table, on the `synthSources`
 * precedent further down — the two used to be ten hand-written lines each, and
 * a bus added to one and forgotten in the other is silent until the first
 * apply.
 *
 * The readers are FUNCTIONS rather than field names because the six buses no
 * longer live at one depth: the five melodic ones keep a flat pair of fields,
 * while the Beat bus reads `beatMix.levelDb` / `beatMix.muted`. A field-name
 * column can only name a top-level key, so the alternative was a special case
 * inside every consumer's loop — which is exactly the per-bus irregularity
 * this table exists to absorb.
 *
 * A reader takes the smallest state it needs (`SourceBusLevels`), not the
 * store: the mixdown slice runs the same table over a LOOP, which carries the
 * same fields, so one table serves the live bridge and the per-loop export.
 *
 * `solo` is the same irregularity in another direction: the ENGINE calls the
 * drum bus 'sequencer' and the lead bus 'synth', while the USER-facing solo
 * vocabulary (store/trackAudibility.ts) calls them 'drums' and 'lead'. The
 * translation is written once, here, because this table is already the place
 * that owns the per-bus name mapping.
 */
export interface SourceBusLevels {
  synthVolume: number;
  synthMuted: boolean;
  chordVolume: number;
  chordMuted: boolean;
  bassVolume: number;
  bassMuted: boolean;
  padVolume: number;
  padMuted: boolean;
  fxVolume: number;
  fxMuted: boolean;
  beatMix: BeatMix;
}

export const SOURCE_BUSES = [
  {
    source: 'synth', solo: 'lead',
    selectLevelDb: (s: SourceBusLevels) => s.synthVolume,
    selectMuted: (s: SourceBusLevels) => s.synthMuted,
  },
  {
    source: 'chord', solo: 'chord',
    selectLevelDb: (s: SourceBusLevels) => s.chordVolume,
    selectMuted: (s: SourceBusLevels) => s.chordMuted,
  },
  {
    source: 'bass', solo: 'bass',
    selectLevelDb: (s: SourceBusLevels) => s.bassVolume,
    selectMuted: (s: SourceBusLevels) => s.bassMuted,
  },
  {
    source: 'pad', solo: 'pad',
    selectLevelDb: (s: SourceBusLevels) => s.padVolume,
    selectMuted: (s: SourceBusLevels) => s.padMuted,
  },
  {
    source: 'fx', solo: 'fx',
    selectLevelDb: (s: SourceBusLevels) => s.fxVolume,
    selectMuted: (s: SourceBusLevels) => s.fxMuted,
  },
  {
    source: 'sequencer', solo: 'drums',
    selectLevelDb: (s: SourceBusLevels) => s.beatMix.levelDb,
    selectMuted: (s: SourceBusLevels) => s.beatMix.muted,
  },
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

/**
 * The store ACTION that writes each bus's Arp settings, keyed by the same
 * control target — the write half of `SYNTH_ARP_FIELD`, on the same
 * three-table precedent as `SYNTH_PARAM_FIELD`/`SYNTH_SETTER_FIELD` above.
 */
export const SYNTH_ARP_SETTER_FIELD = {
  synth: 'setSynthArpSettings',
  chord: 'setChordArpSettings',
  bass: 'setBassArpSettings',
  pad: 'setPadArpSettings',
  fx: 'setFxArpSettings',
} as const satisfies Record<SynthControlTarget, keyof AppStore>;

/** The control targets, in canonical order, derived from the map above. */
export const SYNTH_PARAM_TARGETS = Object.keys(SYNTH_PARAM_FIELD) as SynthControlTarget[];
