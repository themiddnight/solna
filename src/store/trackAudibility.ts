import type { SynthControlTarget } from '@/utils/synthControl';

/**
 * The five track-solo targets, in the order the transport chip names them.
 *
 * These are USER vocabulary, not engine vocabulary. `engineSync.ts`'s
 * SOURCE_BUSES calls the same five buses `synth`/`chord`/`bass`/`pad`/
 * `sequencer`, and that table already exists to hold exactly this kind of
 * irregular mapping (see its own comment on why `sequencer` is spelled out
 * rather than derived). It gains a `solo` column so the mapping is written
 * once; nothing else translates between the two vocabularies except
 * `soloTrackForControlTarget` below.
 */
export const SOLO_TRACKS = ['lead', 'chord', 'bass', 'pad', 'drums'] as const;

export type SoloTrack = (typeof SOLO_TRACKS)[number];

/** Display names — the transport chip and every solo button's accessible name. */
export const SOLO_TRACK_LABELS: Record<SoloTrack, string> = {
  lead: 'Lead',
  chord: 'Chord',
  bass: 'Bass',
  pad: 'Pad',
  drums: 'Drums',
};

/**
 * Effective audibility for one track. THE formula, and the only place it is
 * written: `engineSync.ts` calls it for every source bus, on both the snapshot
 * pass and the subscription, and no component may compute it (src/components/
 * must not import audio/engine, and a second copy of this rule in a view is
 * how the two would drift).
 *
 * Solo beats mute, deliberately. Mute is arrangement intent, persisted per loop
 * in LoopMixPatch; solo is a monitoring gesture that is never persisted, so
 * while it is latched it is the more recent, more local statement of what the
 * user wants to hear.
 */
export function isTrackAudible(
  track: SoloTrack,
  soloTracks: readonly SoloTrack[],
  muted: boolean,
): boolean {
  return soloTracks.length > 0 ? soloTracks.includes(track) : !muted;
}

/**
 * Add or remove one track. A SET, never a radio: soloing Drums and then Lead
 * must sound both, because with the per-module play buttons gone (spec §5)
 * "write a lead over just the drums" is only expressible as two simultaneous
 * solos.
 *
 * The result is re-derived from SOLO_TRACKS rather than appended to, so the
 * stored array is always in canonical order whatever order the buttons were
 * pressed in — which is what makes the chip's label and every test's expected
 * value deterministic.
 */
export function toggleSolo(soloTracks: readonly SoloTrack[], track: SoloTrack): SoloTrack[] {
  const next = new Set<SoloTrack>(soloTracks);
  if (next.has(track)) next.delete(track);
  else next.add(track);
  return SOLO_TRACKS.filter((t) => next.has(t));
}

/**
 * The Sound view edits one layer at a time and its solo button follows that
 * choice, so it needs the one place the two vocabularies meet: the synth
 * control target `'synth'` is the track called `lead`.
 */
export function soloTrackForControlTarget(target: SynthControlTarget): SoloTrack {
  return target === 'synth' ? 'lead' : target;
}

/**
 * The transport bar's chip text, or null when nothing is soloed. Pure and
 * exported for the same reason `songModeLabel` in TransportBar.tsx is: the bar
 * is rendered through renderToString in tests, and a string is far easier to
 * assert than markup.
 */
export function soloChipLabel(soloTracks: readonly SoloTrack[]): string | null {
  if (soloTracks.length === 0) return null;
  return `SOLO · ${soloTracks.map((track) => SOLO_TRACK_LABELS[track]).join(' + ')}`;
}
