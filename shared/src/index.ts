import { z } from 'zod';

// ==========================================
// Enums and Constants
// ==========================================

export enum RoomType {
  PERFORM = 'perform',
  ARRANGE = 'arrange',
}

export enum UserType {
  GUEST = 'GUEST',
  REGISTERED = 'REGISTERED',
  ARTIST = 'ARTIST',
  PRO = 'PRO',
}

export enum ChordModifierType {
  MAJOR = 'maj',
  MINOR = 'min',
  DIMINISHED = 'dim',
  AUGMENTED = 'aug',
  DOMINANT7 = '7',
  MAJOR7 = 'maj7',
  MINOR7 = 'min7',
  SUS2 = 'sus2',
  SUS4 = 'sus4',
}

export const CORE_NAMESPACES = ['/lobby', '/perform', '/arrange', '/approval'] as const;
export type CoreNamespace = typeof CORE_NAMESPACES[number];

export function getCoreNamespaces(): readonly string[] {
  return CORE_NAMESPACES;
}

export function isRoomNamespace(ns: string): boolean {
  return /^\/(room|perform|arrange)\/[a-f0-9-]+$/i.test(ns) || ns.startsWith('/room/');
}

export function isApprovalNamespace(ns: string): boolean {
  return /^\/approval\/[a-f0-9-]+$/i.test(ns) || ns.startsWith('/approval/');
}

export function extractRoomIdFromNamespace(ns: string): string {
  const match = ns.match(/^\/(?:room|perform|arrange)\/([a-f0-9-]+)/i);
  return match ? match[1] : ns.replace(/^\/[^/]+\/?/, '');
}

export function extractRoomIdFromApprovalNamespace(ns: string): string {
  const match = ns.match(/^\/approval\/([a-f0-9-]+)/i);
  return match ? match[1] : ns.replace(/^\/approval\/?/, '');
}

// Error Codes
export const SOCKET_ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  LOCK_FAILED: 'LOCK_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  ALREADY_JOINED: 'ALREADY_JOINED',
  INVALID_OPERATION: 'INVALID_OPERATION',
} as const;

export type SocketErrorCode = keyof typeof SOCKET_ERROR_CODES | string;

export function createSocketErrorPayload(code: SocketErrorCode, message?: string, details?: unknown) {
  return {
    code,
    message: message || `Socket error: ${code}`,
    details,
    timestamp: Date.now(),
  };
}

// Events
export const SHARED_EVENTS = {
  PING: 'shared:ping',
  PONG: 'shared:pong',
  USER_JOINED: 'shared:user_joined',
  USER_LEFT: 'shared:user_left',
  USER_UPDATE: 'shared:user_update',
  ERROR: 'shared:error',
  IDENTITY_SWAP: 'shared:identity_swap',
  ROOM_EXPIRED: 'shared:room_expired',
} as const;

export const PERFORM_EVENTS = {
  NOTE_ON: 'perform:note_on',
  NOTE_OFF: 'perform:note_off',
  PARAM_CHANGE: 'perform:param_change',
  COMPANION_UPDATE: 'perform:companion_update',
  COMPANION_NOTE: 'perform:companion_note',
  STATE_SYNC: 'perform:state_sync',
  EPHEMERAL_PARAM: 'perform:ephemeral_param',
  AUDIO_ROUTE: 'perform:audio_route',
} as const;

export const ARRANGE_EVENTS = {
  REGION_ADD: 'arrange:region_add',
  REGION_UPDATE: 'arrange:region_update',
  REGION_REMOVE: 'arrange:region_remove',
  TRACK_ADD: 'arrange:track_add',
  TRACK_UPDATE: 'arrange:track_update',
  TRACK_REMOVE: 'arrange:track_remove',
  CHORD_UPDATE: 'arrange:chord_update',
  TIMELINE_SEEK: 'arrange:timeline_seek',
  COMPANION_UPDATE: 'arrange:companion_update',
} as const;

export const ROOM_STATE_EVENTS = {
  STATE_SYNC: 'room:state_sync',
  FULL_SYNC: 'room:full_sync',
  USER_LIST: 'room:user_list',
  ROOM_UPDATE: 'room:update',
  SETTINGS_UPDATE: 'room:settings_update',
} as const;

