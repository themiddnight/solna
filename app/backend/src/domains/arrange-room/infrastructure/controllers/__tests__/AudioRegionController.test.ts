import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import { createPartialMock } from '@/testing/mocks';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import { tokenService } from '@/domains/auth/domain/services/TokenService';
import { RoomType, type Room, type BandMember, type Audience } from '@/types';
import type { ArrangeRoomStateService } from '../../../application/ArrangeRoomStateService';
import type { ArrangeRoomState, AudioRegion, MidiRegion } from '../../../domain/models/ArrangeRoomState';
import type { AudioRegionStorageService } from '../../storage/AudioRegionStorageService';
import { AudioRegionController } from '../AudioRegionController';

/**
 * AudioRegionController unit tests (Task 19 — BE test-coverage slices).
 *
 * Real controller methods, mocked storage/lifecycle services, REAL fs for temp files and
 * stream payloads, fake req/res (same shape as the existing traversal test in this folder).
 *
 * NOTE on the DEV-195 boundary guard: `streamRegionAudio` rejecting `../`-containing /
 * separator-bearing regionIds is already covered by the dedicated
 * `AudioRegionController.traversal.test.ts` in this directory — not duplicated here.
 *
 * Real API mapping:
 *   uploadRegionAudio  → POST   /api/rooms/:roomId/audio/regions  (multer `upload.single('audio')`)
 *   streamRegionAudio  → GET    /api/rooms/:roomId/audio/regions/:regionId
 */

interface ResState {
  statusCode: number;
  body: unknown;
  headers: Record<string, string | number>;
  chunks: Buffer[];
  ended: boolean;
}

type FakeRes = Response & ResState;

