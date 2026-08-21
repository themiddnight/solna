/**
 * DEV-303 final-review fix wave (Critical 1) — regression coverage for the brand-cast wrapper
 * bug in `ArrangeEventHandler`'s TRACK_UPDATE / TRACK_PROPERTY_COMMIT handlers.
 *
 * Zod omits absent optional keys from its parsed output — a rename-only (or pan-only) payload
 * parses to e.g. `{ name: 'x' }` with NO `volume` key at all. The buggy code used to do
 * `volume: d.updates.volume === undefined ? undefined : toDecibels(d.updates.volume)`, which
 * ALWAYS re-adds a `volume` key, set to explicit `undefined` when absent. Downstream,
 * `ArrangeRoomStateMutations` does `{ ...track, ...updates }` — a JS object spread copies own
 * keys INCLUDING ones whose value is `undefined`, silently wiping the track's real stored
 * volume on ANY non-volume track update (rename, pan drag, color change, isLocked toggle, …).
 *
 * This suite exercises the actual `ArrangeEventHandler.bindArrangeEvents` wrapper (the real
 * socket.on registration + Zod validation), not `ArrangeRoomStateService.updateTrack` directly,
 * so it fails if the boundary re-introduces the `undefined`-key bug — asserting exactly what
 * `ArrangeRoomHandler.handleTrackUpdate` / `handleTrackPropertyCommit` receive as `updates`.
 *
 * Pattern mirrors `perform-room/__tests__/PerformEventHandler.test.ts` (rate-limit mocked out,
 * socket.on captured directly, roomId/namespace injected via `handleConnection`).
 */
import { ArrangeEventHandler } from '../ArrangeEventHandler';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { checkSocketRateLimitAsync } from '../../../../../middleware/rateLimit';
import type { ArrangeRoomHandler } from '../ArrangeRoomHandler';
import type { Socket, Namespace } from 'socket.io';

// Mock the rate limiter to bypass Redis/Map checks in tests (same as PerformEventHandler.test.ts)
jest.mock('../../../../../middleware/rateLimit', () => ({
  checkSocketRateLimitAsync: jest.fn(),
}));

jest.mock('../../../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logSocketEvent: jest.fn(),
    logSecurityEvent: jest.fn(),
    logValidationFailure: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
  },
}));

interface MockSocket {
  on: jest.Mock<ReturnType<Socket['on']>, Parameters<Socket['on']>>;
  emit: jest.Mock;
  id: string;
  handshake: { address: string; headers: Record<string, unknown> };
}

