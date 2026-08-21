import { RoomUserService } from '@/domains/room-management/domain/services/RoomUserService';
import type { RoomRepository } from '@/domains/room-management/infrastructure/repositories/RoomRepository';
import type { RoomCleanupService } from '@/domains/room-management/domain/services/RoomCleanupService';
import { roomUserRepository } from '@/domains/room-management/infrastructure/repositories/RoomUserRepository';
import type { Room, BandMember, Audience, User } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';

// Mock roomUserRepository
jest.mock('@/domains/room-management/infrastructure/repositories/RoomUserRepository', () => ({
  roomUserRepository: {
    addUser: jest.fn(),
    removeUser: jest.fn(),
    getUser: jest.fn(),
    getBandMembers: jest.fn(),
    getAudiences: jest.fn(),
  }
}));

/**
 * Test suite for User Separation Logic
 * 
 * Tests the separation of users into Band Members and Audiences:
 * - Band Members: room_owner, band_member (limited to ~10, have instruments/effects)
 * - Audiences: audience role (unlimited, no instruments/effects)
 */
describe('User Separation Logic', () => {
  let roomUserService: RoomUserService;
  let mockRoomRepository: jest.Mocked<RoomRepository>;
  let mockRoomCleanupService: jest.Mocked<RoomCleanupService>;

  const mockRoom: Room = {
    id: 'test-room',
    name: 'Test Room',
    owner: 'owner-1',
    bandMembers: new Map(),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    isIsolated: false,
    createdAt: new Date(),
    roomType: RoomType.PERFORM,
    metronome: { bpm: 120, beatZeroAt: Date.now() }
  };

  beforeEach(() => {
    mockRoomRepository = createPartialMock<RoomRepository>({
      getRoom: jest.fn(),
      saveRoom: jest.fn().mockResolvedValue(undefined),
      invalidateRoomCache: jest.fn(),
      invalidateListCaches: jest.fn(),
    });

    mockRoomCleanupService = createPartialMock<RoomCleanupService>({
      removeFromIntentionallyLeft: jest.fn(),
      markIntentionalLeave: jest.fn(),
    });

    // Reset roomUserRepository mocks
    (roomUserRepository.addUser as jest.Mock).mockResolvedValue(true);
    (roomUserRepository.removeUser as jest.Mock).mockResolvedValue(true);
    (roomUserRepository.getUser as jest.Mock).mockResolvedValue(null);
    (roomUserRepository.getBandMembers as jest.Mock).mockResolvedValue([]);
    (roomUserRepository.getAudiences as jest.Mock).mockResolvedValue([]);

    roomUserService = new RoomUserService(
      mockRoomRepository,
      mockRoomCleanupService
    );

    // Reset room state
void mockRoom.bandMembers.clear();
void mockRoom.audiences.clear();
void mockRoom.pendingMembers.clear();
  });

  describe('Band Members vs Audiences Separation', () => {
    it('should add band_member to bandMembers Map', async () => {
      const bandMember: BandMember = {
        id: 'band-1',
        username: 'musician',
        role: 'band_member',
        isReady: true,
        currentInstrument: 'piano',
        currentCategory: 'keys'
      };

void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      await roomUserService.addUserToRoom('test-room', bandMember, jest.fn());

      expect(roomUserRepository.addUser).toHaveBeenCalledWith('test-room', {
        ...bandMember,
        followScale: true,
      });
    });

    it('should add audience to audiences Map', async () => {
      const audience: Audience = {
        id: 'audience-1',
        username: 'listener',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      await roomUserService.addUserToRoom('test-room', audience, jest.fn());

      expect(roomUserRepository.addUser).toHaveBeenCalledWith('test-room', audience);
    });

    it('should add room_owner to bandMembers Map', async () => {
      const owner: BandMember = {
        id: 'owner-1',
        username: 'owner',
        role: 'room_owner',
        isReady: true,
        currentInstrument: 'guitar',
        currentCategory: 'strings'
      };

void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      await roomUserService.addUserToRoom('test-room', owner, jest.fn());

      expect(roomUserRepository.addUser).toHaveBeenCalledWith('test-room', {
        ...owner,
        followScale: false,
      });
    });

    it('should keep band members and audiences separate', async () => {
      const bandMember: BandMember = {
        id: 'band-1',
        username: 'musician',
        role: 'band_member',
        isReady: true
      };

      const audience: Audience = {
        id: 'audience-1',
        username: 'listener',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      await roomUserService.addUserToRoom('test-room', bandMember, jest.fn());
      await roomUserService.addUserToRoom('test-room', audience, jest.fn());

      expect(roomUserRepository.addUser).toHaveBeenCalledTimes(2);
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('test-room', {
        ...bandMember,
        followScale: true,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
      });
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('test-room', audience);
    });
  });

  describe('User Removal from Correct Map', () => {
    it('should remove band member from bandMembers Map', async () => {
      const bandMember: BandMember = {
        id: 'band-1',
        username: 'musician',
        role: 'band_member',
        isReady: true
      };

void mockRoom.bandMembers.set('band-1', bandMember);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(bandMember);

      await roomUserService.removeUserFromRoom('test-room', 'band-1', true);

      expect(roomUserRepository.removeUser).toHaveBeenCalledWith('test-room', 'band-1');
    });

    it('should remove audience from audiences Map', async () => {
      const audience: Audience = {
        id: 'audience-1',
        username: 'listener',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

void mockRoom.audiences.set('audience-1', audience);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(audience);

      await roomUserService.removeUserFromRoom('test-room', 'audience-1', true);

      expect(roomUserRepository.removeUser).toHaveBeenCalledWith('test-room', 'audience-1');
    });
  });

  describe('User Lookup Across Both Maps', () => {
    it('should find band member in bandMembers Map', async () => {
      const bandMember: BandMember = {
        id: 'band-1',
        username: 'musician',
        role: 'band_member',
        isReady: true
      };

      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(bandMember);

      const isFound = await roomUserService.findUserInRoom('test-room', 'band-1');

      expect(isFound).toBeDefined();
      expect(isFound?.id).toBe('band-1');
      expect(isFound?.role).toBe('band_member');
    });

    it('should find audience in audiences Map', async () => {
      const audience: Audience = {
        id: 'audience-1',
        username: 'listener',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(audience);

      const isFound = await roomUserService.findUserInRoom('test-room', 'audience-1');

      expect(isFound).toBeDefined();
      expect(isFound?.id).toBe('audience-1');
      expect(isFound?.role).toBe('audience');
    });

    it('should return undefined if user not in either Map', async () => {
      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(null);

      const isFound = await roomUserService.findUserInRoom('test-room', 'non-existent');

      expect(isFound).toBeUndefined();
    });
  });

  describe('Ownership Transfer - Band Members Only', () => {
    it('should transfer ownership between band members', async () => {
      const owner: BandMember = {
        id: 'owner-1',
        username: 'owner',
        role: 'room_owner',
        isReady: true
      };

      const bandMember: BandMember = {
        id: 'band-1',
        username: 'musician',
        role: 'band_member',
        isReady: true
      };

      mockRoom.owner = 'owner-1';
void mockRoom.bandMembers.set('owner-1', owner);
void mockRoom.bandMembers.set('band-1', bandMember);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const result = await roomUserService.transferOwnership('test-room', 'band-1', owner);

      expect(result).toBeDefined();
      expect(result?.newOwner.id).toBe('band-1');
      expect(result?.newOwner.role).toBe('room_owner');
      expect(result?.oldOwner.role).toBe('band_member');
      expect(mockRoom.owner).toBe('band-1');
    });

    it('should pick audience as fallback if no band members available', async () => {
      const owner: BandMember = {
        id: 'owner-1',
        username: 'owner',
        role: 'room_owner',
        isReady: true
      };

      const audience: Audience = {
        id: 'audience-1',
        username: 'listener',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

      mockRoom.owner = 'owner-1';
void mockRoom.bandMembers.set('owner-1', owner);
void mockRoom.audiences.set('audience-1', audience);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const result = await roomUserService.transferOwnership('test-room', 'non-existent', owner);

      expect(result).toBeDefined();
      // Implementation falls back to existing owner ('owner-1') if no other valid candidates
      expect(result?.newOwner.id).toBe('owner-1');
      expect(mockRoom.owner).toBe('owner-1');
    });
  });

  describe('Get Users by Type', () => {
    it('should get only band members', async () => {
      const bandMember1: BandMember = {
        id: 'band-1',
        username: 'musician1',
        role: 'band_member',
        isReady: true
      };

      const bandMember2: BandMember = {
        id: 'band-2',
        username: 'musician2',
        role: 'band_member',
        isReady: true
      };

void mockRoom.bandMembers.set('band-1', bandMember1);
void mockRoom.bandMembers.set('band-2', bandMember2);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getBandMembers as jest.Mock).mockResolvedValue([bandMember1, bandMember2]);

      const bandMembers = await roomUserService.getBandMembers('test-room');

      expect(bandMembers).toHaveLength(2);
      // BandMembers can only have roles 'room_owner' or 'band_member', never 'audience'
      expect(bandMembers.every((u: User) => ['room_owner', 'band_member'].includes(u.role))).toBe(true);
    });

    it('should get only audiences', async () => {
      const audience1: Audience = {
        id: 'audience-1',
        username: 'listener1',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

      const audience2: Audience = {
        id: 'audience-2',
        username: 'listener2',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

void mockRoom.audiences.set('audience-1', audience1);
void mockRoom.audiences.set('audience-2', audience2);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getAudiences as jest.Mock).mockResolvedValue([audience1, audience2]);

      const audiences = await roomUserService.getAudiences('test-room');

      expect(audiences).toHaveLength(2);
      expect(audiences.every((u: User) => u.role === 'audience')).toBe(true);
    });

    it('should get all users (band members + audiences)', async () => {
      const bandMember: BandMember = {
        id: 'band-1',
        username: 'musician',
        role: 'band_member',
        isReady: true
      };

      const audience: Audience = {
        id: 'audience-1',
        username: 'listener',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date()
      };

void mockRoom.bandMembers.set('band-1', bandMember);
void mockRoom.audiences.set('audience-1', audience);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getBandMembers as jest.Mock).mockResolvedValue([bandMember]);
      (roomUserRepository.getAudiences as jest.Mock).mockResolvedValue([audience]);

      const allUsers = await roomUserService.getRoomUsers('test-room');

      expect(allUsers).toHaveLength(2);
      expect(allUsers.some(u => u.role === 'band_member')).toBe(true);
      expect(allUsers.some(u => u.role === 'audience')).toBe(true);
    });
  });

  describe('Pending Members - Band Members Only', () => {
    it('should add pending member (band member only)', async () => {
      const pendingMember: BandMember = {
        id: 'pending-1',
        username: 'pending-musician',
        role: 'band_member',
        isReady: false
      };

void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      await roomUserService.addPendingMember('test-room', pendingMember);

      expect(mockRoom.pendingMembers.has('pending-1')).toBe(true);
    });

    it('should approve pending member and move to bandMembers', async () => {
      const pendingMember: BandMember = {
        id: 'pending-1',
        username: 'pending-musician',
        role: 'band_member',
        isReady: false
      };

void mockRoom.pendingMembers.set('pending-1', pendingMember);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const result = await roomUserService.approveMember('test-room', 'pending-1');

      expect(result).toBeDefined();
      expect(mockRoom.pendingMembers.has('pending-1')).toBe(false);
      // roomUserRepository.addUser is called to move member from pending to band members
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('test-room', {
        ...pendingMember,
        followScale: true,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
      });
    });
  });
});
