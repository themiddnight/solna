import type { PerformRoomState, UserPerformState, RecordingStates, InstrumentCategory } from '../domain/models/PerformRoomState';
import { BaseRoomStateService } from '../../../shared/domain/room-state/BaseRoomStateService';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';
import {
  buildCompanionGenreUpdates,
  CHORD_PLAYING_STYLES,
  DEFAULT_COMPANION_CHORD_PROGRESSION,
  DISTRIBUTED_LOCK_TIMEOUT_MS,
  DISTRIBUTED_LOCK_TTL_MS,
  getGenreDefaultInstrumentForCompanionRole,
  METRONOME_CONSTANTS,
  INSTRUMENT_CONSTANTS,
  deriveRoleFromInstrument,
  defaultStyleForInstrument,
} from '@jam-band/shared';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import type {
  CompanionBarsPerChord,
  CompanionChordProgression,
  CompanionConfig,
  CompanionGenrePreset,
  CompanionIntensityStep,
  CompanionProgressionFlavor,
  ElementOccupancy,
} from '@jam-band/shared';
interface SerializedPerformRoomState {
  roomId: string;
  roomType: string;
  userStates: Array<[string, UserPerformState]>;
  recordingStates: RecordingStates;
  broadcastStates: Record<string, { username: string; isActive: boolean }>;
  voiceStates: Record<string, { isMuted: boolean }>;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  companions: CompanionConfig[];
  companionChordLength: number;
  companionChordProgression?: CompanionChordProgression;
  companionProgressionFlavor?: CompanionProgressionFlavor;
  companionSelectedGenrePreset?: CompanionGenrePreset;
  companionSelectedIntensity?: CompanionIntensityStep;
  companionOverrideInstruments?: boolean;
  lastUpdated: string | Date;
  roomScale?: { rootNote: string; scale: string };
  /** DEV-350 M4 Task 24: additive — pre-deploy Redis state (24h TTL) has no such key. */
  occupancy?: Array<[string, ElementOccupancy]>;
}

export class PerformRoomStateService extends BaseRoomStateService<PerformRoomState> {
  /* eslint-disable @typescript-eslint/member-ordering */
  protected readonly STATE_TTL = 24 * 60 * 60; // 24 hours

  protected getStateKey(roomId: string): string {
    return REDIS_KEYS.performState(roomId);
  }

  protected serializeState(state: PerformRoomState): Record<string, unknown> {
    return {
      ...state,
      userStates: Array.from(state.userStates.entries()),
      occupancy: Array.from(state.occupancy.entries()),
    };
  }

  protected deserializeState(savedState: SerializedPerformRoomState): PerformRoomState {
    const userStates = new Map<string, UserPerformState>(savedState.userStates);
    // DEV-350 M4 Task 24: `occupancy` is additive — pre-deploy Redis state (24h TTL) has no such key.
    const occupancy = new Map<string, ElementOccupancy>(savedState.occupancy ?? []);
    const lastUpdated = typeof savedState.lastUpdated === 'string' ? new Date(savedState.lastUpdated) : new Date();
    // Defensive default: chord companions persisted before the Block/Broken playing-style
    // migration may carry a legacy style (e.g. 'arp'); normalize unknown styles to 'block' so
    // the scheduler does not silently skip them. Valid chord styles (incl. 'strum') must be
    // preserved — driven by the shared CHORD_PLAYING_STYLES list so this can't drift again.
    // (companions may be absent in states saved before the field.)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const companions = savedState.companions?.map((companion) =>
      companion.role === 'chord' && !(CHORD_PLAYING_STYLES as readonly string[]).includes(companion.style)
        ? { ...companion, style: 'block' as const }
        : companion,
    );
    const companionChordLength: CompanionBarsPerChord = savedState.companionChordLength as CompanionBarsPerChord;

