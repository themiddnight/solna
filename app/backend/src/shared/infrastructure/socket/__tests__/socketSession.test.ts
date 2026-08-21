import type { Socket } from 'socket.io';
import { setSocketSession } from '../socketSession';
import type { SocketAuthUser } from '@/config/socket';

const makeSocket = (data: Record<string, unknown>) => ({ data } as unknown as Socket);

describe('setSocketSession', () => {
  it('preserves the middleware-attached socket.data.user while assigning the session', () => {
    const user: SocketAuthUser = {
      id: 'user-1',
      username: 'tester',
      userType: 'REGISTERED',
      emailVerified: true,
    } as SocketAuthUser;
    const socket = makeSocket({ user });

    setSocketSession(socket, { roomId: 'room-1', userId: 'user-1' });

    expect((socket.data as { user?: SocketAuthUser }).user).toBe(user);
    expect((socket.data as { roomId?: string }).roomId).toBe('room-1');
    expect((socket.data as { userId?: string }).userId).toBe('user-1');
  });

  it('assigns the session even when no identity was attached (defensive)', () => {
    const socket = makeSocket({});

    setSocketSession(socket, { roomId: 'room-1', userId: 'user-1' });

    expect((socket.data as { user?: unknown }).user).toBeUndefined();
    expect((socket.data as { roomId?: string }).roomId).toBe('room-1');
  });

  it('does not carry stale session fields from a prior assignment', () => {
    const socket = makeSocket({ user: { id: 'u' }, roomId: 'old', userId: 'u', role: 'room_owner' });

    setSocketSession(socket, { roomId: 'new', userId: 'u' });

    expect((socket.data as { role?: string }).role).toBeUndefined();
    expect((socket.data as { roomId?: string }).roomId).toBe('new');
  });
});
