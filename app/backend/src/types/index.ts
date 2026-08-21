import type { ScaleSelection } from '@jam-band/shared';

export type EffectChainType = 'virtual_instrument' | 'audio_voice_input';

export enum RoomType {
  PERFORM = 'perform',
  ARRANGE = 'arrange'
}

export interface EffectParameterState {
  id: string;
  name: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  curve?: 'linear' | 'logarithmic';
}

export interface EffectInstanceState {
  id: string;
  type: string;
  name?: string;
  bypassed: boolean;
  order: number;
  parameters: EffectParameterState[];
}

export interface EffectChainState {
  type: EffectChainType;
  effects: EffectInstanceState[];
}

export interface UpdateEffectsChainData {
  chains: Record<EffectChainType, EffectChainState>;
}

// Band Member - มี instrument, effects, และ WebRTC capabilities
export interface BandMember {
  id: string;
  username: string;
  role: 'room_owner' | 'band_member';
  currentInstrument?: string;
  currentCategory?: string;
  synthParams?: Record<string, unknown>;
  /** Non-synth instrument pre-gain (DEV-301) — mirrors `synthParams`' generic shape. */
  instrumentParams?: Record<string, unknown>;
  isReady: boolean;
  followScale?: boolean;
  effectChains?: Record<EffectChainType, EffectChainState>;
  /** Profile picture URL - only present for logged-in users */
  profilePictureUrl?: string | null;
  /** User type - REGISTERED/ARTIST/PRO for logged-in users */
  userType?: 'REGISTERED' | 'ARTIST' | 'PRO';
}

// Audience - minimal fields, ไม่มี instrument/effects
export interface Audience {
  id: string;
  username: string;
  role: 'audience';
  /** Profile picture URL - only present for logged-in users */
  profilePictureUrl?: string | null;
  /** User type - REGISTERED/ARTIST/PRO for logged-in users */
  userType?: 'REGISTERED' | 'ARTIST' | 'PRO';
  joinedAt: Date;
}

// Union type สำหรับ backward compatibility
export type User = BandMember | Audience;

export interface Room {
  id: string;
  name: string;
  description?: string;
  roomType: RoomType;
  owner: string;
  
  // แยกเป็น 2 กลุ่ม: Band Members (จำกัด ~10) และ Audiences (ไม่จำกัด)
  bandMembers: Map<string, BandMember>;
  audiences: Map<string, Audience>;
  
  // Pending members เฉพาะ band members (audience ไม่ต้อง approve)
  pendingMembers: Map<string, BandMember>;
  
  isPrivate: boolean;
  isHidden: boolean;
  /** DEV-221: solo, join-locked onboarding-tour room. Non-owners are hard-rejected on join;
   *  excluded from the room list. Always cleared when the tour ends (finish or registered-swap). */
  isIsolated: boolean;
  createdAt: Date;
  metronome: MetronomeState;
  roomScale?: ScaleSelection;
  // Audience broadcast state
  isBroadcasting?: boolean;
  // Source project ID (if room was opened from a saved project)
  projectId?: string;
  
  // Invite codes
  bandMemberInviteCode?: string;
  audienceInviteCode?: string;
}

export interface UserSession {
  roomId: string;
  userId: string;
  username?: string;
  role?: 'room_owner' | 'band_member' | 'audience';
}

// NOTE: JOIN_ROOM socket handlers now type against `JoinRoomEventData` from
// `@jam-band/shared` (z.infer<typeof joinRoomSchema>) instead of a hand-maintained duplicate
// here — the duplicate (formerly `JoinRoomData`) diverged from the validation schema
// (carried `profilePictureUrl`/`userType`, which the schema never validated) and has been
// removed as part of DTO convergence.

export interface CreateRoomData {
  name: string;
  description?: string;
  roomType: RoomType;
  username: string;
  userId: string;
  isPrivate: boolean;
  isHidden: boolean;
  currentInstrument?: string;
  currentCategory?: string;
  templateId?: string;
  profilePictureUrl?: string | null;
  /** DEV-221: server-honored request to create a solo, join-locked onboarding-tour room.
   *  Grants only a benign capability (an unlisted room nobody else can join), server-bounded
   *  (one per user, auto-closed on leave). Does NOT relax hidden/private on the normal path. */
  isTourRoom?: boolean;
}