    return {
      ...savedState,
      userStates,
      occupancy,
      lastUpdated,
      companions,
      companionChordLength,
      companionChordProgression: savedState.companionChordProgression
        ? savedState.companionChordProgression
        : { ...DEFAULT_COMPANION_CHORD_PROGRESSION },
      // DEV-202: rooms persisted before this field load as the engine default.
      companionProgressionFlavor: savedState.companionProgressionFlavor ?? 'diatonic',
      companionSelectedGenrePreset: savedState.companionSelectedGenrePreset ?? 'pop',
      companionSelectedIntensity: savedState.companionSelectedIntensity ?? 1,
      companionOverrideInstruments: savedState.companionOverrideInstruments ?? false,
      // Defensive default for states saved before denominator was introduced
      timeSignature: {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        numerator: savedState.timeSignature?.numerator ?? 4,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        denominator: savedState.timeSignature?.denominator ?? 4,
      },
    } as PerformRoomState;
  }

  async initializeState(roomId: string): Promise<PerformRoomState> {
    const state: PerformRoomState = {
      roomId,
      roomType: 'perform',
      userStates: new Map(),
      recordingStates: {
        isAudioRecording: false,
        isSessionRecording: false,
        shadowCaptureStates: {},
      },
      broadcastStates: {},
      voiceStates: {},
      occupancy: new Map(),
      bpm: METRONOME_CONSTANTS.DEFAULT_BPM,
      timeSignature: { numerator: 4, denominator: 4 },
      companions: [],
      companionChordLength: 2,
      companionChordProgression: { ...DEFAULT_COMPANION_CHORD_PROGRESSION },
      companionProgressionFlavor: 'diatonic',
      companionSelectedGenrePreset: 'pop',
      companionSelectedIntensity: 1,
      companionOverrideInstruments: false,
      lastUpdated: new Date(),
    };

    await this.saveState(roomId, state);

    return state;
  }

  async updateUserState(roomId: string, userId: string, updates: Partial<UserPerformState>): Promise<PerformRoomState> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const newUserStates = new Map(state.userStates);
      let currentUserState = newUserStates.get(userId);
      if (!currentUserState) {
        currentUserState = {
          userId,
          username: '',
          currentInstrument: INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT,
          currentCategory: INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY as unknown as InstrumentCategory,
          effectChains: {},
          isInstrumentPracticing: false,
          isPlaying: false,
          ...updates,
        };
      } else {
        currentUserState = { ...currentUserState, ...updates };
      }

      newUserStates.set(userId, currentUserState);

      const updatedState: PerformRoomState = {
        ...state,
        userStates: newUserStates,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async addUserState(roomId: string, userId: string, userState: UserPerformState): Promise<PerformRoomState> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const newUserStates = new Map(state.userStates);
      newUserStates.set(userId, userState);

      const updatedState: PerformRoomState = {
        ...state,
        userStates: newUserStates,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async removeUserState(roomId: string, userId: string): Promise<PerformRoomState> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const newUserStates = new Map(state.userStates);
      newUserStates.delete(userId);

      const updatedState: PerformRoomState = {
        ...state,
        userStates: newUserStates,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateRecordingState(roomId: string, updates: Partial<RecordingStates>): Promise<PerformRoomState> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const updatedState: PerformRoomState = {
        ...state,
        recordingStates: {
          ...state.recordingStates,
          ...updates,
        },
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateShadowCaptureState(roomId: string, userId: string, enabled: boolean): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const updatedState: PerformRoomState = {
        ...state,
        recordingStates: {
          ...state.recordingStates,
          shadowCaptureStates: {
            ...state.recordingStates.shadowCaptureStates,
            [userId]: enabled,
          },
        },
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateMemberBroadcastState(roomId: string, userId: string, username: string, isActive: boolean): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const broadcastStates = { ...state.broadcastStates };
      if (isActive) {
        broadcastStates[userId] = { username, isActive };
      } else {
        delete broadcastStates[userId];
      }

      const updatedState: PerformRoomState = {
        ...state,
        broadcastStates,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async removeMemberBroadcastState(roomId: string, userId: string): Promise<{ username: string; isActive: boolean } | null> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      const existingState = state?.broadcastStates[userId];
      if (!state || !existingState) {
        return null;
      }

      const { [userId]: _removed, ...rest } = state.broadcastStates;
      const updatedState: PerformRoomState = {
        ...state,
        broadcastStates: rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return existingState;
    });
  }

  async updateVoiceState(roomId: string, userId: string, isMuted: boolean): Promise<PerformRoomState> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      let state = await this.getState(roomId);
      if (!state) {
        state = await this.initializeState(roomId);
      }

      const updatedState: PerformRoomState = {
        ...state,
        voiceStates: {
          ...state.voiceStates,
          [userId]: { isMuted },
        },
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async removeVoiceState(roomId: string, userId: string): Promise<boolean> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state || !state.voiceStates[userId]) {
        return false;
      }

      const { [userId]: _removed, ...rest } = state.voiceStates;
      const updatedState: PerformRoomState = {
        ...state,
        voiceStates: rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return true;
    });
  }

  /**
   * Update room scale for perform room
   */
  async updateRoomScale(roomId: string, rootNote: string, scale: 'major' | 'minor'): Promise<PerformRoomState> {
    return await this.updateState(roomId, {
      roomScale: { rootNote, scale },
    });
  }

  /**
   * Clear room scale for perform room
   */
  async clearRoomScale(roomId: string): Promise<PerformRoomState> {
        return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const { roomScale: _roomScale, ...rest } = state;
      const updatedState: PerformRoomState = {
        ...rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async addCompanion(roomId: string, companion: CompanionConfig): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const companions = state.companions;
      if (companions.length >= 5) {
        throw new Error('Maximum 5 companions allowed per room');
      }

      const updatedCompanions = [...companions, companion];
      const updatedState: PerformRoomState = {
        ...state,
        companions: updatedCompanions,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async removeCompanion(roomId: string, companionId: string): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const companions = state.companions;
      const updatedCompanions = companions.filter(c => c.id !== companionId);
      
      const updatedState: PerformRoomState = {
        ...state,
        companions: updatedCompanions,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateCompanion(roomId: string, companionId: string, updates: Partial<CompanionConfig>): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const companions = state.companions;
      const updatedCompanions = companions.map(c => {
        if (c.id === companionId) {
          return { ...c, ...updates };
        }
        return c;
      });

      const updatedState: PerformRoomState = {
        ...state,
        companions: updatedCompanions,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateAllCompanionsPlayState(roomId: string, isPlaying: boolean): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const companions = state.companions;
      const updatedCompanions = companions.map(c => ({ ...c, isPlaying }));

      const updatedState: PerformRoomState = {
        ...state,
        companions: updatedCompanions,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateAllCompanionPreset(
    roomId: string,
    genrePreset: CompanionGenrePreset,
    embellishmentIntensity: CompanionIntensityStep,
    options: { overrideInstruments?: boolean } = {},
  ): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const companions = state.companions;
      let chordSlotIndex = 0;
      const updatedCompanions: CompanionConfig[] = companions.map((companion): CompanionConfig => {
        const companionChordSlotIndex = companion.role === 'chord' ? chordSlotIndex : 0;
        if (companion.role === 'chord') chordSlotIndex += 1;

        const instrumentId = options.overrideInstruments === true
          ? getGenreDefaultInstrumentForCompanionRole(genrePreset, companion.role, companionChordSlotIndex)
          : undefined;

        if (instrumentId == null) {
          return {
            ...companion,
            ...buildCompanionGenreUpdates(genrePreset, embellishmentIntensity, companion.role),
          };
        }

        const role = deriveRoleFromInstrument(instrumentId);
        return {
          ...companion,
          instrumentId,
          role,
          style: defaultStyleForInstrument(instrumentId),
          timing: 'normal' as const,
          ...buildCompanionGenreUpdates(genrePreset, embellishmentIntensity, role),
        };
      });

      const updatedState: PerformRoomState = {
        ...state,
        companions: updatedCompanions,
        companionSelectedGenrePreset: genrePreset,
        companionSelectedIntensity: embellishmentIntensity,
        companionOverrideInstruments: options.overrideInstruments === true,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async setCompanionChordLength(roomId: string, barsPerChord: CompanionBarsPerChord): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const updatedState: PerformRoomState = {
        ...state,
        companionChordLength: barsPerChord,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async setCompanionProgressionFlavor(
    roomId: string,
    flavor: CompanionProgressionFlavor,
  ): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const updatedState: PerformRoomState = {
        ...state,
        companionProgressionFlavor: flavor,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async setCompanionPresetControls(
    roomId: string,
    updates: {
      companionSelectedGenrePreset?: CompanionGenrePreset;
      companionSelectedIntensity?: CompanionIntensityStep;
      companionOverrideInstruments?: boolean;
    },
  ): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const updatedState: PerformRoomState = {
        ...state,
        ...(updates.companionSelectedGenrePreset !== undefined
          ? { companionSelectedGenrePreset: updates.companionSelectedGenrePreset }
          : {}),
        ...(updates.companionSelectedIntensity !== undefined
          ? { companionSelectedIntensity: updates.companionSelectedIntensity }
          : {}),
        ...(updates.companionOverrideInstruments !== undefined
          ? { companionOverrideInstruments: updates.companionOverrideInstruments }
          : {}),
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async setCompanionChordProgression(
    roomId: string,
    progression: CompanionChordProgression,
  ): Promise<PerformRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Perform room state not found for room: ${roomId}`);
      }

      const updatedState: PerformRoomState = {
        ...state,
        companionChordProgression: progression,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  async updateTimeSignature(
    roomId: string,
    numerator: number,
    denominator: number = 4,
  ): Promise<PerformRoomState> {
    return await this.setTimeSignature(roomId, { numerator, denominator });
  }
}

// Export singleton instance
export const performRoomStateService = new PerformRoomStateService();
