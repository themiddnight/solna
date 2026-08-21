import express from 'express';
import request from 'supertest';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

/**
 * routes/index.ts media gate + upload whitelist, exercised through the REAL route factory
 * (`createRoutes`) with mocked `roomLifecycleService` + `hlsBroadcastService` (harness copied
 * from rooms.audioRegions.auth.test.ts). Pins:
 *  - HLS segment endpoint: non-`.ts` segment names are rejected (400) before any room lookup —
 *    segment URLs are guessable, so the extension guard is the first line of defense;
 *  - DEV-190: `canStreamRoomMedia` is enforced on BOTH the playlist and the segment endpoint for
 *    private rooms (members-only, membership from the verified JWT); public rooms stay open;
 *  - the shared multer `fileFilter` MIME whitelist: audio / archive / json pass through to the
 *    controller, anything else surfaces as the global error handler's 415 (httpLayer mapping);
 *  - `POST /rooms` `createRoomSchema` validation → 400 with details, before the handler;
 *  - auth-before-multer ordering (TR-33): an unauthenticated upload is rejected 401 before multer
 *    ever runs, so no temp file is spooled (asserted against a unique spied temp dir).
 * Only the token verifier, user lookup, room lookup, HLS service and controllers are mocked;
 * sub-routers are stubbed so importing the route factory stays side-effect free.
 */
const mockVerifyToken = jest.fn();
jest.mock('../../domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: (token: string): unknown => mockVerifyToken(token) },
}));

const mockFindById = jest.fn() as jest.Mock<Promise<unknown>>;
jest.mock('../../domains/auth/infrastructure/repositories/UserRepository', () => ({
  UserRepository: class {
    findById(id: string): Promise<unknown> {
      return mockFindById(id);
    }
  },
}));

// Sub-routers mounted by createRoutes — replaced with passthrough middleware so their module
// graphs (controllers, prisma, B2, ...) never load in this tier.
const esModuleFlag = '__esModule';
const mockPassthroughRouter = { [esModuleFlag]: true, default: (_req: Request, _res: Response, next: NextFunction): void => next() };
jest.mock('../auth', () => mockPassthroughRouter);
jest.mock('../userPresets', () => mockPassthroughRouter);
jest.mock('../projects', () => mockPassthroughRouter);
jest.mock('../bands', () => mockPassthroughRouter);
jest.mock('../aiQueue', () => mockPassthroughRouter);
jest.mock('../aiGeneration', () => mockPassthroughRouter);
jest.mock('../bugReport', () => mockPassthroughRouter);

const mockGetPlaylist = jest.fn() as jest.Mock<string | null>;
const mockGetSegment = jest.fn() as jest.Mock<Buffer | null>;
jest.mock('../../domains/perform-room/infrastructure/services/HLSBroadcastService', () => ({
  hlsBroadcastService: {
    getPlaylist: (roomId: string): string | null => mockGetPlaylist(roomId),
    getSegment: (roomId: string, segmentName: string): Buffer | null => mockGetSegment(roomId, segmentName),
  },
}));

jest.mock('../../middleware/rateLimit', () => ({
  hlsLimiter: (_req: Request, _res: Response, next: NextFunction): void => next(),
  inviteCodeLimiter: (_req: Request, _res: Response, next: NextFunction): void => next(),
}));

jest.mock('../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logWarning: jest.fn(),
    logSecurityEvent: jest.fn(),
  },
}));

import { createRoutes } from '../index';
import type { RoomController } from '../../domains/room-management/infrastructure/controllers/RoomController';
import type { RoomLifecycleHandler } from '../../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import type { AudioRegionController } from '../../domains/arrange-room/infrastructure/controllers/AudioRegionController';
import type { ProjectController } from '../../domains/arrange-room/infrastructure/controllers/ProjectController';

const mockGetRoom = jest.fn() as jest.Mock<Promise<unknown>>;
const mockHandleCreateRoomHttp = jest.fn() as jest.Mock<void, [Request, Response]>;
const mockUploadRegionAudio = jest.fn() as jest.Mock<void, [Request, Response]>;

const app = express();
app.use(express.json());
app.use(
  '/api',
  createRoutes(
    {} as unknown as RoomController,
    {
      roomLifecycleService: { getRoom: mockGetRoom },
      handleCreateRoomHttp: (req: Request, res: Response) => mockHandleCreateRoomHttp(req, res),
    } as unknown as RoomLifecycleHandler,
    {
      uploadRegionAudio: (req: Request, res: Response) => mockUploadRegionAudio(req, res),
    } as unknown as AudioRegionController,
    {} as unknown as ProjectController
  )
);
// Mirror of the production global error handler (bootstrap/httpLayer.ts): multer fileFilter
// rejections surface here as 415 — the route factory itself has no error middleware, so without
// this the default Express handler would turn them into 500s.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    return;
  }
  if (err.message.includes('Invalid file type')) {
    res.status(415).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err.message });
});

