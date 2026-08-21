import type {
  ElementOccupancy,
  AudioTempoMode,
  Scale,
  BassStyle,
  ChordPlayingStyle,
  BeatStyle,
  CompanionDensity,
  CompanionTiming,
  VoicingStyle,
  ArpRate,
  ArpDirection,
  ChordIntervalBars,
  ChordPlayStyle,
  BrokenChordPattern,
  StrumPattern,
  DrumPart,
  CompanionGenrePreset,
  CompanionIntensityStep,
  ChordTrack,
  ChordBlockChord,
  ChordBlock,
} from '@jam-band/shared';

export type TrackId = string;
export type RegionId = string;
export type NoteId = string;

/**
 * DEV-303: backend-local mirror of the frontend's `Decibels` brand
 * (`app/frontend/src/shared/audio/gainUnits.ts`). That module lives under the frontend's
 * `src/shared/` (a frontend-internal folder), NOT the monorepo `shared/` package
 * (`@jam-band/shared`, built from `shared/src/`) — it is not exported from
 * `shared/src/index.ts` and is therefore unavailable to backend code. Declared locally so
 * `Track.volume` below is a distinct type from a bare `number` (the property that matters
 * for this task), not because it needs to be the literal same TS symbol as the frontend's.
 */
export type Decibels = number & { readonly brand: 'Decibels' };

/**
 * DEV-303: brand-cast a plain number as `Decibels` at a validated trust boundary (Zod has
 * already range-checked -60..+12 by the time this runs — see `trackSchema`/
 * `arrangeTrackUpdateSchema` in `shared/src/validation/`). Mirrors the frontend's
 * `toDecibels` in `gainUnits.ts`; kept local for the same reason `Decibels` itself is local.
 */
export function toDecibels(value: number): Decibels {
  return value as Decibels;
}

/** DEV-303: unity gain (0 dB) — backend-local mirror of the frontend's `UNITY_DB`. */
export const UNITY_DB: Decibels = toDecibels(0);

export type TrackType = 'midi' | 'audio';

/** Region discriminant — a superset of `TrackType`: companion regions live on a
 *  `midi`-type track (role derived from the track's instrument), so `TrackType` itself
 *  is NOT gaining a `'companion'` member. */
export type RegionType = 'midi' | 'audio' | 'companion';

export interface MidiNote {
  id: NoteId;
  pitch: number;
  velocity: number;
  start: number;
  duration: number;
}

export interface SustainEvent {
  id: string;
  start: number;
  end: number;
}

export interface BaseRegion {
  id: RegionId;
  trackId: TrackId;
  name: string;
  start: number;
  length: number;
  loopEnabled: boolean;
  loopIterations: number;
  color?: string | undefined;
  type: RegionType;
  ownerId?: string | null | undefined;
}

export interface MidiRegion extends BaseRegion {
  type: 'midi';
  notes: MidiNote[];
  sustainEvents: SustainEvent[];
  companionMetadata?: CompanionRegionMetadata | undefined;
}

export interface AudioRegion extends BaseRegion {
  type: 'audio';
  audioUrl?: string | undefined;
  audioFileId?: string | undefined; // For deduplication - multiple regions can share the same audio file
  trimStart?: number | undefined;
  originalLength?: number | undefined;
  gain?: number | undefined;
  fadeInDuration?: number | undefined;
  fadeOutDuration?: number | undefined;
  pitchShift?: number | undefined;
  recordedBpm?: number | undefined; // BPM at which audio was recorded (for tempo sync)
  tempoMode?: AudioTempoMode | undefined;
}

/**
 * BE-local mirror of shared `CompanionRegionConfig` (arrange.ts §3.2) — a per-region
 * subset of `CompanionConfig`. Re-declared here (rather than importing the shared object
 * type directly) with every optional field's value type widened to include `| undefined`,
 * matching this file's `exactOptionalPropertyTypes` convention (see `AudioRegion` above
 * and the `RegionUpdate` doc comment) so validated Zod DTOs assign without casts.
 */
