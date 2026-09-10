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

/** The store field holding a bus's fader level, in dB. */
export type SourceBusVolumeKey = SourceBus['volume'];

/** The store field holding a bus's mute flag. */
export type SourceBusMuteKey = SourceBus['muted'];

/** Narrow a bus name to its row. Undefined is impossible for a `SourceBusId`. */
export function sourceBus(id: SourceBusId): SourceBus {
  return SOURCE_BUSES.find((bus) => bus.source === id) as SourceBus;
}



