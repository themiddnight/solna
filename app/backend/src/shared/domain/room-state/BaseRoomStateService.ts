import type { BaseRoomState } from './BaseRoomState';
import { RedisStateService } from '../../infrastructure/caching/RedisStateService';
import { redisStateService } from '../../infrastructure/caching/RedisStateService';
import { loggingService } from "../../../shared/infrastructure/logging/LoggingService";
import { DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS } from '@jam-band/shared';

/* eslint-disable @typescript-eslint/member-ordering */
export abstract class BaseRoomStateService<T extends BaseRoomState> {
  protected redisState = RedisStateService.getInstance();
  protected abstract readonly STATE_TTL: number;

  // Distributed lock config — values sourced from SyncConfig to stay in sync across the codebase
  // DISTRIBUTED_LOCK_TIMEOUT_MS = 5s (how long to retry acquiring the lock)
  // DISTRIBUTED_LOCK_TTL_MS     = 10s (how long a held lock is valid before auto-expiry)

  protected abstract getStateKey(roomId: string): string;

  protected abstract serializeState(state: T): unknown;

  protected abstract deserializeState(savedState: unknown): T;

  /**
   * Get the Redis distributed lock key for a room.
   * Shared across server instances — prevents concurrent updateState on the same room.
   */
  private getRoomLockKey(roomId: string): string {
    return `room-state-mutex:${roomId}`;
  }

  async getState(roomId: string): Promise<T | null> {

    try {
      const key = this.getStateKey(roomId);
      const savedState = await this.redisState.get<unknown>(key);
      
      if (savedState == null) {
        return null;
      }

      return this.deserializeState(savedState);
    } catch (error) {
      loggingService.logError(error as Error, { 
        context: `${this.constructor.name}.getState - Redis error`, 
        roomId 
      });
      return null; // Graceful degradation
    }
  }

  async updateState(roomId: string, updates: Partial<Omit<T, 'roomId'>>): Promise<T> {
    const lockKey = this.getRoomLockKey(roomId);
    return await redisStateService.executeWithLock<T>(
      lockKey,
      DISTRIBUTED_LOCK_TIMEOUT_MS,
      DISTRIBUTED_LOCK_TTL_MS,
      async () => {
        const currentState = await this.getState(roomId);
        if (currentState == null) {
          throw new Error(`Room state not found for room: ${roomId}`);
        }

        const updatedState: T = {
          ...currentState,
          ...updates,
          lastUpdated: new Date(),
        } as T;

        await this.saveState(roomId, updatedState);
        return updatedState;
      }
    );
  }

  async saveState(roomId: string, state: T): Promise<void> {

    try {
      const stateToSave = this.serializeState(state);
      const serializedSizeBytes = Buffer.byteLength(JSON.stringify(stateToSave), 'utf8');
      if (typeof loggingService.logPerformanceMetric === 'function') {
        loggingService.logPerformanceMetric('room_state_payload_size_bytes', serializedSizeBytes, {
          service: this.constructor.name,
          roomId,
          roomType: state.roomType,
        });
      }
      await this.redisState.set(this.getStateKey(roomId), stateToSave, this.STATE_TTL);
    } catch (error) {
      loggingService.logError(error as Error, { 
        context: `${this.constructor.name}.saveState - Redis save failed`, 
        roomId 
      });
      throw error; // Propagate error for critical operations
    }
  }

  async loadState(roomId: string): Promise<T | null> {
    return await this.getState(roomId);
  }

  async deleteState(roomId: string): Promise<void> {

    try {
      await this.redisState.delete(this.getStateKey(roomId));
    } catch (error) {
      loggingService.logError(error as Error, { 
        context: `${this.constructor.name}.deleteState - Redis delete failed`, 
        roomId 
      });
      // Don't throw - best effort cleanup
    }
  }

  async clearState(roomId: string): Promise<void> {
    await this.deleteState(roomId);
  }

  async setBpm(roomId: string, bpm: number): Promise<T> {
    return await this.updateState(roomId, { bpm } as Partial<Omit<T, 'roomId'>>);
  }

  async setTimeSignature(roomId: string, timeSignature: { numerator: number; denominator: number }): Promise<T> {
    return await this.updateState(roomId, { timeSignature } as Partial<Omit<T, 'roomId'>>);
  }
}
