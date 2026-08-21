/**
 * Unit Tests: RoomMetronome.handleBpmChange
 *
 * Covers DEV-91 — RC-1 (primary): beatZeroAt overwrite causes beatZeroAt
 * drift when BPM is changed rapidly in Perform Room.
 *
 * Perform Room requires 100% metronome sync across all clients. Each client
 * schedules its beats from the server-broadcast anchor (beatZeroAt + bpm).
 * If beatZeroAt drifts with every rapid change, clients all receive the same
 * wrong anchor and tick at the wrong musical position.
 *
 * These tests describe the DESIRED (fixed) behaviour and therefore FAIL against
 * the current buggy code. They pass after the fix.
 */
import * as nodeTimers from 'timers'
import { MetronomeService, RoomMetronome } from '../infrastructure/services/MetronomeService'
import type { RoomRepository } from '../infrastructure/repositories/RoomRepository'
import type { MetronomeAnchor } from '../../../types'
import type { PerformRoomState } from '../../perform-room/domain/models/PerformRoomState'
import type { Namespace, Server } from 'socket.io'

// Types for mocks
type MockRoomRepository = jest.Mocked<Pick<RoomRepository, 'getRoom' | 'saveRoom'>>;
type NamespaceMockResult = {
  ns: Namespace;
  anchors: MetronomeAnchor[];
};
let mockQuarterNoteMsOverride: number | null = null;
let mockGetHighResolutionTime: (() => number) | null = null;

jest.mock('@jam-band/shared', () => {
  return {
    quarterNoteMs: (bpm: number) => {
      if (mockQuarterNoteMsOverride !== null) {
        return mockQuarterNoteMsOverride;
      }
      return (60 / bpm) * 1000;
    },
    METRONOME_CONSTANTS: {
      DEFAULT_BPM: 120,
      MIN_BPM: 20,
      MAX_BPM: 300,
    },
    METRONOME_EVENTS: {
      METRONOME_ANCHOR: 'metronome_anchor',
      UPDATE_METRONOME: 'update_metronome',
      REQUEST_METRONOME_STATE: 'request_metronome_state',
    },
    getHighResolutionTime: () =>
      mockGetHighResolutionTime ? mockGetHighResolutionTime() : Number(process.hrtime.bigint()),
  };
});

jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logRoomActivity: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

import * as shared from '@jam-band/shared'
const { quarterNoteMs } = shared;
import { CompanionScheduler } from '@/domains/perform-room/application/CompanionScheduler'
import { performRoomStateService } from '@/domains/perform-room/application/PerformRoomStateService'
import { companionRuntimeRegistry } from '@/domains/perform-room/application/CompanionRuntimeRegistry'
import { createPartialMock } from '@/testing/mocks'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoom(overrides: {
  bpm?: number;
  beatZeroAt?: number;
  roomScale?: { rootNote: string; scale: string };
} = {}) {
  return {
    id: 'test-room',
    roomType: 'perform' as const,
    metronome: {
      bpm: overrides.bpm ?? 90,
      beatZeroAt: overrides.beatZeroAt ?? Date.now() - 400,
    },
    roomScale: overrides.roomScale,
    bandMembers: new Map(),
    audiences: new Map(),
  }
}

function makeRepoMock(room: ReturnType<typeof makeRoom>): MockRoomRepository {
  return {
    getRoom: jest.fn().mockResolvedValue(room),
    saveRoom: jest.fn().mockImplementation(async (r: unknown) => {
      // Mirror mutations back so subsequent getRoom calls see the updated state
      const typedRoom = r as { metronome: typeof room.metronome };
      Object.assign(room.metronome, typedRoom.metronome);
    }),
  } as MockRoomRepository;
}

function makeNamespaceMock(): NamespaceMockResult {
  const anchors: MetronomeAnchor[] = [];
  const ns = {
    emit: jest.fn((_event: string, anchor: MetronomeAnchor) => anchors.push(anchor)),
  } as unknown as Namespace;
  return { ns, anchors };
}

afterEach(() => {
  companionRuntimeRegistry.clearAll()
  jest.restoreAllMocks()
  // Ensure real timers are restored after any test that used fake timers.
  // In the Bun/Jest environment, jest.useFakeTimers() can permanently break
  // global timer functions, and jest.useRealTimers() may not fix them.
  jest.useRealTimers()
  if (typeof globalThis.setTimeout !== 'function') {
    // Force-restore setTimeout from Node.js timers
    (globalThis as unknown as Record<string, unknown>).setTimeout = nodeTimers.setTimeout;
    (globalThis as unknown as Record<string, unknown>).clearTimeout = nodeTimers.clearTimeout;
  }
})