export const ROOM_LIFECYCLE_EVENTS = {
  CREATED: 'room:created',
  CLOSED: 'room:closed',
  EXPIRED: 'room:expired',
  STATUS_CHANGED: 'room:status_changed',
} as const;

export const ROOM_SWITCH_EVENTS = {
  REQUEST: 'room_switch:request',
  RESPONSE: 'room_switch:response',
  ACCEPT: 'room_switch:accept',
} as const;

export const LOBBY_EVENTS = {
  ROOM_LIST: 'lobby:room_list',
  ROOM_CREATED: 'lobby:room_created',
  ROOM_DELETED: 'lobby:room_deleted',
  ROOM_UPDATED: 'lobby:room_updated',
  STATS: 'lobby:stats',
} as const;

export const VOICE_EVENTS = {
  OFFER: 'voice:offer',
  ANSWER: 'voice:answer',
  ICE_CANDIDATE: 'voice:ice_candidate',
  MUTE: 'voice:mute',
  SPEAKING: 'voice:speaking',
  JOIN: 'voice:join',
  LEAVE: 'voice:leave',
  HEALTH: 'voice:health',
  KEEP_ALIVE: 'voice:keep_alive',
} as const;

export const OCCUPANCY_EVENTS = {
  OCCUPANCY_CHANGED: 'occupancy:changed',
  LOCK_ACQUIRED: 'occupancy:lock_acquired',
  LOCK_RELEASED: 'occupancy:lock_released',
} as const;

export const APPROVAL_EVENTS = {
  REQUEST: 'approval:request',
  APPROVED: 'approval:approved',
  REJECTED: 'approval:rejected',
} as const;

export const APPROVAL_BE_EVENTS = {
  SUBMIT: 'approval_be:submit',
} as const;

export const METRONOME_EVENTS = {
  TICK: 'metronome:tick',
  UPDATE: 'metronome:update',
  START: 'metronome:start',
  STOP: 'metronome:stop',
} as const;

export const ERROR_EVENTS = {
  GENERAL: 'error:general',
} as const;

// Numerical Constants
export const METRONOME_CONSTANTS = {
  MIN_BPM: 40,
  MAX_BPM: 240,
  DEFAULT_BPM: 120,
  DEFAULT_TIME_SIGNATURE: '4/4',
} as const;

export const INSTRUMENT_CONSTANTS = {
  DEFAULT_INSTRUMENT: 'synthesizer',
  MAX_INSTRUMENTS: 16,
  SYNTH_MAX_POLYPHONY: 16,
} as const;

export const ROOM_CONSTANTS = {
  MAX_MEMBERS: 8,
  MAX_AUDIENCE: 100,
} as const;

export const ARRANGE_CONSTANTS = {
  MAX_TRACKS: 32,
  MAX_REGIONS: 500,
} as const;

export const PROJECT_SCHEMA_VERSION = 2;

export function isSupportedProjectSchemaVersion(version: number): boolean {
  return version >= 1 && version <= PROJECT_SCHEMA_VERSION;
}

export function isFutureProjectSchemaVersion(version: number): boolean {
  return version > PROJECT_SCHEMA_VERSION;
}

export const DEFAULT_MASTER_VOLUME_DB = 0;
export const DEFAULT_SYNTH_GAIN_DB = -6;
export const DEFAULT_COMPANION_VOLUME_DB = -6;
export const DEFAULT_VOCODER_OUTPUT_GAIN_DB = 0;

export const GRACE_PERIOD_OWNER_MS = 30000;
export const GRACE_PERIOD_MEMBER_MS = 15000;
export const ROOM_CREATION_GRACE_PERIOD_MS = 60000;
export const DISTRIBUTED_LOCK_TTL_MS = 300000;
export const DISTRIBUTED_LOCK_TIMEOUT_MS = 5000;
export const PRIMITIVE_LOCK_TTL_MS = 5000;
export const EPHEMERAL_COMMIT_TIMEOUT_MS = 1000;
export const CONNECTION_TIMEOUT_MS = 30000;