export interface ApproveMemberData {
  userId: string;
}

export interface RejectMemberData {
  userId: string;
}

export interface PlayNoteData {
  notes: string[];
  velocity: number;
  instrument: string;
  category: string;
  eventType: 'note_on' | 'note_off' | 'sustain_on' | 'sustain_off';
  isKeyHeld?: boolean;
  sampleNotes?: string[];
}

export interface ChangeInstrumentData {
  instrument: string;
  category: string;
}

export interface UpdateSynthParamsData {
  params: Record<string, unknown>;
}

export interface TransferOwnershipData {
  newOwnerId: string;
}

export interface RoomListResponse {
  id: string;
  name: string;
  description?: string;
  roomType: RoomType;
  userCount: number;
  owner: string;
  isPrivate: boolean;
  isHidden: boolean;
  createdAt: Date;
  isBroadcasting?: boolean;
}

// WebRTC Voice Communication Types
export interface VoiceOfferData {
  offer: Record<string, unknown>; // RTCSessionDescriptionInit
  targetUserId: string;
  roomId: string;
}

export interface VoiceAnswerData {
  answer: Record<string, unknown>; // RTCSessionDescriptionInit
  targetUserId: string;
  roomId: string;
}

export interface VoiceIceCandidateData {
  candidate: Record<string, unknown>; // RTCIceCandidateInit
  targetUserId: string;
  roomId: string;
}

export interface JoinVoiceData {
  roomId: string;
  userId: string;
  username: string;
}

export interface LeaveVoiceData {
  roomId: string;
  userId: string;
}

export interface VoiceMuteChangedData {
  roomId: string;
  userId: string;
  isMuted: boolean;
}

// DEV-270 — speaking (talking) indicator. No userId: the server keys off the
// verified session (TR-33), so the client only sends its room + intent.
export interface VoiceSpeakingData {
  roomId: string;
  isSpeaking: boolean;
}

export interface RequestVoiceParticipantsData {
  roomId: string;
}

export interface VoiceParticipantInfo {
  userId: string;
  username: string;
  isMuted: boolean;
  lastHeartbeat?: number;
  connectionStates?: Record<string, { connectionState: string; iceConnectionState: string }>;
}

// Chat Message Types
export interface ChatMessageData {
  message: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

// Metronome Types
export interface MetronomeState {
  bpm: number;
  /**
   * Wall-clock ms of beat 0 of the grid the room is currently playing.
   * Authoritative and persisted: every client — including one that joins an
   * hour later — schedules its beats from this single value, so the grid can
   * never depend on in-memory tick state or survive only until a restart.
   */
  beatZeroAt: number;
}

export interface MetronomeAnchor {
  bpm: number;
  beatZeroAt: number;        // server timestamp when beat 0 started
  effectiveAt?: number;  // for BPM changes: wall-clock ms when the new tempo starts
}

// Approval Namespace Types
export interface ApprovalRequestData {
  roomId: string;
  userId: string;
  username: string;
  role: 'band_member' | 'audience';
}

export interface ApprovalResponseData {
  userId: string;
  approved: boolean;
  message?: string;
}

export interface ApprovalCancelData {
  userId: string;
  roomId: string;
}

export interface ApprovalTimeoutData {
  userId: string;
  roomId: string;
  message: string;
}

export interface ApprovalSession {
  roomId: string;
  userId: string;
  username: string;
  role: 'band_member' | 'audience';
  requestedAt: Date;
  timeoutId?: NodeJS.Timeout;
}

// Scale-related types
export interface RoomScaleChangeData {
  rootNote: string;
  scale: string; // Support all tonal.js scale names (major, minor, dorian, phrygian, lydian, mixolydian, etc.)
}

export interface ToggleFollowScaleData {
  followScale: boolean;
}

// Audience Broadcast Types
export interface ToggleBroadcastData {
  isBroadcasting: boolean;
}

export interface BroadcastAudioChunkData {
  chunk: string; // Base64 encoded audio chunk
  timestamp: number;
  sequenceNumber: number;
  isInitSegment?: boolean; // True for first chunk containing WebM header
} 
