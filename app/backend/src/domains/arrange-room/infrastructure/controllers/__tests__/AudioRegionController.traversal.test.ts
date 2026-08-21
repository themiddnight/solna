import type { Request, Response } from 'express';
import { createPartialMock } from '@/testing/mocks';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { ArrangeRoomStateService } from '../../../application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '../../storage/AudioRegionStorageService';
import { AudioRegionController } from '../AudioRegionController';

/**
 * DEV-195: streamRegionAudio rejects any regionId carrying a path separator or traversal
 * sequence at the boundary, before any room lookup / membership gate / file resolution runs.
 */
describe('AudioRegionController.streamRegionAudio boundary guard (DEV-195)', () => {
  const getRoom = jest.fn();
  const resolveRegionFilePath = jest.fn();

  const roomLifecycleService = createPartialMock<RoomLifecycleService>({ getRoom });
  const audioStorage = createPartialMock<AudioRegionStorageService>({ resolveRegionFilePath });
  const arrangeRoomStateService = createPartialMock<ArrangeRoomStateService>({});

  const controller = new AudioRegionController(
    roomLifecycleService,
    audioStorage,
    arrangeRoomStateService,
  );

  const makeRes = (): Response & { statusCode: number; body: unknown } => {
    const res = createPartialMock<Response & { statusCode: number; body: unknown }>({
      status: jest.fn().mockImplementation(function (this: { statusCode: number }, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn().mockImplementation(function (this: { body: unknown }, payload: unknown) {
        this.body = payload;
        return this;
      }),
    });
    return res as Response & { statusCode: number; body: unknown };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['../other-room/secret'],
    ['..%2f..%2fsecret'.replace(/%2f/g, '/')],
    ['foo/bar'],
    ['..\\windows'],
    ['..'],
  ])('rejects traversal regionId %p with 400 and never touches room/storage', async (regionId) => {
    const req = createPartialMock<Request>({
      params: { roomId: 'room-1', regionId },
      headers: {},
    });
    const res = makeRes();

    await controller.streamRegionAudio(req, res);

    expect(res.statusCode).toBe(400);
    expect(getRoom).not.toHaveBeenCalled();
    expect(resolveRegionFilePath).not.toHaveBeenCalled();
  });
});