const makeRes = (): FakeRes => {
  const res = createPartialMock<FakeRes>({
    statusCode: 200,
    body: undefined,
    headers: {},
    chunks: [],
    ended: false,
    status: jest.fn().mockImplementation(function (this: FakeRes, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn().mockImplementation(function (this: FakeRes, payload: unknown) {
      this.body = payload;
      // Mirror Express semantics: res.json() always ends the response.
      this.ended = true;
      return this;
    }),
    setHeader: jest.fn().mockImplementation(function (
      this: FakeRes,
      key: string,
      value: string | number
    ) {
      this.headers[key] = value;
      return this;
    }),
    writeHead: jest.fn().mockImplementation(function (this: FakeRes, code: number) {
      this.statusCode = code;
      return this;
    }),
    write: jest.fn().mockImplementation(function (this: FakeRes, chunk: Buffer | string) {
      this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      return true;
    }),
    end: jest.fn().mockImplementation(function (this: FakeRes) {
      this.ended = true;
      return this;
    }),
    // Node's Readable.pipe() requires a stream-like destination: it registers error/drain/
    // finish/close/unpipe listeners on dest. No-ops are enough — the controller only relies
    // on write()/end() being called (the source side stays a real fs.ReadStream).
    on: jest.fn(),
    removeListener: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
  });
  return res;
};

/** Wait for the fs.ReadStream piped into the fake res by `streamRegionAudio` to finish. */
const waitForStreamToEnd = async (res: FakeRes): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!res.ended) {
    if (Date.now() > deadline) {
      throw new Error('piped stream did not end in time');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

const streamedBytes = (res: FakeRes): string => Buffer.concat(res.chunks).toString('utf8');

const makeRoom = (overrides: {
  roomType?: RoomType;
  isPrivate?: boolean;
  bandMemberIds?: string[];
  audienceIds?: string[];
} = {}): Room => {
  const room = createPartialMock<Room>({
    id: 'room-1',
    roomType: overrides.roomType ?? RoomType.ARRANGE,
    isPrivate: overrides.isPrivate ?? false,
    bandMembers: new Map<string, BandMember>(
      (overrides.bandMemberIds ?? []).map((id) => [id, createPartialMock<BandMember>({ id })])
    ),
    audiences: new Map<string, Audience>(
      (overrides.audienceIds ?? []).map((id) => [id, createPartialMock<Audience>({ id })])
    ),
  });
  return room;
};

const accessTokenFor = (userId: string): string =>
  tokenService.generateAccessToken({ userId, email: null, userType: 'REGISTERED' });

const MEMBER_1 = 'member-1';
const STRANGER = 'stranger-9';
const ROOM_ID = 'room-1';
const REGION_ID = 'region-1';
const PLAYBACK_URL = `http://localhost:3001/api/rooms/${ROOM_ID}/audio/regions/${REGION_ID}`;

const SAVE_RESULT = {
  filePath: '/recordings/room-1/region-1.ogg',
  fileName: 'region-1.ogg',
  durationSeconds: 1.5,
  sampleRate: 48000,
  channels: 2,
  bitrate: 192000,
  sizeBytes: 1024,
};

describe('AudioRegionController.uploadRegionAudio (POST /api/rooms/:roomId/audio/regions)', () => {
  const getRoom = jest.fn();
  const saveRegionAudio = jest.fn();
  const getRegionPlaybackPath = jest.fn();
  const getState = jest.fn();
  const updateRegion = jest.fn();

  const roomLifecycleService = createPartialMock<RoomLifecycleService>({ getRoom });
  const audioStorage = createPartialMock<AudioRegionStorageService>({
    saveRegionAudio,
    getRegionPlaybackPath,
  });
  const arrangeRoomStateService = createPartialMock<ArrangeRoomStateService>({
    getState,
    updateRegion,
  });
  const controller = new AudioRegionController(roomLifecycleService, audioStorage, arrangeRoomStateService);

  let tempDir: string;

  const tempPath = (name = 'upload.webm'): string => path.join(tempDir, name);

  const writeTempFile = (name = 'upload.webm'): string => {
    const p = tempPath(name);
    fs.writeFileSync(p, Buffer.alloc(1024));
    return p;
  };

  /** Assert the multer temp-file dir holds no residue — the cleanup contract of the brief. */
  const expectNoTempResidue = (): void => {
    expect(fs.readdirSync(tempDir)).toEqual([]);
  };

  /** Default identity is the room member; pass `user: null` to simulate an unauthenticated req. */
  const makeReq = (overrides: {
    body?: Record<string, unknown>;
    user?: Request['user'] | null;
    filePath?: string | null;
    params?: Record<string, string>;
  } = {}): Request =>
    createPartialMock<Request>({
      params: { roomId: ROOM_ID, ...(overrides.params ?? {}) },
      body: overrides.body ?? {},
      headers: {},
      user:
        overrides.user === null
          ? undefined
          : overrides.user ?? { id: MEMBER_1, email: null, username: 'member1', userType: 'REGISTERED', emailVerified: true },
      ...(overrides.filePath === null
        ? {}
        : {
            file: createPartialMock<Express.Multer.File>({
              path: overrides.filePath ?? tempPath(),
              originalname: 'clip.webm',
              mimetype: 'audio/webm',
              size: 1024,
            }),
          }),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murva-audio-region-upload-'));
    getRoom.mockResolvedValue(makeRoom({ bandMemberIds: [MEMBER_1] }));
    getRegionPlaybackPath.mockReturnValue(PLAYBACK_URL);
    saveRegionAudio.mockResolvedValue(SAVE_RESULT);
    getState.mockResolvedValue(null);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('400 when no file is attached (no temp file involved, room lookup never runs)', async () => {
    const req = makeReq({ filePath: null });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Audio file is required' });
    expect(getRoom).not.toHaveBeenCalled();
    expect(saveRegionAudio).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it.each([
    [
      'wrong MIME (multer fileFilter rejects before the controller, req.file is absent)',
      'text/plain',
    ],
    ['oversized (multer limits.fileSize rejects before the controller, req.file is absent)', 'audio/webm'],
  ])('maps %s to the 400 boundary error with no temp residue', async (_label, mimetype) => {
    // Documented existing behavior: routes/index.ts multer config (fileFilter for MIME,
    // limits.fileSize = 200MB for size) rejects these before uploadRegionAudio runs, so the
    // controller only ever sees `req.file === undefined` and maps it to 400. Multer also
    // removes its own partial uploads, so nothing reaches the temp dir.
    const req = createPartialMock<Request>({
      params: { roomId: ROOM_ID },
      body: { regionId: REGION_ID },
      headers: {},
      user: { id: MEMBER_1, email: null, username: 'member1', userType: 'REGISTERED', emailVerified: true },
      // No `file` — exactly what multer leaves behind after a rejection.
      file: undefined,
    });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Audio file is required' });
    expect(getRoom).not.toHaveBeenCalled();
    expectNoTempResidue();
    void mimetype;
  });

  it('404 when the room does not exist — temp file is removed', async () => {
    getRoom.mockResolvedValue(undefined);
    const req = makeReq({ filePath: writeTempFile() });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Arrange room not found' });
    expect(saveRegionAudio).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('404 when the room is not an ARRANGE room — temp file is removed', async () => {
    getRoom.mockResolvedValue(makeRoom({ roomType: RoomType.PERFORM }));
    const req = makeReq({ filePath: writeTempFile() });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Arrange room not found' });
    expect(saveRegionAudio).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('403 when there is no verified identity (req.user) — temp file is removed', async () => {
    const req = makeReq({ filePath: writeTempFile(), user: null });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, message: 'User not authorized for this room' });
    expect(saveRegionAudio).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('403 when the verified identity is not a room member — temp file is removed', async () => {
    const req = makeReq({ filePath: writeTempFile(), user: { id: STRANGER, email: null, username: 's', userType: 'REGISTERED', emailVerified: true } });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, message: 'User not authorized for this room' });
    expect(saveRegionAudio).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('TR-33: a multipart userId field is ignored — membership is the verified token identity', async () => {
    // Body claims a stranger's userId; the verified token belongs to a member. The upload
    // must succeed for the member — the body value must never drive membership (DEV-190
    // mirror). Also proves regionId/trackId/originalName from the body are forwarded.
    const req = makeReq({
      filePath: writeTempFile(),
      body: { userId: STRANGER, regionId: REGION_ID, trackId: 'track-1', originalName: 'custom.webm' },
    });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(201);
    expect(saveRegionAudio).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      regionId: REGION_ID,
      sourcePath: tempPath(),
      originalName: 'custom.webm',
      trackId: 'track-1',
    });
    expectNoTempResidue();
  });

  it('TR-33: body userId cannot substitute a missing token identity (still 403)', async () => {
    const req = makeReq({
      filePath: writeTempFile(),
      body: { userId: MEMBER_1 },
      user: null,
    });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(403);
    expect(saveRegionAudio).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('201 on success — responds with playback URL and audio metadata, temp file removed', async () => {
    const req = makeReq({ filePath: writeTempFile(), body: { regionId: REGION_ID } });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      success: true,
      regionId: REGION_ID,
      audioUrl: PLAYBACK_URL,
      durationSeconds: SAVE_RESULT.durationSeconds,
      sampleRate: SAVE_RESULT.sampleRate,
      channels: SAVE_RESULT.channels,
      bitrate: SAVE_RESULT.bitrate,
      sizeBytes: SAVE_RESULT.sizeBytes,
      format: 'opus',
    });
    expect(saveRegionAudio).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      regionId: REGION_ID,
      sourcePath: tempPath(),
      originalName: 'clip.webm',
    });
    expectNoTempResidue();
  });

  it('generates a regionId via crypto.randomUUID when the body carries none, and falls back to file.originalname', async () => {
    const req = makeReq({ filePath: writeTempFile() });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(201);
    const body = res.body as { success: boolean; regionId: string };
    expect(body.success).toBe(true);
    expect(body.regionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(saveRegionAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        regionId: body.regionId,
        originalName: 'clip.webm',
      })
    );
    expectNoTempResidue();
  });

  it('updates the region audioUrl in Redis state when a matching audio region exists', async () => {
    getState.mockResolvedValue(
      createPartialMock<ArrangeRoomState>({
        regions: [createPartialMock<AudioRegion>({ id: REGION_ID, type: 'audio' })],
      })
    );
    const req = makeReq({ filePath: writeTempFile(), body: { regionId: REGION_ID } });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(201);
    expect(getState).toHaveBeenCalledWith(ROOM_ID);
    expect(updateRegion).toHaveBeenCalledWith(ROOM_ID, REGION_ID, { audioUrl: PLAYBACK_URL });
    expectNoTempResidue();
  });

  it('skips the Redis state update when the matching region is not of type audio', async () => {
    getState.mockResolvedValue(
      createPartialMock<ArrangeRoomState>({
        regions: [createPartialMock<MidiRegion>({ id: REGION_ID, type: 'midi' })],
      })
    );
    const req = makeReq({ filePath: writeTempFile(), body: { regionId: REGION_ID } });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(201);
    expect(updateRegion).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('treats a Redis state read failure as non-critical — still 201, still cleans the temp file', async () => {
    getState.mockRejectedValue(new Error('redis down'));
    const req = makeReq({ filePath: writeTempFile(), body: { regionId: REGION_ID } });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(201);
    expect(updateRegion).not.toHaveBeenCalled();
    expectNoTempResidue();
  });

  it('500 when storage save fails — mapped error and the finally-branch temp cleanup', async () => {
    saveRegionAudio.mockRejectedValue(new Error('disk full'));
    const req = makeReq({ filePath: writeTempFile(), body: { regionId: REGION_ID } });
    const res = makeRes();

    await controller.uploadRegionAudio(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Failed to process audio recording' });
    expectNoTempResidue();
  });
});

describe('AudioRegionController.streamRegionAudio (GET /api/rooms/:roomId/audio/regions/:regionId)', () => {
  const getRoom = jest.fn();
  const resolveRegionFilePath = jest.fn();

  const roomLifecycleService = createPartialMock<RoomLifecycleService>({ getRoom });
  const audioStorage = createPartialMock<AudioRegionStorageService>({ resolveRegionFilePath });
  const arrangeRoomStateService = createPartialMock<ArrangeRoomStateService>({});
  const controller = new AudioRegionController(roomLifecycleService, audioStorage, arrangeRoomStateService);

  let tempDir: string;
  let regionFilePath: string;

  const makeReq = (roomId: string, regionId: string, authorization?: string): Request =>
    createPartialMock<Request>({
      params: { roomId, regionId },
      headers: authorization === undefined ? {} : { authorization: `Bearer ${authorization}` },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murva-audio-region-stream-'));
    regionFilePath = path.join(tempDir, `${REGION_ID}.ogg`);
    fs.writeFileSync(regionFilePath, '0123456789'); // 10 bytes
    getRoom.mockResolvedValue(makeRoom({ isPrivate: false }));
    resolveRegionFilePath.mockReturnValue(regionFilePath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('400 when roomId or regionId is empty', async () => {
    const res = makeRes();
    await controller.streamRegionAudio(makeReq('', REGION_ID), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Room ID and region ID are required' });
    expect(getRoom).not.toHaveBeenCalled();
  });

  it('400 for traversal-style regionIds — covered in depth by AudioRegionController.traversal.test.ts (DEV-195); not duplicated here', async () => {
    const res = makeRes();
    await controller.streamRegionAudio(makeReq(ROOM_ID, '../other-room/secret'), res);
    expect(res.statusCode).toBe(400);
    expect(getRoom).not.toHaveBeenCalled();
  });

  it('404 when the room does not exist', async () => {
    getRoom.mockResolvedValue(undefined);
    const res = makeRes();
    await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Arrange room not found' });
    expect(resolveRegionFilePath).not.toHaveBeenCalled();
  });

  it('404 when the room is not an ARRANGE room', async () => {
    getRoom.mockResolvedValue(makeRoom({ roomType: RoomType.PERFORM }));
    const res = makeRes();
    await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
    expect(res.statusCode).toBe(404);
    expect(resolveRegionFilePath).not.toHaveBeenCalled();
  });

  describe('canStreamRoomMedia authz (DEV-190)', () => {
    it('403 for a private room with no token — file resolution never runs', async () => {
      getRoom.mockResolvedValue(makeRoom({ isPrivate: true, bandMemberIds: [MEMBER_1] }));
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ success: false, message: 'Not authorized to stream this room\'s audio' });
      expect(resolveRegionFilePath).not.toHaveBeenCalled();
    });

    it('403 for a private room with an invalid token', async () => {
      getRoom.mockResolvedValue(makeRoom({ isPrivate: true, bandMemberIds: [MEMBER_1] }));
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID, 'not-a-real-token'), res);
      expect(res.statusCode).toBe(403);
      expect(resolveRegionFilePath).not.toHaveBeenCalled();
    });

    it('403 for a private room when the verified token is not a member', async () => {
      getRoom.mockResolvedValue(makeRoom({ isPrivate: true, bandMemberIds: [MEMBER_1] }));
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID, accessTokenFor(STRANGER)), res);
      expect(res.statusCode).toBe(403);
      expect(resolveRegionFilePath).not.toHaveBeenCalled();
    });

    it('200 for a private room when the verified token is a band member', async () => {
      getRoom.mockResolvedValue(makeRoom({ isPrivate: true, bandMemberIds: [MEMBER_1] }));
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID, accessTokenFor(MEMBER_1)), res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(200);
      expect(streamedBytes(res)).toBe('0123456789');
    });

    it('200 for a private room when the verified token is an audience member', async () => {
      getRoom.mockResolvedValue(makeRoom({ isPrivate: true, audienceIds: [MEMBER_1] }));
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID, accessTokenFor(MEMBER_1)), res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(200);
      expect(streamedBytes(res)).toBe('0123456789');
    });

    it('200 for a public room with no token at all — public media stays open', async () => {
      getRoom.mockResolvedValue(makeRoom({ isPrivate: false }));
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(200);
      expect(streamedBytes(res)).toBe('0123456789');
    });
  });

  describe('range request math', () => {
    it('serves the full file with 200 when no Range header is present', async () => {
      const res = makeRes();
      await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Length']).toBe(10);
      expect(res.headers['Content-Type']).toBe('audio/ogg');
      expect(res.headers['Accept-Ranges']).toBe('bytes');
      expect(streamedBytes(res)).toBe('0123456789');
    });

    it('bytes=0-3 → 206, Content-Range bytes 0-3/10, Content-Length 4, sliced bytes', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=0-3';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 0-3/10');
      expect(res.headers['Content-Length']).toBe(4);
      expect(res.headers['Content-Type']).toBe('audio/ogg');
      expect(streamedBytes(res)).toBe('0123');
    });

    it('bytes=4-7 → 206, Content-Range bytes 4-7/10, sliced bytes 4567', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=4-7';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 4-7/10');
      expect(res.headers['Content-Length']).toBe(4);
      expect(streamedBytes(res)).toBe('4567');
    });

    it('open-ended bytes=5- → 206, Content-Range bytes 5-9/10, bytes 56789', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=5-';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 5-9/10');
      expect(res.headers['Content-Length']).toBe(5);
      expect(streamedBytes(res)).toBe('56789');
    });

    it('bytes=99- is out of range → 416 with Content-Range bytes */10', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=99-';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(416);
      expect(res.headers['Content-Range']).toBe('bytes */10');
    });

    it('bytes=5-2 (start > end) → 416', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=5-2';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(416);
      expect(res.headers['Content-Range']).toBe('bytes */10');
    });

    it('bytes=-3 returns the LAST 3 bytes (RFC 7233 suffix range)', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=-3';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 7-9/10');
      expect(res.headers['Content-Length']).toBe(3);
      expect(streamedBytes(res)).toBe('789');
    });

    it('bytes=0-999 clamps end to stat.size - 1', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=0-999';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 0-9/10');
      expect(streamedBytes(res)).toBe('0123456789');
    });

    it('multi-range header is ignored per RFC 7233 §3.1 → full 200, not 416', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=0-3,5-6';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(200);
      expect(streamedBytes(res)).toBe('0123456789');
    });

    it('range-unit name is case-insensitive → Bytes=0-3 serves 206', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'Bytes=0-3';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(206);
      expect(res.headers['Content-Range']).toBe('bytes 0-3/10');
      expect(streamedBytes(res)).toBe('0123');
    });

    it('bytes=-0 covers nothing → 416 with Content-Range bytes */10', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=-0';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(416);
      expect(res.headers['Content-Range']).toBe('bytes */10');
    });

    it('bytes=- (empty range-spec) is malformed per RFC 7233 §3.1 → full 200, not 416', async () => {
      const res = makeRes();
      const req = makeReq(ROOM_ID, REGION_ID);
      req.headers.range = 'bytes=-';
      await controller.streamRegionAudio(req, res);
      await waitForStreamToEnd(res);
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Length']).toBe(10);
      expect(streamedBytes(res)).toBe('0123456789');
    });
  });

  it('404 when the storage layer cannot resolve the region file', async () => {
    resolveRegionFilePath.mockReturnValue(null);
    const res = makeRes();
    await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Audio file not found' });
  });

  it('500 when the resolved file cannot be read from disk (stat failure)', async () => {
    resolveRegionFilePath.mockReturnValue(path.join(tempDir, 'missing.ogg'));
    const res = makeRes();
    await controller.streamRegionAudio(makeReq(ROOM_ID, REGION_ID), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Failed to stream audio' });
  });
});
