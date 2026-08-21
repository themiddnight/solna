import type { Socket, Namespace } from 'socket.io';
import { BaseSocketHandler } from '../../../../shared/infrastructure/handlers/BaseSocketHandler';
import type { MetronomeHandler } from './MetronomeHandler';
import { secureSocketEvent } from '../../../../middleware/security';
import { METRONOME_EVENTS, updateMetronomeSchema } from '@jam-band/shared';

export class MetronomeEventHandler extends BaseSocketHandler {
  constructor(private readonly metronomeHandler: MetronomeHandler) {
    super();
  }

  public handleConnection(socket: Socket, roomId: string, namespace: Namespace): void {
    this.bindMetronomeEvents(socket, roomId, namespace);
  }

  private bindMetronomeEvents(socket: Socket, roomId: string, namespace: Namespace): void {
    socket.on(METRONOME_EVENTS.UPDATE_METRONOME, (data) => {
      void secureSocketEvent(METRONOME_EVENTS.UPDATE_METRONOME, updateMetronomeSchema,
        (socket, data) => this.metronomeHandler.handleUpdateMetronomeNamespace(socket, data, namespace))(socket, data);
    });

    socket.on(METRONOME_EVENTS.REQUEST_METRONOME_STATE, () => {
      void this.metronomeHandler.handleRequestMetronomeStateNamespace(socket, namespace);
    });
  }
}
