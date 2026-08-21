import { NotePlayingHandler } from '../NotePlayingHandler';
import type { PlayNoteData } from '../../../../../types';

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

describe('NotePlayingHandler - handlePlayNoteNamespace', () => {
  let handler: NotePlayingHandler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRoomLifecycleService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRoomMembershipService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockIo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockNamespaceManager: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRoomSessionManager: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSocket: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockNamespace: any;

  beforeEach(() => {
    mockRoomLifecycleService = {};
    mockRoomMembershipService = {
      updateUserInstrument: jest.fn().mockResolvedValue(true)
    };
    mockIo = {};
    mockNamespaceManager = {};
    mockRoomSessionManager = {
      getRoomSession: jest.fn()
    };
    mockSocket = {
      id: 'socket-123',
      broadcast: {
        emit: jest.fn()
      },
      data: {}
    };
    mockNamespace = {
      name: '/room/test-room'
    };

    handler = new NotePlayingHandler(
      mockRoomLifecycleService,
      mockRoomMembershipService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  it('should ignore and return immediately if no room session is found', async () => {
void mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

    const testData: PlayNoteData = {
      notes: ['C4'],
      velocity: 100,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on'
    };
    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockSocket.broadcast.emit).not.toHaveBeenCalled();
    expect(mockRoomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
  });

  it('should ignore and return immediately if the user role is not room_owner or band_member (e.g. audience)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-audience',
      role: 'audience' // <--- Audience role
    });

    const testData: PlayNoteData = {
      notes: ['C4'],
      velocity: 100,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on'
    };
    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockSocket.broadcast.emit).not.toHaveBeenCalled();
    expect(mockRoomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
  });

  it('should ignore if role is completely missing in session', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'guest'
      // role is missing
    });

    const testData: PlayNoteData = {
      notes: ['C4'],
      velocity: 100,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on'
    };
    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockSocket.broadcast.emit).not.toHaveBeenCalled();
    expect(mockRoomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
  });

  it('should broadcast perform:note_played and update instrument on cold-start (no cached instrument)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    // socket.data exists but has no cached instrument (cold-start)
    mockSocket.data = {};

    const testData: PlayNoteData = {
      notes: ['C4', 'E4'],
      velocity: 127,
      instrument: 'synthesizer',
      category: 'synthesizer',
      eventType: 'note_on',
      isKeyHeld: true,
      sampleNotes: []
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({
        userId: 'user-456',
        username: 'test-musician',
        notes: ['C4', 'E4'],
        velocity: 127,
        instrument: 'synthesizer',
        category: 'synthesizer',
        eventType: 'note_on',
        isKeyHeld: true
      })
    );

    // Cold-start: cache was isEmpty, so Redis must be updated
    expect(mockRoomMembershipService.updateUserInstrument).toHaveBeenCalledWith(
      'room-123',
      'user-456',
      'synthesizer',
      'synthesizer'
    );

    // Cache should now be populated
    expect(mockSocket.data.currentInstrument).toBe('synthesizer');
    expect(mockSocket.data.currentCategory).toBe('synthesizer');
  });

  it('should broadcast but skip Redis when the same instrument is played again (cache hit)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    // Cache already populated — same instrument as incoming data
    mockSocket.data = {
      currentInstrument: 'piano',
      currentCategory: 'melodic'
    };

    const testData: PlayNoteData = {
      notes: ['G4'],
      velocity: 90,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on'
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    // Broadcast must still happen — audio is always fire-and-forget
    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({ instrument: 'piano', category: 'melodic' })
    );

    // Cache hit: Redis must NOT be called
    expect(mockRoomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
  });

  it('should broadcast and update Redis when the instrument changes (cache miss)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    // Cache has old instrument
    mockSocket.data = {
      currentInstrument: 'piano',
      currentCategory: 'melodic'
    };

    const testData: PlayNoteData = {
      notes: ['A2'],
      velocity: 100,
      instrument: 'bass',
      category: 'bass',
      eventType: 'note_on'
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({ instrument: 'bass', category: 'bass' })
    );

    // Cache miss: instrument changed → Redis must be updated
    expect(mockRoomMembershipService.updateUserInstrument).toHaveBeenCalledWith(
      'room-123',
      'user-456',
      'bass',
      'bass'
    );

    // Cache should be updated to the new instrument
    expect(mockSocket.data.currentInstrument).toBe('bass');
    expect(mockSocket.data.currentCategory).toBe('bass');
  });

  it('should broadcast and update Redis when only the category changes (cache miss on category)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    // Cache: same instrument name but different category
    mockSocket.data = {
      currentInstrument: 'synth',
      currentCategory: 'melodic'
    };

    const testData: PlayNoteData = {
      notes: ['C3'],
      velocity: 80,
      instrument: 'synth',
      category: 'bass', // category changed
      eventType: 'note_on'
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockRoomMembershipService.updateUserInstrument).toHaveBeenCalledWith(
      'room-123',
      'user-456',
      'synth',
      'bass'
    );

    expect(mockSocket.data.currentCategory).toBe('bass');
  });

  it('should broadcast and update Redis when socket.data is undefined (no crash)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    // socket.data is undefined (edge case: before any session assignment)
    mockSocket.data = undefined;

    const testData: PlayNoteData = {
      notes: ['D4'],
      velocity: 70,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on'
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    // Broadcast must still happen
    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({ instrument: 'piano' })
    );

    // undefined !== 'piano' → cache miss → Redis is updated
    expect(mockRoomMembershipService.updateUserInstrument).toHaveBeenCalledWith(
      'room-123',
      'user-456',
      'piano',
      'melodic'
    );
  });

  it('should broadcast perform:note_played if user is room_owner', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'owner-789',
      username: 'test-owner',
      role: 'room_owner'
    });
    mockSocket.data = {};

    const testData: PlayNoteData = {
      notes: ['A4'],
      velocity: 80,
      instrument: 'drum',
      category: 'drum',
      eventType: 'note_on'
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({
        userId: 'owner-789',
        username: 'test-owner',
        notes: ['A4']
      })
    );

    // Cold-start for owner → Redis updated once
    expect(mockRoomMembershipService.updateUserInstrument).toHaveBeenCalledTimes(1);
  });

  it('should reset cache on Redis failure so the next note retries (no permanent stale state)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    mockSocket.data = {};

    // Redis call will fail
void mockRoomMembershipService.updateUserInstrument.mockRejectedValue(new Error('Redis connection lost'));

    const testData: PlayNoteData = {
      notes: ['C4'],
      velocity: 100,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on'
    };

    await handler.handlePlayNoteNamespace(mockSocket, testData, mockNamespace);

    // Wait for the rejected promise's .catch() to execute
    await Promise.resolve();

    // Cache must be cleared so the next note retries Redis
    expect(mockSocket.data.currentInstrument).toBeUndefined();
    expect(mockSocket.data.currentCategory).toBeUndefined();

    // Broadcast still happened despite Redis failure
    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({ instrument: 'piano' })
    );
  });

  it('ignores a spoofed userId injected into the note payload and broadcasts the session id (DEV-179)', async () => {
    mockRoomSessionManager.getRoomSession.mockReturnValue({
      roomId: 'room-123',
      userId: 'user-456',
      username: 'test-musician',
      role: 'band_member'
    });
    mockSocket.data = {};

    // PlayNoteData defines no userId; an attacker injects one anyway. The handler must
    // attribute the note to the token-verified session id, never the payload field.
    const spoofedPayload: PlayNoteData & { userId: string } = {
      notes: ['C4'],
      velocity: 100,
      instrument: 'piano',
      category: 'melodic',
      eventType: 'note_on',
      userId: 'victim-9999'
    };

    await handler.handlePlayNoteNamespace(mockSocket, spoofedPayload, mockNamespace);

    expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({ userId: 'user-456' })
    );
    expect(mockSocket.broadcast.emit).not.toHaveBeenCalledWith(
      'perform:note_played',
      expect.objectContaining({ userId: 'victim-9999' })
    );
  });
});