// ---------------------------------------------------------------------------
// RC-1: the persisted grid must stay ON the beat grid across BPM changes
// ---------------------------------------------------------------------------

describe('RoomMetronome.handleBpmChange — RC-1: persisted grid integrity', () => {
  it('re-anchors the stored beatZeroAt to a beat of the OLD grid (Perform Room)', async () => {
    const originalGrid = Date.now() - 400
    const room = makeRoom({ bpm: 90, beatZeroAt: originalGrid })
    const repo = makeRepoMock(room)
    const { ns } = makeNamespaceMock()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    await metronome.handleBpmChange(95, ns)

    const [savedRoom] = repo.saveRoom.mock.calls[0]!
    // The new origin is the transition point, which must itself be a beat of the
    // grid the room was on — that is what keeps the tempo change phase-continuous.
    const beatsFromOldOrigin = (savedRoom.metronome.beatZeroAt - originalGrid) / quarterNoteMs(90)
    expect(Math.abs(beatsFromOldOrigin - Math.round(beatsFromOldOrigin))).toBeLessThan(1e-6)
    expect(savedRoom.metronome.beatZeroAt).toBeGreaterThan(Date.now() - 1)
  })

  it('should NOT accumulate beatZeroAt drift across 5 rapid BPM changes (RC-1 regression)', async () => {
    /**
     * With the RC-1 bug:
     *   Change N overwrites beatZeroAt = Date.now()
     *   Change N+1 reads that wrong timestamp → the transition is computed from
     *   the change time instead of the actual beat clock → each change drifts
     *   beatZeroAt forward by ≈ interval between changes.
     *
     * After 5 changes at 100 ms intervals, accumulated drift ≈ 4 × 100 ms = 400 ms.
     * At BPM=95 (beatDuration ≈ 632 ms), 400 ms = 63 % of a beat — clearly audible.
     *
     * Expected (fixed) behaviour: all changes use the original tick as reference,
     * so beatZeroAt stays on the correct beat grid regardless of change frequency.
     */
    jest.useFakeTimers()

    // Establish a stable fake-clock baseline: tTick is beat-clock reference,
    // fake "now" starts 400 ms later so tTick is 400 ms in the past.
    const tTick = Date.now()
    jest.setSystemTime(tTick + 400)
    const INTERVAL_MS = 100                  // rapid change interval
    const room = makeRoom({ bpm: 90, beatZeroAt: tTick })
    const repo = makeRepoMock(room)
    const { ns, anchors } = makeNamespaceMock()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)

    // Emit 5 rapid changes: 91, 92, 93, 94, 95
    for (let bpm = 91; bpm <= 95; bpm++) {
      jest.advanceTimersByTime(INTERVAL_MS)
      await metronome.handleBpmChange(bpm, ns)
    }

    jest.useRealTimers()

    // Single reference: jump straight from 90 → 95 using the original tick
    const roomRef = makeRoom({ bpm: 90, beatZeroAt: tTick })
    const repoRef = makeRepoMock(roomRef)
    const { ns: nsRef, anchors: anchorsRef } = makeNamespaceMock()
    const metronomeRef = new RoomMetronome('test-room', nsRef, repoRef as unknown as RoomRepository)
    await metronomeRef.handleBpmChange(95, nsRef)

    const anchorRapid = anchors[anchors.length - 1]
    const anchorSingle = anchorsRef[0]
    expect(anchorRapid).toBeDefined()
    expect(anchorSingle).toBeDefined()
    const beatZeroAtRapid  = anchorRapid!.beatZeroAt
    const beatZeroAtSingle = anchorSingle!.beatZeroAt
    const beatDuration95    = quarterNoteMs(95)   // ≈ 632 ms

    // Both approaches should land on the same beat grid (modulo one beat period).
    // Tolerance 60 ms accounts for ceiling-rounding when picking the transition beat.
    const raw   = Math.abs(beatZeroAtRapid - beatZeroAtSingle) % beatDuration95
    const phase = Math.min(raw, beatDuration95 - raw)

    expect(phase).toBeLessThan(60)
  })
})

// ---------------------------------------------------------------------------
// Anchor correctness: beatZeroAt must keep phase continuity
// ---------------------------------------------------------------------------

