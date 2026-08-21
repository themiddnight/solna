import type { Socket } from 'socket.io';
import {
  SOCKET_ERROR_CODES,
  createSocketErrorPayload,
  inferSocketErrorCode,
  type SocketErrorCode,
  type SocketErrorPayload,
} from '@jam-band/shared';

type SocketErrorLike = {
  [key: string]: unknown;
  message?: string;
  error?: string;
} & Partial<SocketErrorPayload>;

const ERROR_EVENT_SUFFIXES = ['error', '_error', ':error'];

export const isSocketErrorEvent = (event: unknown): event is string => {
  if (typeof event !== 'string') return false;
  return ERROR_EVENT_SUFFIXES.some((suffix) => event === suffix || event.endsWith(suffix));
};

export const normalizeSocketErrorPayload = (
  payload: SocketErrorLike,
  fallbackCode: SocketErrorCode = SOCKET_ERROR_CODES.OPERATION_FAILED,
): SocketErrorPayload & Record<string, unknown> => {
  const message = String(payload.message ?? payload.error ?? 'An error occurred');
  return {
    ...payload,
    code: payload.code ?? inferSocketErrorCode(message, fallbackCode),
    message,
  };
};

export const createSocketConnectionError = (
  message: string,
  overrides: Partial<Omit<SocketErrorPayload, 'message'>> = {},
): Error & { data: SocketErrorPayload } => {
  const error = new Error(message) as Error & { data: SocketErrorPayload };
  error.data = createSocketErrorPayload(message, overrides);
  return error;
};

export const decorateSocketErrorEmits = (socket: Socket): void => {
  const socketWithFlag = socket as Socket & {
    socketErrorEmitDecorated?: boolean;
    emit: Socket['emit'];
  };

  if (socketWithFlag.socketErrorEmitDecorated) return;
  if (typeof socketWithFlag.emit !== 'function') return;

  const originalEmit = socketWithFlag.emit.bind(socket);
  socketWithFlag.emit = ((event: string, ...args: unknown[]) => {
    if (isSocketErrorEvent(event) && args[0] != null && typeof args[0] === 'object') {
      args[0] = normalizeSocketErrorPayload(args[0] as SocketErrorLike);
    }
    return originalEmit(event, ...args);
  }) as Socket['emit'];

  socketWithFlag.socketErrorEmitDecorated = true;
};