export interface CompanionRegionConfig {
  style: BassStyle | ChordPlayingStyle | BeatStyle;
  density: CompanionDensity;
  timing?: CompanionTiming | undefined;
  /** dB, unity = 0, fader range -60..+12. Never -Infinity — mute is `isMuted` below. */
  volume: Decibels;
  isMuted: boolean;
  chordComplexity?: 'triad' | 'seventh' | 'extended' | undefined;
  voicingStyle?: VoicingStyle | undefined;
  chordIntervalBars?: ChordIntervalBars | undefined;
  chordGate?: number | undefined;
  chordSustain?: boolean | undefined;
  chordOctave?: number | undefined;
  chordBassRoot?: boolean | undefined;
  chordPlayStyle?: ChordPlayStyle | undefined;
  rolledChord?: boolean | undefined;
  chordAnticipation?: boolean | undefined;
  brokenPattern?: BrokenChordPattern | undefined;
  arpRate?: ArpRate | undefined;
  arpDirection?: ArpDirection | undefined;
  arpGate?: number | undefined;
  arpOctave?: number | undefined;
  arpSustain?: boolean | undefined;
  brokenBassRoot?: boolean | undefined;
  strumPattern?: StrumPattern | undefined;
  strumSpeed?: number | undefined;
  bassPassingPattern?: 'none' | 'diatonic' | 'chromatic' | undefined;
  ghostNoteDensity?: 'none' | 'low' | 'high' | undefined;
  octaveJumps?: 'none' | 'low' | 'high' | undefined;
  anticipationAmount?: 0 | 0.5 | 1 | undefined;
  enclosure?: boolean | undefined;
  twoFeel?: boolean | undefined;
  slide?: boolean | undefined;
  drumParts?: Record<DrumPart, boolean> | undefined;
  drumFillIntervalBars?: number | undefined;
  swingPercent?: number | undefined;
  groovePocket?: 'push' | 'on-grid' | 'laidback' | undefined;
  snareVoice?: 'snare' | 'rim' | 'clap' | undefined;
  hatRoll?: 'none' | 'triplet' | '32nd' | undefined;
  ghostSnareDensity?: 'none' | 'low' | 'high' | undefined;
  percussionLayer?: 'none' | 'tambourine' | 'cowbell' | undefined;
  genrePreset?: CompanionGenrePreset | undefined;
  embellishmentIntensity?: CompanionIntensityStep | undefined;
}

/**
 * BE-local mirror of shared `CompanionRegionMetadata` (arrange.ts, DEV-279 Phase 3 §3.3).
 * Carried on a `MidiRegion` that was produced by converting a `CompanionRegion` to MIDI
 * (Task 3.3a) — captures the convert/revert "recipe": the config the notes were generated
 * from, the chord track snapshot at convert time, and when the conversion happened.
 */
export interface CompanionRegionMetadata {
  config: CompanionRegionConfig;
  chordTrackSnapshot: ChordBlock[];
  convertedAt: string;
}

export interface CompanionRegion extends BaseRegion {
  type: 'companion';
  config: CompanionRegionConfig;
  // NO `notes` — generated on the fly from config + chord track (Phase 2)
}

export type Region = MidiRegion | AudioRegion | CompanionRegion;

export interface Track {
  id: TrackId;
  name: string;
  type: TrackType;
  instrumentId?: string | undefined;
  instrumentCategory?: string | undefined;
  volume: Decibels; // dB, unity = 0. Fader range -60..+12. Never -Infinity.
  pan: number;
  color: string;
  regionIds: RegionId[];
  isTransposable?: boolean | undefined;
  ownerId?: string | null | undefined;
  isLocked?: boolean | undefined;
}

export interface ArrangeTimeSignature {
  numerator: number;
  denominator: number;
}

export interface TimeMarker {
  id: string;
  position: number;
  description?: string | undefined;
  color?: string | undefined;
}

export interface EffectParameterState {
  name: string;
  value: number;
}

export interface EffectInstanceState {
  id: string;
  type: string;
  bypassed: boolean;
  order: number;
  parameters: EffectParameterState[];
}

export interface EffectChainState {
  type: string;
  effects: EffectInstanceState[];
}

/**
 * Update ("patch") shapes for arrange entities. Each field is optional and may be
 * `undefined`, mirroring Zod `.optional()` inference under exactOptionalPropertyTypes.
 * This lets validated socket-update DTOs flow to the state service without casts.
 *
 * INVARIANT: an update never carries an explicit `undefined` for a field that is
 * REQUIRED on the base entity. Callers build patches with only the keys they change,
 * and the Socket.IO JSON transport cannot put a literal `undefined` on the wire — so the
 * `{ ...entity, ...updates } as Entity` merges in the state service can never produce an
 * entity with a required field set to `undefined`. If a non-JSON transport or a caller
 * that assigns `key: undefined` is ever introduced, strip undefined-valued keys before
 * the merge (or drop these mapped types back to `Partial<Entity>`).
 */
export type TrackUpdate = { [K in keyof Track]?: Track[K] | undefined };
export type MidiNoteUpdate = { [K in keyof MidiNote]?: MidiNote[K] | undefined };