describe('RoomMetronome.handleBpmChange — anchor phase continuity', () => {
  it('broadcasts an anchor whose effectiveAt is the next beat of the OLD grid, and is beat 0 of the new one', async () => {
    const gridOrigin = Date.now() - 300   // 300 ms into a beat at BPM=90
    const room = makeRoom({ bpm: 90, beatZeroAt: gridOrigin })
    const repo = makeRepoMock(room)
    const { ns, anchors } = makeNamespaceMock()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    await metronome.handleBpmChange(100, ns)

    const anchor = anchors[0]
    expect(anchor).toBeDefined()
    expect(anchor!.bpm).toBe(100)

    // The transition is a beat of the old grid …
    const beatsFromOldOrigin = (anchor!.effectiveAt! - gridOrigin) / quarterNoteMs(90)
    expect(Math.abs(beatsFromOldOrigin - Math.round(beatsFromOldOrigin))).toBeLessThan(1e-6)
    expect(anchor!.effectiveAt).toBeGreaterThanOrEqual(Date.now() - 1)

    // … and the new grid starts exactly there, so no beat is lost or doubled.
    expect(anchor!.beatZeroAt).toBe(anchor!.effectiveAt)
  })

  it('persists the broadcast grid so a later state request answers with the same grid', async () => {
    const room = makeRoom({ bpm: 90, beatZeroAt: Date.now() - 300 })
    const repo = makeRepoMock(room)
    const { ns, anchors } = makeNamespaceMock()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    await metronome.handleBpmChange(100, ns)

    // A joiner is answered from room.metronome (see MetronomeHandler), so the
    // stored grid MUST be the one the room is already playing — otherwise the
    // joiner ticks on a grid of its own, out of phase with everyone else.
    expect(room.metronome.beatZeroAt).toBe(anchors[0]!.beatZeroAt)
    expect(room.metronome.bpm).toBe(100)
  })

  it('keeps the grid independent of server tick jitter', async () => {
    const gridOrigin = Date.now() - 300
    const room = makeRoom({ bpm: 90, beatZeroAt: gridOrigin })
    const repo = makeRepoMock(room)
    const { ns, anchors } = makeNamespaceMock()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    // Simulate a tick that fired 37 ms late — the grid must not inherit that jitter.
    ;(metronome as unknown as { lastActualTickTime: number }).lastActualTickTime = gridOrigin + 37
    await metronome.handleBpmChange(100, ns)

    const beatsFromOldOrigin = (anchors[0]!.beatZeroAt - gridOrigin) / quarterNoteMs(90)
    expect(Math.abs(beatsFromOldOrigin - Math.round(beatsFromOldOrigin))).toBeLessThan(1e-6)
  })
})

// ---------------------------------------------------------------------------
// RC-2: a single server-computed anchor is broadcast to the whole room
// ---------------------------------------------------------------------------
//
// The BPM-change flow that the deleted metronome-bpm-sync.spec.ts e2e guarded
// is: MetronomeHandler.handleUpdateMetronomeNamespace -> MetronomeService
// .handleBpmChange -> RoomMetronome.handleBpmChange (tested directly below)
// -> RoomMetronome.broadcastAnchor -> namespace.emit(METRONOME_ANCHOR, anchor).
// `namespace` here is the room's own dedicated namespace (one per room, see
// NamespaceManager.createRoomNamespace), so `namespace.emit(...)` already
// reaches every socket in that room in one call — there is no per-client
// anchor computation or per-client emit to race. Asserting a single emit
// call carrying one anchor object proves every client converges by
// construction, which is the property the e2e was protecting.
describe('RoomMetronome.handleBpmChange — RC-2: single-anchor room broadcast', () => {
  it('broadcasts a single server-computed metronome anchor to the whole room (RC-2)', async () => {
    const room = makeRoom({ bpm: 90, beatZeroAt: Date.now() - 400 })
    const repo = makeRepoMock(room)
    const { ns, anchors } = makeNamespaceMock()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    await metronome.handleBpmChange(128, ns)

    // One handleBpmChange call must result in exactly one namespace-wide emit —
    // the same anchor object is what every client in the room's namespace receives.
    const emitMock = ns.emit as jest.Mock
    expect(emitMock).toHaveBeenCalledTimes(1)

    const [event, anchor] = emitMock.mock.calls[0] as [string, MetronomeAnchor]
    expect(event).toBe(shared.METRONOME_EVENTS.METRONOME_ANCHOR)
    expect(typeof anchor.beatZeroAt).toBe('number')
    expect(anchor.bpm).toBe(128)

    // Sanity: the anchors array (fed by the same emit call) agrees — single anchor, not per-client.
    expect(anchors).toHaveLength(1)
  })
})