export const USER_PREFERENCES_SCHEMA_VERSION = 1;

export const AI_GENERATION_CONSTANTS = {
  MAX_PROMPT_LENGTH: 1000,
  DEFAULT_MODEL: 'gemini-2.5-flash',
  MAX_OUTPUT_TOKENS: 2048,
} as const;

export const PAGINATION_LIMITS = {
  DEFAULT: 20,
  MAX: 100,
} as const;

export const MAX_PAGE_LIMIT = 100;

export function createPaginatedResponse<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / (limit || 20)),
      hasMore: page * limit < total,
    },
  };
}

export function getProjectLimit(userType: string): number {
  switch (userType) {
    case UserType.PRO:
    case UserType.ARTIST:
      return 100;
    case UserType.REGISTERED:
      return 10;
    case UserType.GUEST:
    default:
      return 3;
  }
}

export function isProjectLimitReached(count: number, userType: string): boolean {
  return count >= getProjectLimit(userType);
}

export function isRestrictedUserTier(userType: string): boolean {
  return userType === UserType.GUEST;
}

export function quarterNoteMs(bpm: number): number {
  return (60 / Math.max(1, bpm)) * 1000;
}

export function barsToQuarterBeats(bars: number, timeSignature = '4/4'): number {
  const [num = 4] = timeSignature.split('/').map(Number);
  return bars * num;
}

export function generateBlockChordNotes(chord: string, root = 'C', octave = 4): string[] {
  const chordMap: Record<string, number[]> = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    '7': [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
  };

  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rootIndex = notes.indexOf(root.toUpperCase()) >= 0 ? notes.indexOf(root.toUpperCase()) : 0;
  const intervals = chordMap[chord.toLowerCase()] || [0, 4, 7];

  return intervals.map(semitones => {
    const totalSemitones = rootIndex + semitones;
    const noteName = notes[totalSemitones % 12];
    const oct = octave + Math.floor(totalSemitones / 12);
    return `${noteName}${oct}`;
  });
}

export const DEFAULT_COMPANION_CHORD_PROGRESSION = [
  { root: 'C', quality: 'maj', bars: 1 },
  { root: 'G', quality: 'maj', bars: 1 },
  { root: 'A', quality: 'min', bars: 1 },
  { root: 'F', quality: 'maj', bars: 1 },
];

export function resolveDrumParts(pattern: string): Record<string, boolean[]> {
  return {
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
  };
}

export function deriveRoleFromInstrument(instrument: string): string {
  if (/drum|percussion/i.test(instrument)) return 'rhythm';
  if (/bass/i.test(instrument)) return 'bass';
  if (/piano|keyboard|organ|guitar/i.test(instrument)) return 'harmony';
  return 'lead';
}

export function defaultStyleForInstrument(instrument: string): string {
  const role = deriveRoleFromInstrument(instrument);
  switch (role) {
    case 'rhythm': return 'groove';
    case 'bass': return 'walking';
    case 'harmony': return 'block';
    default: return 'arpeggio';
  }
}

export function isValidChordModifier(mod: string): boolean {
  return Object.values(ChordModifierType).includes(mod as ChordModifierType);
}

export function parsePreferencesLenient(prefs: unknown): Record<string, unknown> {
  if (typeof prefs === 'string') {
    try { return JSON.parse(prefs); } catch { return {}; }
  }
  return typeof prefs === 'object' && prefs !== null ? (prefs as Record<string, unknown>) : {};
}

export function normalizeCompanionVolumeDb(db: number): number {
  return Math.max(-60, Math.min(12, db));
}

