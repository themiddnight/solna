import { PerformCompanionHandler } from '../infrastructure/handlers/PerformCompanionHandler';
import { CompanionScheduler } from '../application/CompanionScheduler';
import type { PerformRoomState } from '../domain/models/PerformRoomState';
import type { Socket, Namespace } from 'socket.io';
import type { PerformRoomStateService } from '../application/PerformRoomStateService';
import type { RoomMembershipService } from '../../room-management/application/RoomMembershipService';
import type { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import { createPartialMock } from '@/testing/mocks';
import { PERFORM_EVENTS, SOCKET_ERROR_CODES, OCCUPANCY_EVENTS } from '@jam-band/shared';

describe('PerformCompanionHandler', () => {
  const roomId = 'room-1';
  let socket: jest.Mocked<Socket>;
  let namespace: jest.Mocked<Namespace>;
  let stateService: Record<string, jest.Mock>;
  let roomMembershipService: Record<string, jest.Mock>;
  let onCompanionCountChanged: jest.Mock;
  let occupancyService: jest.Mocked<RoomOccupancyService>;
  let handler: PerformCompanionHandler;

  const updatedState: PerformRoomState = {
    roomId,
    roomType: 'perform',
    userStates: new Map(),
    recordingStates: {
      isAudioRecording: false,
      isSessionRecording: false,
      shadowCaptureStates: {},
    },
    broadcastStates: {},
    voiceStates: {},
    occupancy: new Map(),
    companions: [],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    companionChordLength: 2,
    companionProgressionFlavor: 'diatonic',
    companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
    companionSelectedGenrePreset: 'pop',
    companionSelectedIntensity: 1,
    companionOverrideInstruments: false,
    lastUpdated: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    socket = {
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Socket>;
    namespace = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as unknown as jest.Mocked<Namespace>;
    stateService = {
      updateAllCompanionPreset: jest.fn().mockResolvedValue(updatedState),
      updateCompanion: jest.fn().mockResolvedValue(updatedState),
      getState: jest.fn().mockResolvedValue(updatedState),
      addCompanion: jest.fn().mockResolvedValue(updatedState),
      removeCompanion: jest.fn().mockResolvedValue(updatedState),
      setCompanionChordProgression: jest.fn().mockResolvedValue(updatedState),
      setCompanionProgressionFlavor: jest.fn().mockResolvedValue(updatedState),
      setCompanionPresetControls: jest.fn().mockResolvedValue(updatedState),
    };
    roomMembershipService = {
      findUserInRoom: jest.fn().mockResolvedValue({ role: 'band_member' }),
    };
    onCompanionCountChanged = jest.fn();
    occupancyService = createPartialMock<RoomOccupancyService>({
      join: jest.fn(),
      leave: jest.fn(),
      heartbeat: jest.fn(),
    });
    handler = new PerformCompanionHandler({
      stateService: stateService as unknown as PerformRoomStateService,
      getRoomMembershipService: () => roomMembershipService as unknown as RoomMembershipService,
      validateSession: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      handleError: jest.fn(),
      onCompanionCountChanged,
      getSession: jest.fn().mockResolvedValue({ roomId, userId: 'user-1', username: 'Alice' }),
      getOccupancyService: () => occupancyService,
    });
    jest.spyOn(CompanionScheduler, 'clearGeneratedNoteCache').mockImplementation(() => undefined);
  });

  it('bulk-updates companion presets and emits one state sync', async () => {
    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'jazz',
      embellishmentIntensity: 2,
    });

    expect(stateService.updateAllCompanionPreset).toHaveBeenCalledWith(roomId, 'jazz', 2, { overrideInstruments: false });
    // The exact-match assertion below also pins the other half of the attribution contract:
    // a bulk preset update names the ROOM controls it moved, but still carries no per-
    // companion `changed` discriminator -- it touches every companion at once, so there is
    // no single companion to point at (DEV-350 Round 9).
    expect(CompanionScheduler.clearGeneratedNoteCache).toHaveBeenCalledTimes(1);
    expect(namespace.to).toHaveBeenCalledWith(roomId);
    expect(namespace.emit).toHaveBeenCalledWith('perform:companion_state_sync', {
      companions: updatedState.companions,
      companionChordLength: updatedState.companionChordLength,
      companionChordProgression: updatedState.companionChordProgression,
      companionProgressionFlavor: updatedState.companionProgressionFlavor,
      companionSelectedGenrePreset: updatedState.companionSelectedGenrePreset,
      companionSelectedIntensity: updatedState.companionSelectedIntensity,
      companionOverrideInstruments: updatedState.companionOverrideInstruments,
      userId: 'user-1',
      changedRoomControls: ['genrePreset', 'embellishmentIntensity'],
    });
  });

  // Attribution needs to know WHICH control moved: the sync bundles every companion
  // mutation into one payload, so without this discriminator the receiving client can only
  // guess, and guessing painted the wrong user's badge on an untouched control (DEV-350
  // Round 2 Task 16 review finding, fixed in Round 9).
  it('names the changed companion and control keys on a single-companion update', async () => {
    await handler.handleCompanionUpdate(socket, namespace, {
      roomId,
      companionId: 'companion-1',
      updates: { swingPercent: 70 },
    });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ changed: { companionId: 'companion-1', keys: ['swingPercent'] } }),
    );
  });

  it('names only the client-sent keys — server-derived role/style/timing are not attributed', async () => {
    await handler.handleCompanionUpdate(socket, namespace, {
      roomId,
      companionId: 'companion-1',
      updates: { instrumentId: 'bass' },
    });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ changed: { companionId: 'companion-1', keys: ['instrumentId'] } }),
    );
  });

  it('stamps the acting userId on COMPANION_STATE_SYNC', async () => {
    await handler.handleCompanionAdd(socket, namespace, { roomId, instrumentId: 'bass' });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('updates synced companion preset control state without applying a bulk preset', async () => {
    await handler.handleCompanionPresetControlsUpdate(socket, namespace, {
      roomId,
      genrePreset: 'house',
      embellishmentIntensity: 3,
      overrideInstruments: true,
    });

    expect(stateService.setCompanionPresetControls).toHaveBeenCalledWith(roomId, {
      companionSelectedGenrePreset: 'house',
      companionSelectedIntensity: 3,
      companionOverrideInstruments: true,
    });
    expect(stateService.updateAllCompanionPreset).not.toHaveBeenCalled();
    expect(namespace.emit).toHaveBeenCalledWith('perform:companion_state_sync', expect.objectContaining({
      companionSelectedGenrePreset: updatedState.companionSelectedGenrePreset,
      companionSelectedIntensity: updatedState.companionSelectedIntensity,
      companionOverrideInstruments: updatedState.companionOverrideInstruments,
      userId: 'user-1',
    }));
  });

  it('passes the instrument override flag through bulk preset updates', async () => {
    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'house',
      embellishmentIntensity: 3,
      overrideInstruments: true,
    });

    expect(stateService.updateAllCompanionPreset).toHaveBeenCalledWith(roomId, 'house', 3, { overrideInstruments: true });
  });

  // The COMPANIONS panel's Genre chips and Intensity segmented control both route through
  // the BULK path whenever the room has at least one companion (CompanionStageControls'
  // `applyBulkPreset`), so without attribution here neither badge could ever light up on the
  // other clients -- the only badge they saw was the one from the DERIVED flavor broadcast
  // that follows, pointing at Harmonic Flavor near the bottom of the panel.
  it('names the room controls whose value actually moved on a bulk preset update', async () => {
    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'jazz',
      embellishmentIntensity: 2,
    });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ changedRoomControls: ['genrePreset', 'embellishmentIntensity'] }),
    );
  });

  it('names only intensity when the genre is unchanged — the Genre badge must not light up', async () => {
    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'pop', // same as `before`
      embellishmentIntensity: 3,
    });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ changedRoomControls: ['embellishmentIntensity'] }),
    );
  });

  it('names the override flag when it moves on a bulk preset update', async () => {
    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'pop',
      embellishmentIntensity: 1,
      overrideInstruments: true,
    });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ changedRoomControls: ['overrideInstruments'] }),
    );
  });

  it('rejects audience users before updating companion presets', async () => {
    (roomMembershipService.findUserInRoom as jest.Mock).mockResolvedValue({ role: 'audience' });

    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'jazz',
      embellishmentIntensity: 2,
    });

    expect(stateService.updateAllCompanionPreset).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'Audience cannot update companions' }),
    );
  });

  it('rejects invalid bulk preset payloads', async () => {
    await handler.handleCompanionBulkPresetUpdate(socket, namespace, {
      roomId,
      genrePreset: 'unknown',
      embellishmentIntensity: 4,
    });

    expect(stateService.updateAllCompanionPreset).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'Invalid companion preset payload' }),
    );
  });

  // Element occupancy (DEV-350 M4 Task 24) — mirrors ArrangeLockHandler.test.ts's four
  // Task 7 cases exactly, replacing the old per-resource lock/unlock describe blocks above.
  describe('handleOccupancyJoin', () => {
    it('broadcasts JOINED with the updated holders on success', async () => {
      occupancyService.join.mockResolvedValue({
        accepted: true,
        holders: [{ userId: 'user-1', username: 'Alice', joinedAt: 1 }],
      });

      await handler.handleOccupancyJoin(socket, namespace, { roomId, elementId: 'companion:volume' });

      expect(namespace.to).toHaveBeenCalledWith(roomId);
      expect(namespace.emit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.JOINED, {
        elementId: 'companion:volume',
        holders: [{ userId: 'user-1', username: 'Alice', joinedAt: 1 }],
      });
    });

    it('unicasts JOIN_DENIED with heldBy when rejected', async () => {
      occupancyService.join.mockResolvedValue({
        accepted: false,
        holders: [{ userId: 'other', username: 'Bob', joinedAt: 1 }],
      });

      await handler.handleOccupancyJoin(socket, namespace, { roomId, elementId: 'companion:volume' });

      expect(socket.emit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.JOIN_DENIED, {
        elementId: 'companion:volume',
        heldBy: { userId: 'other', username: 'Bob', joinedAt: 1 },
      });
    });

    // Review fix: audience members must never be able to claim a companion:* occupancy slot
    // (the old per-resource lock handlers all had a `role === 'audience'` early-return; the
    // occupancy migration needs the same gate on JOIN specifically, since that's the step that
    // actually claims a slot for up to the 5-minute occupancy TTL).
    it('rejects an audience-role join before ever calling the occupancy service', async () => {
      (roomMembershipService.findUserInRoom as jest.Mock).mockResolvedValue({ role: 'audience' });

      await handler.handleOccupancyJoin(socket, namespace, { roomId, elementId: 'companion:volume' });

      expect(occupancyService.join).not.toHaveBeenCalled();
      expect(namespace.emit).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('denies the join when no membership service is available (mirrors the old lock handlers)', async () => {
      const noMembershipHandler = new PerformCompanionHandler({
        stateService: stateService as unknown as PerformRoomStateService,
        getRoomMembershipService: () => undefined,
        validateSession: jest.fn().mockResolvedValue({ userId: 'user-1' }),
        handleError: jest.fn(),
        getSession: jest.fn().mockResolvedValue({ roomId, userId: 'user-1', username: 'Alice' }),
        getOccupancyService: () => occupancyService,
      });

      await noMembershipHandler.handleOccupancyJoin(socket, namespace, { roomId, elementId: 'companion:volume' });

      expect(occupancyService.join).not.toHaveBeenCalled();
    });
  });

  describe('handleOccupancyLeave', () => {
    it('broadcasts LEFT with the post-removal holders', async () => {
      occupancyService.leave.mockResolvedValue({ holders: [] });

      await handler.handleOccupancyLeave(socket, namespace, { roomId, elementId: 'companion:volume' });

      expect(namespace.emit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'companion:volume', holders: [] });
    });
  });

  describe('handleOccupancyHeartbeat', () => {
    it('delegates to the occupancy service with the verified session identity', async () => {
      await handler.handleOccupancyHeartbeat(socket, { roomId, elementId: 'companion:volume' });

      expect(occupancyService.heartbeat).toHaveBeenCalledWith(roomId, 'companion:volume', 'user-1');
    });
  });

  it('filters invalid single companion update values before persisting', async () => {
    await handler.handleCompanionUpdate(socket, namespace, {
      roomId,
      companionId: 'companion-1',
      updates: {
        genrePreset: 'not-a-genre',
        embellishmentIntensity: 4,
        id: 'hijacked-id',
        role: 'beat',
        style: 'strum',
        chordPlayStyle: 'skank',
        density: 'busy',
        timing: 'normal',
        swingPercent: 99,
        // DEV-304: volume bounds are -60..12 dB now; -70 is out-of-range (was -20 under the
        // old 0..100 percent scale, which is legitimately in-range under -60..12 and no longer clamps).
        volume: -70,
        // DEV-202: progressionFlavor is room-global now — must be dropped from per-companion updates.
        progressionFlavor: 'borrowed',
        unknownField: 'ignored',
      },
    });

    expect(stateService.updateCompanion).toHaveBeenCalledWith(roomId, 'companion-1', {
      style: 'strum',
      chordPlayStyle: 'skank',
      timing: 'normal',
      swingPercent: 70,
      volume: -60,
    });
    // DEV-202: the exact-match above proves progressionFlavor (sent in `updates`) was filtered out —
    // the persisted object contains only the 4 valid keys, not the room-global flavor.
    expect(CompanionScheduler.clearGeneratedNoteCache).toHaveBeenCalledTimes(1);
    expect(namespace.emit).toHaveBeenCalledWith('perform:companion_state_sync', {
      companions: updatedState.companions,
      companionChordLength: updatedState.companionChordLength,
      companionChordProgression: updatedState.companionChordProgression,
      companionProgressionFlavor: updatedState.companionProgressionFlavor,
      companionSelectedGenrePreset: updatedState.companionSelectedGenrePreset,
      companionSelectedIntensity: updatedState.companionSelectedIntensity,
      companionOverrideInstruments: updatedState.companionOverrideInstruments,
      userId: 'user-1',
      // Only the keys that survived validation are named — the filtered-out `progressionFlavor`
      // must not reach attribution either (DEV-350 Round 9).
      changed: { companionId: 'companion-1', keys: ['style', 'chordPlayStyle', 'timing', 'swingPercent', 'volume'] },
    });
  });

  describe('handleCompanionVolumeEphemeral', () => {
    it('relays a mid-range value unchanged and unrounded', async () => {
      await handler.handleCompanionVolumeEphemeral(socket, {
        roomId,
        companionId: 'companion-1',
        volume: -3.5,
      });

      expect(socket.to).toHaveBeenCalledWith(roomId);
      expect(socket.emit).toHaveBeenCalledWith(PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL, {
        companionId: 'companion-1',
        volume: -3.5,
        userId: 'user-1',
      });
    });

    it('clamps a value below -60 dB up to -60', async () => {
      await handler.handleCompanionVolumeEphemeral(socket, {
        roomId,
        companionId: 'companion-1',
        volume: -100,
      });

      expect(socket.emit).toHaveBeenCalledWith(PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL, {
        companionId: 'companion-1',
        volume: -60,
        userId: 'user-1',
      });
    });

    it('clamps a value above 12 dB down to 12', async () => {
      await handler.handleCompanionVolumeEphemeral(socket, {
        roomId,
        companionId: 'companion-1',
        volume: 50,
      });

      expect(socket.emit).toHaveBeenCalledWith(PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL, {
        companionId: 'companion-1',
        volume: 12,
        userId: 'user-1',
      });
    });

    it('stamps the acting userId on COMPANION_VOLUME_EPHEMERAL', async () => {
      await handler.handleCompanionVolumeEphemeral(socket, {
        roomId,
        companionId: 'companion-1',
        volume: -3.5,
      });

      expect(socket.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL,
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    // TR-33: acting identity always comes from the verified session, never echoed
    // from the client payload — a spoofed userId in `data` must never surface.
    it('ignores a client-supplied userId in the payload (TR-33)', async () => {
      await handler.handleCompanionVolumeEphemeral(socket, {
        roomId,
        companionId: 'companion-1',
        volume: -3.5,
        userId: 'spoofed',
      } as never);

      expect(socket.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.COMPANION_VOLUME_EPHEMERAL,
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('does not broadcast for audience role', async () => {
      (roomMembershipService.findUserInRoom as jest.Mock).mockResolvedValue({ role: 'audience' });

      await handler.handleCompanionVolumeEphemeral(socket, {
        roomId,
        companionId: 'companion-1',
        volume: -3.5,
      });

      expect(socket.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleCompanionSetChordProgression', () => {
    it('rejects degree out of range', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 9, durationBars: 1 }], barsPerChord: 1, currentChordIndex: 0 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('rejects invalid mode', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'bogus', chords: [], barsPerChord: 1, currentChordIndex: 0 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('rejects a chord with durationBars not in allowed set', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 1, durationBars: 3 }], barsPerChord: 1, currentChordIndex: 0 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('rejects invalid barsPerChord', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 1, durationBars: 1 }], barsPerChord: 3, currentChordIndex: 0 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('rejects negative currentChordIndex', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 1, durationBars: 1 }], barsPerChord: 1, currentChordIndex: -1 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('rejects chords array exceeding 8 entries', async () => {
      const nineChords = Array.from({ length: 9 }, () => ({ degree: 1, durationBars: 1 }));
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: nineChords, barsPerChord: 1, currentChordIndex: 0 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('rejects chords array containing null (clean error path, no TypeError)', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [null], barsPerChord: 1, currentChordIndex: 0 },
      });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionChordProgression).not.toHaveBeenCalled();
    });

    it('names progressionMode only when the mode actually moved', async () => {
      stateService.getState = jest.fn().mockResolvedValue({
        ...updatedState,
        companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
      });
      stateService.setCompanionChordProgression = jest.fn().mockResolvedValue({
        ...updatedState,
        companionChordProgression: { mode: 'manual', chords: [], barsPerChord: 1, currentChordIndex: 0 },
      });

      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 1, durationBars: 1 }], barsPerChord: 1, currentChordIndex: 0 },
      });

      expect(namespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.COMPANION_STATE_SYNC,
        expect.objectContaining({ changedRoomControls: ['progressionMode'] }),
      );
    });

    // A manual chord edit is committed through this same event. Naming progressionMode for it
    // lit the Auto/Manual toggle for a change made two controls away, inside the modal.
    it('names nothing when only the chords moved — the Auto/Manual toggle must stay dark', async () => {
      const manual = { mode: 'manual' as const, chords: [], barsPerChord: 1, currentChordIndex: 0 };
      stateService.getState = jest.fn().mockResolvedValue({ ...updatedState, companionChordProgression: manual });
      stateService.setCompanionChordProgression = jest.fn().mockResolvedValue({
        ...updatedState,
        companionChordProgression: { ...manual, chords: [{ degree: 4, durationBars: 1 }] },
      });

      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 4, durationBars: 1 }], barsPerChord: 1, currentChordIndex: 0 },
      });

      const payload: unknown = jest.mocked(namespace.emit).mock.calls.at(-1)?.[1];
      expect(payload).not.toHaveProperty('changedRoomControls');
    });

    it('persists and broadcasts a valid manual progression', async () => {
      await handler.handleCompanionSetChordProgression(socket, namespace, {
        roomId,
        progression: { mode: 'manual', chords: [{ degree: 1, durationBars: 1 }, { degree: 5, durationBars: 2 }], barsPerChord: 1, currentChordIndex: 0 },
      });
      expect(stateService.setCompanionChordProgression).toHaveBeenCalled();
    });
  });

  // DEV-202: room-global progression flavor handler.
  // Round 10: the badges follow the VALUE, not the payload. The genre picker re-sends the
  // current intensity alongside a new genre, and attributing everything that arrived lit up
  // three badges for one click on every other client.
  it('names a room control only when its value actually moved', async () => {
    stateService.getState = jest.fn().mockResolvedValue({ ...updatedState, companionProgressionFlavor: 'diatonic' });
    stateService.setCompanionProgressionFlavor = jest
      .fn()
      .mockResolvedValue({ ...updatedState, companionProgressionFlavor: 'borrowed' });

    await handler.handleCompanionSetProgressionFlavor(socket, namespace, { roomId, flavor: 'borrowed' });

    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.COMPANION_STATE_SYNC,
      expect.objectContaining({ changedRoomControls: ['progressionFlavor'] }),
    );
  });

  describe('handleCompanionSetProgressionFlavor', () => {
    it('rejects an invalid flavor value', async () => {
      await handler.handleCompanionSetProgressionFlavor(socket, namespace, { roomId, flavor: 'spicy' });
      expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
      expect(stateService.setCompanionProgressionFlavor).not.toHaveBeenCalled();
    });

    it('rejects audience users before persisting', async () => {
      (roomMembershipService.findUserInRoom as jest.Mock).mockResolvedValue({ role: 'audience' });
      await handler.handleCompanionSetProgressionFlavor(socket, namespace, { roomId, flavor: 'borrowed' });
      expect(stateService.setCompanionProgressionFlavor).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: 'Audience cannot change progression flavor companions' }),
      );
    });

    it('persists a valid flavor and broadcasts state to the whole room (namespace.to)', async () => {
      await handler.handleCompanionSetProgressionFlavor(socket, namespace, { roomId, flavor: 'secondary-dominant' });
      expect(stateService.setCompanionProgressionFlavor).toHaveBeenCalledWith(roomId, 'secondary-dominant');
      expect(CompanionScheduler.clearGeneratedNoteCache).toHaveBeenCalledTimes(1);
      expect(namespace.to).toHaveBeenCalledWith(roomId);
      expect(namespace.emit).toHaveBeenCalledWith('perform:companion_state_sync', {
        companions: updatedState.companions,
        companionChordLength: updatedState.companionChordLength,
        companionChordProgression: updatedState.companionChordProgression,
        companionProgressionFlavor: updatedState.companionProgressionFlavor,
        companionSelectedGenrePreset: updatedState.companionSelectedGenrePreset,
        companionSelectedIntensity: updatedState.companionSelectedIntensity,
        companionOverrideInstruments: updatedState.companionOverrideInstruments,
        userId: 'user-1',
      });
    });

    // A genre/intensity click derives a new flavor and broadcasts it as a SIDE EFFECT --
    // nobody touched the Harmonic Flavor select, so claiming that control put the badge on
    // the wrong row (the reported "genre badge shows at the bottom of the panel").
    it('does not name progressionFlavor when the change is derived from a preset click', async () => {
      stateService.getState = jest.fn().mockResolvedValue({ ...updatedState, companionProgressionFlavor: 'diatonic' });
      stateService.setCompanionProgressionFlavor = jest
        .fn()
        .mockResolvedValue({ ...updatedState, companionProgressionFlavor: 'borrowed' });

      await handler.handleCompanionSetProgressionFlavor(socket, namespace, {
        roomId,
        flavor: 'borrowed',
        derived: true,
      });

      expect(stateService.setCompanionProgressionFlavor).toHaveBeenCalledWith(roomId, 'borrowed');
      const payload: unknown = jest.mocked(namespace.emit).mock.calls.at(-1)?.[1];
      expect(payload).not.toHaveProperty('changedRoomControls');
    });
  });

  describe('drumParts validation', () => {
    const validDrumParts = {
      kick: true,
      snare: true,
      toms: true,
      hat: true,
      crash: true,
      ride: true,
      others: true,
    };

    it('accepts a full 7-key boolean drumParts record and stores all 7 keys', async () => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: { drumParts: validDrumParts },
      });

      const call = (stateService.updateCompanion as jest.Mock).mock.calls[0] as [string, string, { drumParts?: Record<string, boolean> }];
      const stored = call[2].drumParts;
      expect(stored).toBeDefined();
      expect(Object.keys(stored!).sort()).toEqual(['crash', 'hat', 'kick', 'others', 'ride', 'snare', 'toms']);
    });

    it('strips unknown extra keys — stored drumParts contains ONLY the 7 canonical keys', async () => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: {
          drumParts: {
            ...validDrumParts,
            injectedKey: true,
            extraField: false,
          },
        },
      });

      const call = (stateService.updateCompanion as jest.Mock).mock.calls[0] as [string, string, { drumParts?: Record<string, boolean> }];
      const stored = call[2].drumParts;
      expect(stored).toBeDefined();
      // Must have exactly the 7 canonical keys, nothing extra
      expect(Object.keys(stored!).sort()).toEqual(['crash', 'hat', 'kick', 'others', 'ride', 'snare', 'toms']);
      expect(Object.keys(stored!)).toHaveLength(7);
    });

    it('rejects a partial drumParts record (missing keys) — validated.drumParts is undefined', async () => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: { drumParts: { snare: false } }, // missing 6 of 7 keys
      });

      const call = (stateService.updateCompanion as jest.Mock).mock.calls[0] as [string, string, { drumParts?: unknown }];
      expect(call[2].drumParts).toBeUndefined();
    });

    it.each([
      ['string', 'x'],
      ['array', [true, false]],
      ['null', null],
    ])('rejects non-object drumParts value (%s) — validated.drumParts is undefined', async (_label, badValue) => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: { drumParts: badValue },
      });

      const call = (stateService.updateCompanion as jest.Mock).mock.calls[0] as [string, string, { drumParts?: unknown }];
      expect(call[2].drumParts).toBeUndefined();
    });
  });

  // Companion add/remove changes the room's companion count, so the lobby must be
  // notified (RoomOccupancyChanged → live card refresh). Update does NOT change the
  // count and must stay silent.
  describe('lobby occupancy trigger', () => {
    it('notifies the lobby when a companion is added', async () => {
      await handler.handleCompanionAdd(socket, namespace, { roomId, instrumentId: 'bass' });

      expect(stateService.addCompanion).toHaveBeenCalledTimes(1);
      expect(onCompanionCountChanged).toHaveBeenCalledWith(roomId);
    });

    it('notifies the lobby when a companion is removed', async () => {
      await handler.handleCompanionRemove(socket, namespace, { roomId, companionId: 'companion-1' });

      expect(stateService.removeCompanion).toHaveBeenCalledWith(roomId, 'companion-1');
      expect(onCompanionCountChanged).toHaveBeenCalledWith(roomId);
    });

    it('does NOT notify the lobby on a companion update (count unchanged)', async () => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: { volume: -6 },
      });

      expect(stateService.updateCompanion).toHaveBeenCalledTimes(1);
      expect(onCompanionCountChanged).not.toHaveBeenCalled();
    });

    it('does NOT notify the lobby when an audience member is rejected before adding', async () => {
      (roomMembershipService.findUserInRoom as jest.Mock).mockResolvedValue({ role: 'audience' });

      await handler.handleCompanionAdd(socket, namespace, { roomId, instrumentId: 'bass' });

      expect(stateService.addCompanion).not.toHaveBeenCalled();
      expect(onCompanionCountChanged).not.toHaveBeenCalled();
    });
  });

  describe('drumFillIntervalBars validation', () => {
    it('accepts a 16-bar fill interval', async () => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: { drumFillIntervalBars: 16 },
      });

      const call = (stateService.updateCompanion as jest.Mock).mock.calls[0] as [string, string, { drumFillIntervalBars?: number }];
      expect(call[2].drumFillIntervalBars).toBe(16);
    });

    it('rejects an invalid fill interval (e.g. 5)', async () => {
      await handler.handleCompanionUpdate(socket, namespace, {
        roomId,
        companionId: 'companion-1',
        updates: { drumFillIntervalBars: 5 },
      });

      const call = (stateService.updateCompanion as jest.Mock).mock.calls[0] as [string, string, { drumFillIntervalBars?: number }];
      expect(call[2].drumFillIntervalBars).toBeUndefined();
    });
  });

  describe('handleCompanionAdd restricted cap', () => {
    const makeCompanions = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) as PerformRoomState['companions'];

    it('blocks a guest from adding a 3rd companion (restricted cap = 2)', async () => {
      socket.data = { user: { id: 'g1', userType: 'GUEST', emailVerified: false } };
      (stateService.getState as jest.Mock).mockResolvedValue({ ...updatedState, companions: makeCompanions(2) });

      await handler.handleCompanionAdd(socket, namespace, { roomId });

      expect(stateService.addCompanion).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: SOCKET_ERROR_CODES.REGISTER_REQUIRED }),
      );
    });

    it('lets a guest add while under the restricted cap', async () => {
      socket.data = { user: { id: 'g1', userType: 'GUEST', emailVerified: false } };
      (stateService.getState as jest.Mock).mockResolvedValue({ ...updatedState, companions: makeCompanions(1) });

      await handler.handleCompanionAdd(socket, namespace, { roomId });

      expect(stateService.addCompanion).toHaveBeenCalledTimes(1);
    });

    it('lets a verified user add past the restricted cap (room-wide cap still 5)', async () => {
      socket.data = { user: { id: 'u1', userType: 'REGISTERED', emailVerified: true } };
      (stateService.getState as jest.Mock).mockResolvedValue({ ...updatedState, companions: makeCompanions(3) });

      await handler.handleCompanionAdd(socket, namespace, { roomId });

      expect(stateService.addCompanion).toHaveBeenCalledTimes(1);
    });
  });
});
