import type { CompanionBarsPerChord, CompanionChordProgression, CompanionConfig, CompanionProgressionFlavor } from '@jam-band/shared';
import type { PerformRoomState } from '../domain/models/PerformRoomState';

export interface CompanionRuntimeSnapshot {
  roomId: string;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  roomScale?: { rootNote: string; scale: string };
  companions: CompanionConfig[];
  companionChordLength: CompanionBarsPerChord;
  companionChordProgression: CompanionChordProgression;
  companionProgressionFlavor: CompanionProgressionFlavor;
  companionPlayStartBeat?: number;
}

export class CompanionRuntimeRegistry {
  private readonly snapshots = new Map<string, CompanionRuntimeSnapshot>();

  get(roomId: string): CompanionRuntimeSnapshot | undefined {
    return this.snapshots.get(roomId);
  }

  hasActiveCompanions(roomId: string): boolean | undefined {
    const snapshot = this.snapshots.get(roomId);
    if (!snapshot) return undefined;
    return snapshot.companions.some((companion) => companion.isPlaying && !companion.isMuted);
  }

  upsertFromPerformState(
    roomId: string,
    state: Pick<
      PerformRoomState,
      'bpm' | 'timeSignature' | 'roomScale' | 'companions' | 'companionChordLength' | 'companionChordProgression' | 'companionProgressionFlavor'
    >,
    overrides: Partial<Pick<CompanionRuntimeSnapshot, 'bpm' | 'roomScale'>> = {},
  ): CompanionRuntimeSnapshot {
    const previous = this.snapshots.get(roomId);
    const roomScale = overrides.roomScale ?? state.roomScale;

    const hasPreviousPlayed = previous?.companions.some((c) => c.isPlaying) ?? false;
    const hasPlayingCompanions = state.companions.some((c) => c.isPlaying);
    // Preserve start beat only when staying in playing state — a stop→play transition must
    // reset so the scheduler picks a fresh start beat and effectiveBeat resets to 0 (chord 1).
    const companionPlayStartBeat = (hasPlayingCompanions && hasPreviousPlayed) ? previous?.companionPlayStartBeat : undefined;

    const snapshot: CompanionRuntimeSnapshot = {
      roomId,
      bpm: overrides.bpm ?? state.bpm,
      timeSignature: state.timeSignature,
      companions: state.companions,
      companionChordLength: state.companionChordLength,
      companionChordProgression: state.companionChordProgression,
      companionProgressionFlavor: state.companionProgressionFlavor,
    };

    if (companionPlayStartBeat !== undefined) {
      snapshot.companionPlayStartBeat = companionPlayStartBeat;
    }

    if (roomScale) {
      snapshot.roomScale = roomScale;
    }
    this.snapshots.set(roomId, snapshot);
    return snapshot;
  }

  update(roomId: string, updates: Partial<Omit<CompanionRuntimeSnapshot, 'roomId'>>): void {
    const previous = this.snapshots.get(roomId);
    if (!previous) return;
    this.snapshots.set(roomId, {
      ...previous,
      ...updates,
    });
  }

  clear(roomId: string): void {
    this.snapshots.delete(roomId);
  }

  clearAll(): void {
    this.snapshots.clear();
  }
}

export const companionRuntimeRegistry = new CompanionRuntimeRegistry();