function makePerformStateWithCompanion(): PerformRoomState {
  return {
    roomId: 'test-room',
    roomType: 'perform' as const,
    userStates: new Map(),
    recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
    broadcastStates: {},
    voiceStates: {},
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    companions: [
      {
        id: 'companion-1',
        instrumentId: 'piano',
        role: 'chord',
        style: 'block',
        density: 'medium',
        isPlaying: true,
        isMuted: false,
      },
    ],
    lastUpdated: new Date(),
  } as unknown as PerformRoomState
}

describe('RoomMetronome companion scheduling', () => {
  it('uses live room metronome BPM and owner scale when scheduling companions', async () => {
    const room = makeRoom({ bpm: 90, roomScale: { rootNote: 'D', scale: 'minor' } })
    const repo = makeRepoMock(room)
    const { ns } = makeNamespaceMock()
    const performState = {
      roomId: 'test-room',
      roomType: 'perform' as const,
      userStates: new Map(),
      recordingStates: {
        isAudioRecording: false,
        isSessionRecording: false,
        shadowCaptureStates: {},
      },
      broadcastStates: {},
      voiceStates: {},
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companions: [
        {
          id: 'companion-1',
          instrumentId: 'piano',
          role: 'chord',
          style: 'block',
          density: 'medium',
          isPlaying: true,
          isMuted: false,
        },
      ],
      lastUpdated: new Date(),
    }
    const stateSpy = jest
      .spyOn(performRoomStateService, 'getState')
      // Cast the test performState to match what PerformRoomStateService expects
      .mockResolvedValue(performState as unknown as PerformRoomState)
    const schedulerSpy = jest
      .spyOn(CompanionScheduler, 'processTick')
      .mockResolvedValue()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    metronome.start()

    await Promise.resolve()
    await Promise.resolve()
    metronome.stop()

    expect(stateSpy).toHaveBeenCalledWith('test-room')
    expect(schedulerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bpm: 90,
        companions: performState.companions,
        roomScale: { rootNote: 'D', scale: 'minor' },
        timeSignature: performState.timeSignature,
      }),
      1,
      ns,
      expect.any(Number),
      {
        bpm: 90,
        roomScale: { rootNote: 'D', scale: 'minor' },
      }
    )
    const targetBeatServerTime = schedulerSpy.mock.calls[0]![3]
    expect(targetBeatServerTime).toBeGreaterThan(Date.now())
  })

  it('times companion beats on the room grid, not on the tick that triggered them', async () => {
    // The tick that triggers a companion beat fires a few ms late (event loop,
    // store round-trip). Timing the notes from that stamp puts the band a wobble
    // away from the metronome clicks, which follow the grid exactly.
    // Deliberately off-grid by 37 ms: the tick fires ~now, so timing the beat
    // from the tick lands 37 ms away from where the clicks are.
    const beatZeroAt = Date.now() - (5_000 + 37)
    const room = makeRoom({ bpm: 120, beatZeroAt })
    const repo = makeRepoMock(room)
    const { ns } = makeNamespaceMock()
    jest.spyOn(performRoomStateService, 'getState').mockResolvedValue(makePerformStateWithCompanion())
    const schedulerSpy = jest.spyOn(CompanionScheduler, 'processTick').mockResolvedValue()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    metronome.start()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    metronome.stop()

    const targetBeatServerTime = schedulerSpy.mock.calls[0]![3] as number
    const beatsFromOrigin = (targetBeatServerTime - beatZeroAt) / quarterNoteMs(120)
    expect(Math.abs(beatsFromOrigin - Math.round(beatsFromOrigin))).toBeLessThan(1e-6)
    expect(targetBeatServerTime).toBeGreaterThan(Date.now())
  })

  it('keeps companion beat times strictly increasing, including across a BPM change', async () => {
    const room = makeRoom({ bpm: 300, beatZeroAt: Date.now() - 5_000 })  // 200 ms beats
    const repo = makeRepoMock(room)
    const { ns } = makeNamespaceMock()
    jest.spyOn(performRoomStateService, 'getState').mockResolvedValue(makePerformStateWithCompanion())
    const schedulerSpy = jest.spyOn(CompanionScheduler, 'processTick').mockResolvedValue()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    metronome.start()
    await new Promise((resolve) => setTimeout(resolve, 250))
    await metronome.handleBpmChange(150, ns)   // grid re-anchors mid-flight
    await new Promise((resolve) => setTimeout(resolve, 500))
    metronome.stop()

    const targets = schedulerSpy.mock.calls.map((call) => call[3] as number)
    expect(targets.length).toBeGreaterThan(2)
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]!).toBeGreaterThan(targets[i - 1]!)
    }
  })

  it('does not fetch perform Redis state on each tick when registry has no active companions', async () => {
    const room = makeRoom({ bpm: 120 })
    const repo = makeRepoMock(room)
    const { ns } = makeNamespaceMock()
    companionRuntimeRegistry.upsertFromPerformState('test-room', {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companions: [],
      companionChordLength: 2,
      companionProgressionFlavor: 'diatonic',
      companionChordProgression: { mode: 'random', chords: [], barsPerChord: 2, currentChordIndex: 0 },
    })
    const stateSpy = jest
      .spyOn(performRoomStateService, 'getState')
      .mockResolvedValue(null)
    const schedulerSpy = jest
      .spyOn(CompanionScheduler, 'processTick')
      .mockResolvedValue()

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    metronome.start()

    await Promise.resolve()
    await Promise.resolve()
    metronome.stop()

    expect(stateSpy).not.toHaveBeenCalled()
    expect(schedulerSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tick interval is always quarter-note duration regardless of denominator
// ---------------------------------------------------------------------------

describe('RoomMetronome — tick interval', () => {
  // Store the original setTimeout so we can always restore it, even if
  // jest.resetModules() triggers module reload between tests in this describe.
  let realSetTimeout: typeof setTimeout;

  beforeEach(() => {
    realSetTimeout = globalThis.setTimeout;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).setTimeout = realSetTimeout;
  });

  it('schedules ticks at quarter-note duration at bpm=120', async () => {
    const room = makeRoom({ bpm: 120 })
    const repo = makeRepoMock(room)
    const { ns } = makeNamespaceMock()

    jest.spyOn(performRoomStateService, 'getState').mockResolvedValue(null)
    jest.spyOn(CompanionScheduler, 'processTick').mockResolvedValue()

    // Manually mock setTimeout to capture delay argument (jest.spyOn on global timers
    // fails in this Bun/Jest environment)
    const setTimeoutMock = jest.fn<NodeJS.Timeout, [() => void, number]>();
    (globalThis as unknown as typeof globalThis).setTimeout = setTimeoutMock as unknown as typeof setTimeout;

    const metronome = new RoomMetronome('test-room', ns, repo as unknown as RoomRepository)
    metronome.start()

    await Promise.resolve()
    await Promise.resolve()
    metronome.stop()

    const timedCalls = setTimeoutMock.mock.calls.filter(
      (c) => typeof c[1] === 'number' && c[1] > 0,
    )
    expect(timedCalls.length).toBeGreaterThan(0)

    // At bpm=120, interval=500ms regardless of denominator. Allow ±50ms for hrtime jitter.
    const delay = timedCalls[0]![1]
    expect(delay).toBeGreaterThan(450)
    expect(delay).toBeLessThan(550)
  })
})

describe('RoomMetronome — consecutive misses and recovery (DEV-137)', () => {
  let repo: jest.Mocked<RoomRepository>;
  const ns = { emit: jest.fn() } as unknown as Namespace;

  // Manual fake timers — Bun/Jest compat workaround for jest.useFakeTimers() not
  // properly installing fake setTimeout on globalThis.
  let pendingCallbacks: Array<{ cb: () => void; delay: number }> = [];
  let origSetTimeout: typeof setTimeout;
  let origClearTimeout: typeof clearTimeout;

  function firePendingCallbacks(): void {
    while (pendingCallbacks.length > 0) {
      const next = pendingCallbacks.shift()!;
      next.cb();
    }
  }

  beforeEach(() => {
    pendingCallbacks = [];
    mockGetHighResolutionTime = () => Date.now() * 1_000_000;
    mockQuarterNoteMsOverride = 20; // 20ms tick interval — large enough to control clearly with fake timers
    jest.spyOn(performRoomStateService, 'getState').mockResolvedValue(null);

    // Store originals and install manual mocks
    origSetTimeout = globalThis.setTimeout;
    origClearTimeout = globalThis.clearTimeout;
    const setTimeoutImpl = (fn: () => void, delay: number) => {
      pendingCallbacks.push({ cb: fn, delay });
      return pendingCallbacks.length as unknown as NodeJS.Timeout;
    };
    (globalThis as unknown as Record<string, unknown>).setTimeout = setTimeoutImpl;
    (globalThis as unknown as Record<string, unknown>).clearTimeout = (_id: unknown) => {
      // No-op for manual mock
    };
  });

  afterEach(() => {
    mockQuarterNoteMsOverride = null;
    mockGetHighResolutionTime = null;
    pendingCallbacks = [];
    (globalThis as unknown as typeof globalThis).setTimeout = origSetTimeout;
    (globalThis as unknown as typeof globalThis).clearTimeout = origClearTimeout;
  });

  it('stops metronome after 5 consecutive getRoom misses', async () => {
    repo = createPartialMock<RoomRepository>({
      getRoom: jest.fn().mockResolvedValue(undefined),
    });
    const metronome = new RoomMetronome('test-room', ns, repo);
    const stopSpy = jest.spyOn(metronome, 'stop');

    metronome.start();

    // Each tick fires setTimeout(tick, ~20ms). We manually fire the callbacks
    // that our mock captured. Each tick is a getRoom miss.
    // After 5 misses the metronome should stop.
    for (let i = 0; i < 7; i++) {
      firePendingCallbacks();
      await Promise.resolve();
    }

    expect(metronome.getIsRunning()).toBe(false);
    expect(stopSpy).toHaveBeenCalled();
  });

  it('resets consecutiveRoomMisses count if getRoom recovers', async () => {
    let getRoomCalls = 0;
    const room = makeRoom({ bpm: 120 });
    repo = createPartialMock<RoomRepository>({
      getRoom: jest.fn().mockImplementation(async () => {
        getRoomCalls++;
        if (getRoomCalls >= 3) {
          return room; // Recover and stay recovered
        }
        return undefined; // Miss on 1st, 2nd
      }),
      saveRoom: jest.fn(),
    });
    const metronome = new RoomMetronome('test-room', ns, repo);

    metronome.start(); // Starts immediate tick (call 1 = miss)

    // Fire through tick 1 (miss), tick 2 (miss), tick 3 (success — resets counter)
    for (let i = 0; i < 4; i++) {
      firePendingCallbacks();
      await Promise.resolve();
    }
    expect(metronome.getIsRunning()).toBe(true);

    // Now force subsequent calls to return null (re-triggering misses)
    repo.getRoom.mockResolvedValue(undefined);

    // Fire through 6 more ticks to accumulate 5 consecutive misses and stop
    for (let i = 0; i < 7; i++) {
      firePendingCallbacks();
      await Promise.resolve();
    }

    expect(metronome.getIsRunning()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Room metronomes are created when a room is created — but rooms outlive the
// process that created them (Redis, 24h TTL). After a restart the surviving
// room has no in-memory instance, and every BPM change used to be a silent
// no-op for the whole room.
// ---------------------------------------------------------------------------

describe('MetronomeService — rooms that outlived their metronome instance', () => {
  beforeEach(() => {
    // The lazily-started metronome ticks against a mocked repo; keep its tick off
    // the real perform-state service (Redis) so the loop stays in-process.
    jest.spyOn(performRoomStateService, 'getState').mockResolvedValue(null)
  })

  function makeService(room: ReturnType<typeof makeRoom>) {
    const repo = makeRepoMock(room)
    const io = createPartialMock<Server>({})
    const service = new MetronomeService(io, repo as unknown as RoomRepository)
    return { service, repo }
  }

  it('changes BPM for a room whose metronome instance is gone (post-restart)', async () => {
    const room = makeRoom({ bpm: 90, beatZeroAt: Date.now() - 300 })
    const { service } = makeService(room)
    const { ns, anchors } = makeNamespaceMock()

    await service.handleBpmChange('test-room', 100, ns)
    service.cleanupRoom('test-room')

    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.bpm).toBe(100)
    expect(room.metronome.bpm).toBe(100)
  })

  it('starts ticking again for that room, so companions resume', async () => {
    const room = makeRoom({ bpm: 90, beatZeroAt: Date.now() - 300 })
    const { service } = makeService(room)
    const { ns } = makeNamespaceMock()

    await service.handleBpmChange('test-room', 100, ns)

    expect(service.getActiveMetronomes()).toContain('test-room')
    service.cleanupRoom('test-room')
  })
})