describe('ArrangeEventHandler — TRACK_UPDATE / TRACK_PROPERTY_COMMIT volume key-absence (DEV-303 final review, Critical 1)', () => {
  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 10));
  let arrangeEventHandler: ArrangeEventHandler;
  let mockArrangeRoomHandler: jest.Mocked<Pick<ArrangeRoomHandler, 'handleTrackUpdate' | 'handleTrackPropertyCommit'>>;
  let mockSocket: MockSocket;
  let mockNamespace: Pick<Namespace, 'name'>;
  const TEST_ROOM_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    jest.mocked(checkSocketRateLimitAsync).mockResolvedValue({ allowed: true });

    mockArrangeRoomHandler = {
      handleTrackUpdate: jest.fn(),
      handleTrackPropertyCommit: jest.fn(),
    };

    mockSocket = {
      on: jest.fn<ReturnType<Socket['on']>, Parameters<Socket['on']>>(),
      emit: jest.fn(),
      id: 'socket-123',
      handshake: { address: '127.0.0.1', headers: {} },
    };

    mockNamespace = { name: `/room/${TEST_ROOM_ID}` };

    arrangeEventHandler = new ArrangeEventHandler(mockArrangeRoomHandler as unknown as ArrangeRoomHandler);
  });

  it('does NOT add a `volume` key (not even `undefined`) when a TRACK_UPDATE payload has no volume field (rename-only)', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const trackUpdateCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.TRACK_UPDATE);
    expect(trackUpdateCall).toBeDefined();
    const eventHandler = trackUpdateCall![1] as (data: unknown) => void;

    // Rename-only payload — no `volume` key at all, mirroring what Zod produces for an
    // update that never touched volume.
    eventHandler({ roomId: TEST_ROOM_ID, trackId: 'track-1', updates: { name: 'Renamed Track' } });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleTrackUpdate).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleTrackUpdate.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; trackId: string; updates: Record<string, unknown> },
    ];

    expect(passedData.updates).toEqual({ name: 'Renamed Track' });
    // The critical assertion: no `volume` key at all — not present, not `undefined`.
    expect(Object.prototype.hasOwnProperty.call(passedData.updates, 'volume')).toBe(false);
    expect(Object.keys(passedData.updates)).toEqual(['name']);
  });

  it('does NOT add a `volume` key when a TRACK_PROPERTY_COMMIT payload has no volume field (pan-only)', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const commitCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.TRACK_PROPERTY_COMMIT);
    expect(commitCall).toBeDefined();
    const eventHandler = commitCall![1] as (data: unknown) => void;

    // Pan-only commit — a track already has a real, non-default `volume` in Redis; this
    // commit must never overwrite it with `undefined`.
    eventHandler({ roomId: TEST_ROOM_ID, trackId: 'track-1', updates: { pan: 0.5 } });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleTrackPropertyCommit).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleTrackPropertyCommit.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; trackId: string; updates: Record<string, unknown> },
    ];

    expect(passedData.updates).toEqual({ pan: 0.5 });
    expect(Object.prototype.hasOwnProperty.call(passedData.updates, 'volume')).toBe(false);
    expect(Object.keys(passedData.updates)).toEqual(['pan']);
  });

  it('still converts `volume` to dB (brand-cast) when TRACK_UPDATE genuinely includes it', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const trackUpdateCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.TRACK_UPDATE);
    const eventHandler = trackUpdateCall![1] as (data: unknown) => void;

    eventHandler({ roomId: TEST_ROOM_ID, trackId: 'track-1', updates: { volume: -12 } });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleTrackUpdate).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleTrackUpdate.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; trackId: string; updates: Record<string, unknown> },
    ];

    expect(passedData.updates).toEqual({ volume: -12 });
  });

  it('still converts `volume` to dB (brand-cast) when TRACK_PROPERTY_COMMIT genuinely includes it', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const commitCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.TRACK_PROPERTY_COMMIT);
    const eventHandler = commitCall![1] as (data: unknown) => void;

    eventHandler({ roomId: TEST_ROOM_ID, trackId: 'track-1', updates: { volume: 6 } });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleTrackPropertyCommit).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleTrackPropertyCommit.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; trackId: string; updates: Record<string, unknown> },
    ];

    expect(passedData.updates).toEqual({ volume: 6 });
  });
});

/**
 * DEV-304 fix round 1 — regression coverage for the 5 trust-boundary wrappers this task wired
 * up (`REGION_ADD`, `FULL_STATE_UPDATE` regions, `COMPANION_CONFIG_UPDATE`,
 * `COMPANION_CONFIG_COMMIT`, `COMPANION_REGION_CONVERT`), added after a reviewer caught
 * `withRegionVolumeInDecibels`'s midi branch reintroducing the EXACT DEV-303 bug class: it
 * unconditionally added a `companionMetadata: undefined` own key to a plain MIDI region that
 * never had one. The first test below is the one that would have caught it immediately.
 */