const GUEST_PAYLOAD = { userId: 'guest:abc', email: null, username: 'Guest_abc', userType: 'GUEST', type: 'guest' };
const MEMBER_TOKEN_PAYLOAD = { userId: 'member-1', email: 'member@example.com', username: 'member', userType: 'REGISTERED', type: 'registered' };
const OUTSIDER_TOKEN_PAYLOAD = { userId: 'outsider-1', email: 'out@example.com', username: 'outsider', userType: 'REGISTERED', type: 'registered' };

const PLAYLIST_BODY = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.0,\nsegment_000.ts\n';

const privateRoom = {
  isPrivate: true,
  bandMembers: new Map([['member-1', {}]]),
  audiences: new Map(),
};

const publicRoom = {
  isPrivate: false,
  bandMembers: new Map(),
  audiences: new Map(),
};

// Unique spied upload dir: proves multer never spooled anything for rejected requests without
// racing other jest workers writing to the real os.tmpdir().
let uploadDir: string;

describe('HLS broadcast media gate (routes/index.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRoom.mockResolvedValue(undefined);
    mockGetPlaylist.mockReturnValue(null);
    mockGetSegment.mockReturnValue(null);
  });

  it('rejects a non-.ts segment name with 400 before any room lookup (guessable-URL surface)', async () => {
    const res = await request(app).get('/api/broadcast/room-1/segment_000.txt');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid segment format' });
    expect(mockGetRoom).not.toHaveBeenCalled();
    expect(mockGetSegment).not.toHaveBeenCalled();
  });

  it('rejects a private-room playlist request with no token (403)', async () => {
    mockGetRoom.mockResolvedValue(privateRoom);

    const res = await request(app).get('/api/broadcast/room-1/playlist.m3u8');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not authorized to stream this broadcast' });
    expect(mockGetPlaylist).not.toHaveBeenCalled();
  });

  it('rejects a private-room playlist request from a non-member token (403)', async () => {
    mockGetRoom.mockResolvedValue(privateRoom);
    mockVerifyToken.mockReturnValue(OUTSIDER_TOKEN_PAYLOAD);

    const res = await request(app)
      .get('/api/broadcast/room-1/playlist.m3u8')
      .set('Authorization', 'Bearer outsider-token');

    expect(res.status).toBe(403);
    expect(mockGetPlaylist).not.toHaveBeenCalled();
  });

  it('serves the playlist to a verified member of a private room', async () => {
    mockGetRoom.mockResolvedValue(privateRoom);
    mockVerifyToken.mockReturnValue(MEMBER_TOKEN_PAYLOAD);
    mockGetPlaylist.mockReturnValue(PLAYLIST_BODY);

    const res = await request(app)
      .get('/api/broadcast/room-1/playlist.m3u8')
      .set('Authorization', 'Bearer member-token');

    expect(res.status).toBe(200);
    expect(res.text).toBe(PLAYLIST_BODY);
    expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('keeps the playlist open for public rooms (no token needed)', async () => {
    mockGetRoom.mockResolvedValue(publicRoom);
    mockGetPlaylist.mockReturnValue(PLAYLIST_BODY);

    const res = await request(app).get('/api/broadcast/room-1/playlist.m3u8');

    expect(res.status).toBe(200);
    expect(res.text).toBe(PLAYLIST_BODY);
  });

  it('rejects a private-room segment request with no token (403) — same gate as the playlist', async () => {
    mockGetRoom.mockResolvedValue(privateRoom);

    const res = await request(app).get('/api/broadcast/room-1/segment_000.ts');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not authorized to stream this broadcast' });
    expect(mockGetSegment).not.toHaveBeenCalled();
  });

  it('serves the segment to a verified member of a private room', async () => {
    mockGetRoom.mockResolvedValue(privateRoom);
    mockVerifyToken.mockReturnValue(MEMBER_TOKEN_PAYLOAD);
    mockGetSegment.mockReturnValue(Buffer.from('ts-bytes'));

    const res = await request(app)
      .get('/api/broadcast/room-1/segment_000.ts')
      .set('Authorization', 'Bearer member-token');

    expect(res.status).toBe(200);
    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.toString('utf8')).toBe('ts-bytes');
    expect(res.headers['content-type']).toContain('video/mp2t');
  });

  it('keeps the segment open for public rooms (no token needed)', async () => {
    mockGetRoom.mockResolvedValue(publicRoom);
    mockGetSegment.mockReturnValue(Buffer.from('ts-bytes'));

    const res = await request(app).get('/api/broadcast/room-1/segment_000.ts');

    expect(res.status).toBe(200);
    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.toString('utf8')).toBe('ts-bytes');
  });

  it('skips the gate when the room lookup misses and falls through to 404', async () => {
    mockGetRoom.mockResolvedValue(undefined);

    const res = await request(app).get('/api/broadcast/room-1/segment_000.ts');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Segment not found' });
  });
});

