import type { Namespace, Socket } from 'socket.io';
import { PERFORM_EVENTS } from '@jam-band/shared';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import type { PerformRoomStateService } from '../../application/PerformRoomStateService';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';

interface PerformEphemeralParamsHandlerContext {
  stateService: PerformRoomStateService;
  getRoomMembershipService: () => RoomMembershipService | undefined;
  validateSession: (socket: Socket, roomId: string) => Promise<{ userId: string; username?: string } | null>;
  handleError: (socket: Socket, error: Error, context: string, roomId?: string) => void;
  /** TR-10: Schedule an ephemeral commit timeout — delegates to BaseRoomHandler. */
  scheduleEphemeralCommit: (
    roomId: string,
    userId: string,
    fieldName: string,
    value: unknown,
    commitHandler: () => Promise<void>,
  ) => void;
  /** TR-10: Clear a pending ephemeral commit timeout — delegates to BaseRoomHandler. */
  clearEphemeralCommit: (roomId: string, userId: string, fieldName: string) => void;
}

/**
 * Handles the perform room's ephemeral/commit (TR-10) parameter streams: synth params
 * and effects chains. Both share the same shape — broadcast-only ephemeral updates with
 * an auto-commit safety net, plus an explicit commit event that writes to Redis.
 * Extracted from PerformRoomHandler (TR-20 god-file split) — verbatim behavior.
 */
export class PerformEphemeralParamsHandler {
  constructor(private readonly context: PerformEphemeralParamsHandlerContext) {}

