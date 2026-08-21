import { buildRoomPayload } from '../roomPayloadUtils';

describe('buildRoomPayload', () => {
  const membershipService = {
    getBandMembers: jest.fn(),
    getAudiences: jest.fn(),
    getPendingMembers: jest.fn(),
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T00:00:00.000Z'));
    membershipService.getBandMembers.mockResolvedValue([
      { id: 'active-1', username: 'Active', role: 'band_member' },
    ]);
    membershipService.getAudiences.mockResolvedValue([]);
    membershipService.getPendingMembers.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('adds non-intentional grace-period users without changing active member counts', async () => {
    const payload = await buildRoomPayload(
      membershipService,
      { id: 'room-1', name: 'Room' },
      'room-1',
      {
        getRoomGracePeriodUsers: () => [
          {
            userId: 'inactive-1',
            timestamp: Date.now() - 5_000,
            isIntendedLeave: false,
            userData: {
              id: 'inactive-1',
              username: 'Disconnected',
              role: 'band_member',
              isReady: true,
            },
          },
          {
            userId: 'intentional-1',
            timestamp: Date.now() - 5_000,
            isIntendedLeave: true,
            userData: {
              id: 'intentional-1',
              username: 'Left',
              role: 'band_member',
              isReady: true,
            },
          },
          {
            userId: 'active-1',
            timestamp: Date.now() - 5_000,
            isIntendedLeave: false,
            userData: {
              id: 'active-1',
              username: 'Active',
              role: 'band_member',
              isReady: true,
            },
          },
        ],
      },
    );

    expect(payload.room.bandMembers).toHaveLength(1);
    expect(payload.room.activeBandMemberCount).toBe(1);
    expect(payload.room.gracePeriodUsers).toEqual([
      expect.objectContaining({
        status: 'reconnecting',
        remainingMs: 25_000,
        isIntendedLeave: false,
        user: expect.objectContaining({ id: 'inactive-1' }) as unknown,
      }),
    ]);
  });
});