describe('POST /api/rooms — createRoomSchema validation (routes/index.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockReturnValue(GUEST_PAYLOAD);
    mockHandleCreateRoomHttp.mockImplementation((_req: Request, res: Response) => {
      res.status(201).json({ success: true, room: { id: 'room-1' } });
    });
  });

  it('rejects an invalid body with 400 and validation details before the handler', async () => {
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', 'Bearer guest-token')
      .send({ name: 'Jam Room', username: 'tester', userId: 'u1', isPrivate: 'yes', isHidden: false });

    expect(res.status).toBe(400);
    const body = res.body as { success: boolean; message: string; details: string };
    expect(body.success).toBe(false);
    expect(body.message).toBe('Invalid request data');
    expect(typeof body.details).toBe('string');
    expect(body.details).toContain('expected boolean, received string');
    expect(mockHandleCreateRoomHttp).not.toHaveBeenCalled();
  });

  it('passes a valid body through with the validated payload', async () => {
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', 'Bearer guest-token')
      .send({ name: 'Jam Room', username: 'tester', userId: 'u1', isPrivate: false, isHidden: false });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, room: { id: 'room-1' } });
    expect(mockHandleCreateRoomHttp).toHaveBeenCalledTimes(1);
    const req = mockHandleCreateRoomHttp.mock.calls[0]?.[0] as Request;
    expect(req.body).toMatchObject({ name: 'Jam Room', isPrivate: false, isHidden: false });
  });
});

describe('multer MIME whitelist (routes/index.ts fileFilter)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockReturnValue(GUEST_PAYLOAD);
    mockUploadRegionAudio.mockImplementation((_req: Request, res: Response) => {
      res.status(201).json({ success: true });
    });
  });

  it.each([
    ['audio', 'audio/webm'],
    ['archive', 'application/zip'],
    ['json', 'application/json'],
  ])('admits %s mimetype through to the controller', async (_label, mimetype) => {
    const res = await request(app)
      .post('/api/rooms/room-1/audio/regions')
      .set('Authorization', 'Bearer guest-token')
      .attach('audio', Buffer.from('fake-data'), { filename: 'clip.bin', contentType: mimetype });

    expect(res.status).toBe(201);
    expect(mockUploadRegionAudio).toHaveBeenCalledTimes(1);
  });

  it('rejects a disallowed mimetype with 415 before the controller', async () => {
    const res = await request(app)
      .post('/api/rooms/room-1/audio/regions')
      .set('Authorization', 'Bearer guest-token')
      .attach('audio', Buffer.from('fake-data'), { filename: 'clip.txt', contentType: 'text/plain' });

    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Invalid file type: text/plain' });
    expect(mockUploadRegionAudio).not.toHaveBeenCalled();
  });
});

describe('auth-before-multer ordering (TR-33 — no temp spooling for unauthenticated uploads)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-gate-upload-'));
    jest.spyOn(os, 'tmpdir').mockReturnValue(uploadDir);
    mockUploadRegionAudio.mockImplementation((_req: Request, res: Response) => {
      res.status(201).json({ success: true });
    });
  });

  afterEach(() => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it('rejects an unauthenticated upload with 401 and never spools a temp file', async () => {
    const res = await request(app)
      .post('/api/rooms/room-1/audio/regions')
      .field('userId', 'someone-elses-id')
      .attach('audio', Buffer.from('fake-audio'), { filename: 'clip.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(401);
    expect(mockUploadRegionAudio).not.toHaveBeenCalled();
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('spools exactly one temp file for an authorized upload (positive control)', async () => {
    mockVerifyToken.mockReturnValue(GUEST_PAYLOAD);

    const res = await request(app)
      .post('/api/rooms/room-1/audio/regions')
      .set('Authorization', 'Bearer guest-token')
      .attach('audio', Buffer.from('fake-audio'), { filename: 'clip.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(201);
    expect(fs.readdirSync(uploadDir)).toHaveLength(1);
  });
});
