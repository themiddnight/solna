import type { Request, Response } from 'express';
import { RoomCreationHandler } from '../infrastructure/handlers/RoomCreationHandler';
import type { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import type { AuthenticatedUser } from '@/domains/auth/infrastructure/middleware/authMiddleware';

/**
 * DEV-215 — the HTTP create-room path must derive guest/verification status (and identity) from the
 * server-verified token (`req.user`), never the request body, matching the socket path. These tests
 * lock the authorization gate: a client can no longer assert `isGuest`/`userId` to bypass it.
 */

interface MockRes {
  status: jest.Mock;
  json: jest.Mock;
}

function createMockRes(): Response & MockRes {
  const res = {} as Response & MockRes;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createReq(body: Record<string, unknown>, user?: AuthenticatedUser): Request {
  return { body, user } as unknown as Request;
}

const validBody = {
  name: 'My Room',
  username: 'ClientName',
  userId: 'client-user-id',
  isPrivate: false,
  isHidden: false,
};

const guestUser: AuthenticatedUser = {
  id: 'guest:abc',
  email: null,
  username: 'Guest',
  userType: 'GUEST',
  emailVerified: false,
};

function makeHandler() {
  const createRoom = jest.fn();
  const stub = {
    ensureUserId: (id: string) => id,
    userIdToString: (id: string) => id,
    roomLifecycleService: { createRoom },
  };
  const handler = new RoomCreationHandler(stub as unknown as RoomLifecycleHandler);
  return { handler, createRoom };
}

describe('RoomCreationHandler.handleCreateRoomHttp — TR-33 identity gate (DEV-215)', () => {
  it('blocks a guest from creating a private room even when the body claims isGuest:false', async () => {
    const { handler, createRoom } = makeHandler();
    const req = createReq({ ...validBody, isPrivate: true, isGuest: false }, guestUser);
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('returns 401 when the request carries no verified user', async () => {
    const { handler, createRoom } = makeHandler();
    const req = createReq({ ...validBody, isPrivate: true });
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('derives room-owner identity from the verified token, not the request body', async () => {
    const { handler, createRoom } = makeHandler();
    // Reject after the gate so the test stops before the (unstubbed) room-creation machinery.
    createRoom.mockRejectedValue(new Error('stop-after-gate'));
    const req = createReq(
      { ...validBody, isPrivate: false, userId: 'client-spoofed-id', username: 'client-name' },
      { id: 'verified-user-id', email: 'v@b.c', username: 'verified-name', userType: 'REGISTERED', emailVerified: true },
    );
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(createRoom).toHaveBeenCalledTimes(1);
    const args = createRoom.mock.calls[0] as unknown[];
    expect(args[1]).toBe('verified-name'); // finalUsername sourced from the token
    expect(args[2]).toBe('verified-user-id'); // finalUserId sourced from the token, not the body
  });

  it('allows a verified registered user to create a private room (reaches the service)', async () => {
    const { handler, createRoom } = makeHandler();
    createRoom.mockRejectedValue(new Error('stop-after-gate'));
    const req = createReq(
      { ...validBody, isPrivate: true },
      { id: 'u2', email: 'a@b.c', username: 'bob', userType: 'REGISTERED', emailVerified: true },
    );
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(createRoom).toHaveBeenCalledTimes(1);
  });
});

describe('RoomCreationHandler — dead socket surface removal', () => {
  it('exposes no socket create-room handler (HTTP is the only create path)', () => {
    const { handler } = makeHandler();
    const asRecord = handler as unknown as Record<string, unknown>;

    expect(typeof asRecord['handleCreateRoomHttp']).toBe('function');
    expect(asRecord['handleCreateRoom']).toBeUndefined();
  });
});