describe('ArrangeEventHandler — REGION_ADD / COMPANION_CONFIG_UPDATE key-absence (DEV-304 fix round 1)', () => {
  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 10));
  let arrangeEventHandler: ArrangeEventHandler;
  let mockArrangeRoomHandler: jest.Mocked<
    Pick<ArrangeRoomHandler, 'handleRegionAdd' | 'handleCompanionConfigUpdate'>
  >;
  let mockSocket: MockSocket;
  let mockNamespace: Pick<Namespace, 'name'>;
  const TEST_ROOM_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    jest.mocked(checkSocketRateLimitAsync).mockResolvedValue({ allowed: true });

    mockArrangeRoomHandler = {
      handleRegionAdd: jest.fn(),
      handleCompanionConfigUpdate: jest.fn(),
    };

    mockSocket = {
      on: jest.fn<ReturnType<Socket['on']>, Parameters<Socket['on']>>(),
      emit: jest.fn(),
      id: 'socket-123',
      handshake: { address: '127.0.0.1', headers: {} },
    };

    mockNamespace = { name: `/room/${TEST_ROOM_ID}` };

    arrangeEventHandler = new ArrangeEventHandler(mockArrangeRoomHandler as unknown as ArrangeRoomHandler);
  });

  const baseMidiRegion = {
    id: 'region-1',
    trackId: 'track-1',
    name: 'Midi Region',
    start: 0,
    length: 4,
    loopEnabled: false,
    loopIterations: 1,
    type: 'midi' as const,
    notes: [],
    sustainEvents: [],
  };

  it('does NOT add a `companionMetadata` key (not even `undefined`) when a REGION_ADD payload is a plain MIDI region', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const regionAddCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.REGION_ADD);
    expect(regionAddCall).toBeDefined();
    const eventHandler = regionAddCall![1] as (data: unknown) => void;

    // A plain hand-authored MIDI region — no `companionMetadata` field at all, mirroring
    // what Zod's `.optional()` produces when the client never sends it.
    eventHandler({ roomId: TEST_ROOM_ID, region: baseMidiRegion });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleRegionAdd).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleRegionAdd.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; region: Record<string, unknown> },
    ];

    // The critical assertion (Finding 1): no `companionMetadata` key at all — not present,
    // not `undefined`.
    expect(Object.prototype.hasOwnProperty.call(passedData.region, 'companionMetadata')).toBe(false);
    expect(Object.keys(passedData.region).sort()).toEqual(Object.keys(baseMidiRegion).sort());
  });

  it('brands `config.volume` and preserves all other config fields on a companion REGION_ADD payload', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const regionAddCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.REGION_ADD);
    const eventHandler = regionAddCall![1] as (data: unknown) => void;

    const companionRegion = {
      id: 'region-2',
      trackId: 'track-1',
      name: 'Companion Region',
      start: 0,
      length: 4,
      loopEnabled: false,
      loopIterations: 1,
      type: 'companion' as const,
      config: {
        style: 'walking',
        density: 'normal',
        volume: -6,
        isMuted: false,
      },
    };

    eventHandler({ roomId: TEST_ROOM_ID, region: companionRegion });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleRegionAdd).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleRegionAdd.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; region: { config: Record<string, unknown> } },
    ];

    expect(passedData.region.config).toEqual({
      style: 'walking',
      density: 'normal',
      volume: -6,
      isMuted: false,
    });
  });

  it('does NOT add a `volume` key when a COMPANION_CONFIG_UPDATE payload is a style-only patch', async () => {
    arrangeEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

    const configUpdateCall = mockSocket.on.mock.calls.find((call) => call[0] === ARRANGE_EVENTS.COMPANION_CONFIG_UPDATE);
    expect(configUpdateCall).toBeDefined();
    const eventHandler = configUpdateCall![1] as (data: unknown) => void;

    // Style-only patch — no `volume` key at all, mirroring what
    // `validateCompanionRegionConfigUpdates` produces for a patch that never touched volume.
    eventHandler({ roomId: TEST_ROOM_ID, regionId: 'region-1', updates: { style: 'walking' } });
    await flushPromises();

    expect(mockArrangeRoomHandler.handleCompanionConfigUpdate).toHaveBeenCalledTimes(1);
    const [, , passedData] = mockArrangeRoomHandler.handleCompanionConfigUpdate.mock.calls[0] as unknown as [
      unknown, unknown, { roomId: string; regionId: string; updates: Record<string, unknown> },
    ];

    expect(passedData.updates).toEqual({ style: 'walking' });
    expect(Object.prototype.hasOwnProperty.call(passedData.updates, 'volume')).toBe(false);
    expect(Object.keys(passedData.updates)).toEqual(['style']);
  });
});