  /**
   * Handle synth params update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   */
  async handleSynthParamsUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
      instrument?: string;
      category?: string;
    }
  ): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(PERFORM_EVENTS.SYNTH_PARAMS_CHANGED, {
      userId: session.userId,
      username: session.username,
      instrument: data.instrument ?? '',
      category: data.category ?? '',
      params: data.params as Record<string, unknown>,
    });

    // TR-10: Schedule auto-commit in case user disconnects
    this.context.scheduleEphemeralCommit(
      data.roomId,
      session.userId,
      'synthParams',
      data.params,
      async () => {
        // Auto-commit the last known value
        try {
          await this.context.stateService.updateUserState(data.roomId, session.userId, {
            synthParams: data.params as Record<string, unknown>,
          });

          const roomMembershipService = this.context.getRoomMembershipService();
          if (roomMembershipService) {
            await roomMembershipService.updateUserSynthParams(
              data.roomId, session.userId, data.params as Record<string, unknown>
            ).catch(err => loggingService.logError(err as Error, {
              context: 'PerformRoomHandler.handleSynthParamsUpdate.autoCommit',
              roomId: data.roomId, userId: session.userId,
            }));
          }

          const state = await this.context.stateService.getState(data.roomId);
          const userState = state?.userStates.get(session.userId);

          namespace.to(data.roomId).emit(PERFORM_EVENTS.SYNTH_PARAMS_COMMITTED, {
            userId: session.userId,
            username: session.username,
            instrument: userState?.currentInstrument ?? '',
            category: userState?.currentCategory ?? '',
            params: data.params,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'PerformRoomHandler.handleSynthParamsUpdate.autoCommit',
            roomId: data.roomId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle synth params commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleSynthParamsCommit(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
    }
  ): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    const params = typeof data.params === 'object' && data.params !== null
      ? (data.params as Record<string, unknown>)
      : ({} as Record<string, unknown>);

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.context.clearEphemeralCommit(data.roomId, session.userId, 'synthParams');

      await this.context.stateService.updateUserState(data.roomId, session.userId, {
        synthParams: params,
      });

      const roomMembershipService = this.context.getRoomMembershipService();
      if (roomMembershipService) {
        await roomMembershipService.updateUserSynthParams(
          data.roomId, session.userId, params
        ).catch(err => loggingService.logError(err as Error, {
          context: 'PerformRoomHandler.handleSynthParamsCommit.syncMainRoomState',
          roomId: data.roomId, userId: session.userId,
        }));
      }

      const state = await this.context.stateService.getState(data.roomId);
      const userState = state?.userStates.get(session.userId);

      namespace.to(data.roomId).emit('perform:synth_params_committed', {
        userId: session.userId,
        username: session.username,
        instrument: userState?.currentInstrument ?? '',
        category: userState?.currentCategory ?? '',
        params,
      });

      loggingService.logInfo('Synth params committed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleSynthParamsCommit', data.roomId);
    }
  }

  /**
   * Handle instrument params update (EPHEMERAL — broadcast only, no Redis write)
   * DEV-301: non-synth instrument pre-gain, sibling to handleSynthParamsUpdate above —
   * same ephemeral/commit (TR-1) + auto-commit-on-disconnect (TR-10) shape.
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   */
  async handleInstrumentParamsUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
      instrument?: string;
      category?: string;
    }
  ): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(PERFORM_EVENTS.INSTRUMENT_PARAMS_CHANGED, {
      userId: session.userId,
      username: session.username,
      instrument: data.instrument ?? '',
      category: data.category ?? '',
      params: data.params as Record<string, unknown>,
    });

    // TR-10: Schedule auto-commit in case user disconnects
    this.context.scheduleEphemeralCommit(
      data.roomId,
      session.userId,
      'instrumentParams',
      data.params,
      async () => {
        // Auto-commit the last known value
        try {
          await this.context.stateService.updateUserState(data.roomId, session.userId, {
            instrumentParams: data.params as Record<string, unknown>,
          });

          const roomMembershipService = this.context.getRoomMembershipService();
          if (roomMembershipService) {
            await roomMembershipService.updateUserInstrumentParams(
              data.roomId, session.userId, data.params as Record<string, unknown>
            ).catch(err => loggingService.logError(err as Error, {
              context: 'PerformRoomHandler.handleInstrumentParamsUpdate.autoCommit',
              roomId: data.roomId, userId: session.userId,
            }));
          }

          const state = await this.context.stateService.getState(data.roomId);
          const userState = state?.userStates.get(session.userId);

          namespace.to(data.roomId).emit(PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMITTED, {
            userId: session.userId,
            username: session.username,
            instrument: userState?.currentInstrument ?? '',
            category: userState?.currentCategory ?? '',
            params: data.params,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'PerformRoomHandler.handleInstrumentParamsUpdate.autoCommit',
            roomId: data.roomId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle instrument params commit (COMMIT — save to Redis + broadcast committed)
   * DEV-301: non-synth instrument pre-gain, sibling to handleSynthParamsCommit above.
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleInstrumentParamsCommit(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      params: unknown;
    }
  ): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    const params = typeof data.params === 'object' && data.params !== null
      ? (data.params as Record<string, unknown>)
      : ({} as Record<string, unknown>);

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.context.clearEphemeralCommit(data.roomId, session.userId, 'instrumentParams');

      await this.context.stateService.updateUserState(data.roomId, session.userId, {
        instrumentParams: params,
      });

      const roomMembershipService = this.context.getRoomMembershipService();
      if (roomMembershipService) {
        await roomMembershipService.updateUserInstrumentParams(
          data.roomId, session.userId, params
        ).catch(err => loggingService.logError(err as Error, {
          context: 'PerformRoomHandler.handleInstrumentParamsCommit.syncMainRoomState',
          roomId: data.roomId, userId: session.userId,
        }));
      }

      const state = await this.context.stateService.getState(data.roomId);
      const userState = state?.userStates.get(session.userId);

      namespace.to(data.roomId).emit(PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMITTED, {
        userId: session.userId,
        username: session.username,
        instrument: userState?.currentInstrument ?? '',
        category: userState?.currentCategory ?? '',
        params,
      });

      loggingService.logInfo('Instrument params committed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleInstrumentParamsCommit', data.roomId);
    }
  }

  /**
   * Handle effects chain update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   */
  async handleEffectsChainUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      chains: unknown;
    }
  ): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    const chains: Record<string, unknown> = typeof data.chains === 'object' && data.chains !== null
      ? (data.chains as Record<string, unknown>)
      : {};

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(PERFORM_EVENTS.EFFECTS_CHAIN_CHANGED, {
      userId: session.userId,
      username: session.username,
      chains,
    });

    // TR-10: Schedule auto-commit in case user disconnects
    this.context.scheduleEphemeralCommit(
      data.roomId,
      session.userId,
      'effectChains',
      chains,
      async () => {
        // Auto-commit the last known value
        try {
          await this.context.stateService.updateUserState(data.roomId, session.userId, {
            effectChains: chains,
          });

          const roomMembershipService = this.context.getRoomMembershipService();
          if (roomMembershipService) {
            await roomMembershipService.updateUserEffectChains(
              data.roomId, session.userId, chains
            ).catch(err => loggingService.logError(err as Error, {
              context: 'PerformRoomHandler.handleEffectsChainUpdate.autoCommit',
              roomId: data.roomId, userId: session.userId,
            }));
          }

          namespace.to(data.roomId).emit(PERFORM_EVENTS.EFFECTS_CHAIN_COMMITTED, {
            userId: session.userId,
            username: session.username,
            chains,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'PerformRoomHandler.handleEffectsChainUpdate.autoCommit',
            roomId: data.roomId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle effects chain commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleEffectsChainCommit(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      chains: unknown;
    }
  ): Promise<void> {
    const session = await this.context.validateSession(socket, data.roomId);
    if (!session) return;

    const chains: Record<string, unknown> = typeof data.chains === 'object' && data.chains !== null
      ? (data.chains as Record<string, unknown>)
      : {};

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.context.clearEphemeralCommit(data.roomId, session.userId, 'effectChains');

      await this.context.stateService.updateUserState(data.roomId, session.userId, {
        effectChains: chains,
      });

      const roomMembershipService = this.context.getRoomMembershipService();
      if (roomMembershipService) {
        await roomMembershipService.updateUserEffectChains(
          data.roomId, session.userId, chains
        ).catch(err => loggingService.logError(err as Error, {
          context: 'PerformRoomHandler.handleEffectsChainCommit.syncMainRoomState',
          roomId: data.roomId, userId: session.userId,
        }));
      }

      namespace.to(data.roomId).emit('perform:effects_chain_committed', {
        userId: session.userId,
        username: session.username,
        chains,
      });

      loggingService.logInfo('Effects chain committed in perform room', {
        roomId: data.roomId,
        userId: session.userId,
      });
    } catch (error) {
      this.context.handleError(socket, error as Error, 'PerformRoomHandler.handleEffectsChainCommit', data.roomId);
    }
  }
}
