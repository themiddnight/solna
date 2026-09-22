import { audioEngine } from '@/audio/engine';
import type { TrackSendLevels } from '@/types';
import type { SourceBusId } from './sourceBuses';

/**
 * TRANSIENT per-track send audio: what a Mixer send knob sounds like while it
 * is being dragged, before anything is committed (DEV-423).
 *
 * In `src/store/` for the reason every engine call is — a view may not import
 * `audio/engine` — and the ONLY non-test route `useTrackSendsDraft` has to the
 * engine. Same shape as `effectsPreview.ts`: a direct, synchronous push of
 * three cheap AudioParam ramps. The committed value reaches the engine through
 * engineSync's `trackSends` subscription once `setTrackSends` runs on release.
 */
export function previewTrackSends(source: SourceBusId, sends: TrackSendLevels): void {
  audioEngine.setSourceSends(source, sends);
}