export function getHighResolutionTime(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function calculateProcessingTime(start: number): number {
  return getHighResolutionTime() - start;
}

export function generateRandomName(): string {
  const adjectives = ['Electric', 'Sonic', 'Funky', 'Groovy', 'Cosmic', 'Velvet', 'Midnight', 'Golden', 'Neon', 'Echo'];
  const nouns = ['Synth', 'Beats', 'Rhythm', 'Vibe', 'Harmonics', 'Wave', 'Frequency', 'Groove', 'Chord', 'Band'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 900 + 100);
  return `${adj} ${noun} ${num}`;
}

export function resolveElementKind(elementId: string): string {
  if (elementId.startsWith('track:')) return 'track';
  if (elementId.startsWith('region:')) return 'region';
  if (elementId.startsWith('instrument:')) return 'instrument';
  return 'general';
}

// Zod Schemas
export const createRoomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.nativeEnum(RoomType).default(RoomType.PERFORM),
  isPrivate: z.boolean().default(false),
  maxMembers: z.number().int().min(2).max(16).default(8),
  bpm: z.number().min(40).max(240).default(120),
  timeSignature: z.string().default('4/4'),
  scale: z.string().default('C Major'),
});

export const updateRoomSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isPrivate: z.boolean().optional(),
  bpm: z.number().min(40).max(240).optional(),
  timeSignature: z.string().optional(),
  scale: z.string().optional(),
});

export const joinRoomSchema = z.object({
  roomId: z.string().min(1),
  username: z.string().min(1).max(50).optional(),
  role: z.string().optional(),
});

export const updateMetronomeSchema = z.object({
  bpm: z.number().min(40).max(240).optional(),
  isPlaying: z.boolean().optional(),
  timeSignature: z.string().optional(),
});

export function validateData<T>(schema: z.ZodType<T>, data: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// Shared Interfaces / Types
export interface ScaleSelection {
  root: string;
  type: string;
  notes?: string[];
}

export interface Scale {
  name: string;
  root: string;
  notes: string[];
}

export interface ChordBlock {
  id: string;
  root: string;
  quality: string;
  bar: number;
  durationBars: number;
}

export interface ChordTrack {
  id: string;
  name: string;
  chords: ChordBlock[];
}

export interface CompanionBarsPerChord {
  bars: number;
}

export type CompanionChordProgression = typeof DEFAULT_COMPANION_CHORD_PROGRESSION;
export type CompanionProgressionFlavor = 'pop' | 'jazz' | 'blues' | 'ambient' | 'rock' | 'funk';

export interface CompanionConfig {
  enabled: boolean;
  volumeDb: number;
  progression: CompanionChordProgression;
  flavor: CompanionProgressionFlavor;
  style: ChordPlayStyle;
  instrument: string;
}

export type ChordPlayStyle = 'block' | 'arpeggio' | 'strum' | 'pad' | 'rhythm';

export interface CompanionNoteEventPayload {
  note: string;
  duration: number;
  velocity: number;
  time: number;
  instrument: string;
}

export interface DrumPart {
  name: string;
  steps: boolean[];
}

export interface NoteEvent {
  note: string;
  velocity: number;
  duration?: number;
  instrument?: string;
  timestamp?: number;
}

export interface NoteEditOp {
  type: 'add' | 'remove' | 'modify';
  noteId?: string;
  note: string;
  time: number;
  duration: number;
  velocity?: number;
}

export interface AiNoteShape {
  note: string;
  time: number;
  duration: number;
  velocity?: number;
}

export interface ElementOccupancy {
  elementId: string;
  userId: string;
  username: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface Holder {
  userId: string;
  username: string;
  acquiredAt: number;
}

export interface JoinRoomEventData {
  roomId: string;
  userId?: string;
  username?: string;
  role?: string;
}

export interface PrepareIdentitySwapData {
  targetUserId: string;
  newUsername?: string;
}

export interface FinishTourData {
  completed: boolean;
  timestamp: number;
}

export interface ArrangeRegionAddData {
  id: string;
  trackId: string;
  startBeat: number;
  durationBeats: number;
  name: string;
  notes?: NoteEvent[];
}

export interface UpdateMetronomeData {
  bpm?: number;
  isPlaying?: boolean;
  timeSignature?: string;
}

export interface OtpChallenge {
  email: string;
  code: string;
  expiresAt: number;
}

export interface UserPreferencesPatch {
  theme?: string;
  audioInputDeviceId?: string;
  audioOutputDeviceId?: string;
  midiInputDeviceId?: string;
  volumeDb?: number;
}

export interface ProjectShareAccessResponse {
  canAccess: boolean;
  isOwner: boolean;
  role: 'owner' | 'collaborator' | 'viewer';
}