/** All fields a region update may carry (union of midi + audio region fields). */
export interface RegionUpdate {
  name?: string | undefined;
  start?: number | undefined;
  length?: number | undefined;
  loopEnabled?: boolean | undefined;
  loopIterations?: number | undefined;
  color?: string | undefined;
  trackId?: TrackId | undefined;
  ownerId?: string | null | undefined;
  notes?: MidiNote[] | undefined;
  sustainEvents?: SustainEvent[] | undefined;
  audioUrl?: string | undefined;
  audioFileId?: string | undefined;
  trimStart?: number | undefined;
  originalLength?: number | undefined;
  gain?: number | undefined;
  fadeInDuration?: number | undefined;
  fadeOutDuration?: number | undefined;
  pitchShift?: number | undefined;
  recordedBpm?: number | undefined;
  tempoMode?: AudioTempoMode | undefined;
  config?: Partial<CompanionRegionConfig> | undefined;
}

/** Fields a marker update may carry (mirrors the marker-update DTO). */
export interface TimeMarkerUpdate {
  position?: number | undefined;
  description?: string | undefined;
  color?: string | undefined;
}

/** Fields a chord block update may carry (mirrors the chord-block-update DTO, DEV-279 P1). */
export interface ChordBlockUpdate {
  start?: number | undefined;
  duration?: number | undefined;
  chord?: ChordBlockChord | undefined;
  color?: string | undefined;
}

// DEV-303 (Important finding 3, final whole-branch review): `PROJECT_SCHEMA_VERSION` guards
// saved PROJECT FILES (project.json), not this live in-Redis `ArrangeRoomState` (24h TTL,
// see ArrangeRoomStateService/ProjectApplicationService's Redis persistence). A room created
// before this dB-migration deploy keeps linear-era `Track.volume` values in Redis with no
// version gate protecting it — any room active across the deploy will misread its stored
// volumes as dB. This is a known, accepted deploy-window risk (the epic waives backward
// compat for it), not a bug to fix here. The same gap extends to companion volume (DEV-304):
// a pre-deploy value like `70` (percent) would be misread as `+70` dB post-deploy, then
// clamped by `MixerEngine` down to `+12` dB — meaningfully louder than intended, a
// loudness-safety concern rather than just a wrong number.
export interface ArrangeRoomState {
  roomId: string;
  roomType: 'arrange';
  tracks: Track[];
  regions: Region[];
  /**
   * Element occupancy (DEV-350 M2) — additive, room-agnostic presence-badge store
   * (`RoomOccupancyService`, `OCCUPANCY_EVENTS`). This is also the CRUD-conflict guard for
   * region/companion/chord-block/note mutations (`getOwnerConflict`, `LOCK_CONFLICT` — same
   * wire event, occupancy-backed logic). The retired primitive `locks: Map<string, LockInfo>`
   * map (region/track/note/chord-block acquire-release) was fully replaced by this field —
   * its last reader (`ArrangeRoomStateService`'s note-CRUD `getActiveLockConflict` guard) was
   * migrated to occupancy in DEV-350 Round 2 Task 1, and the dead map was then deleted.
   */
  occupancy: Map<string, ElementOccupancy>;
  selectedTrackId: string | null;
  selectedRegionIds: string[];
  bpm: number;
  timeSignature: ArrangeTimeSignature;
  /**
   * Master channel fader, dB (DEV-323). Project state, like bpm above and unlike a listener's
   * own volume: it sits before the capture tap, so it is printed into every mixdown, export
   * and broadcast — it is part of the work, not of who happens to be listening.
   *
   * Optional because room state lives in Redis with a 24h TTL: a room created by the previous
   * server build is still readable after the deploy and has no such key. Read sites default it
   * to unity rather than treating its absence as an error.
   */
  masterVolume?: number;
  // DEV-226: widened from 'major' | 'minor' to Scale (string) so ProjectImportService can
  // write a coerceScale()-validated value here — arrange scales aren't limited to major/minor.
  scale?: { rootNote: string; scale: Scale };
  synthStates: Record<string, Record<string, unknown>>;
  // DEV-301: non-synth instrument pre-gain state, mirrors `synthStates`' generic shape —
  // the backend has no need for the frontend-only `InstrumentParamsState` type, same as
  // `synthStates` never referenced `SynthState` here.
  instrumentParamsStates?: Record<string, Record<string, unknown>>;
  // Key is chainType (e.g. "track:trackId", or MASTER_CHAIN_TYPE for the master channel).
  effectChains: Record<string, EffectChainState>;
  markers: TimeMarker[];
  chordTrack: ChordTrack;
  voiceStates: Record<string, { isMuted: boolean }>;
  broadcastStates: Record<
    string,
    {
      username: string;
      trackId: string | null;
    }
  >;
  projectId?: string; // ID of the project loaded in this room
  projectOwnerId?: string; // Owner of the project
  isLocked?: boolean; // Whether the project is locked by owner (prevents non-owner saves)
  hasBeenSaved: boolean; // Whether the project has been saved at least once
  lastUpdated: Date;
}

