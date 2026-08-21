import { IdentitySwapHandoffService } from '../IdentitySwapHandoffService';

describe('IdentitySwapHandoffService', () => {
  let service: IdentitySwapHandoffService;

  beforeEach(() => {
    service = new IdentitySwapHandoffService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('consumes a handoff record created for the same newUserId + roomId', () => {
    service.create({ newUserId: 'user-new', roomId: 'room-1', oldUserId: 'guest:abc' });

    const result = service.consume('user-new', 'room-1');

    expect(result).toEqual({ oldUserId: 'guest:abc' });
  });

  it('is single-use — a second consume returns null', () => {
    service.create({ newUserId: 'user-new', roomId: 'room-1', oldUserId: 'guest:abc' });

    service.consume('user-new', 'room-1');
    const second = service.consume('user-new', 'room-1');

    expect(second).toBeNull();
  });

  it('returns null for a mismatched roomId', () => {
    service.create({ newUserId: 'user-new', roomId: 'room-1', oldUserId: 'guest:abc' });

    expect(service.consume('user-new', 'room-2')).toBeNull();
  });

  it('returns null for an unknown newUserId', () => {
    expect(service.consume('unknown-user', 'room-1')).toBeNull();
  });

  it('expires after 60 seconds', () => {
    service.create({ newUserId: 'user-new', roomId: 'room-1', oldUserId: 'guest:abc' });

    jest.advanceTimersByTime(61_000);

    expect(service.consume('user-new', 'room-1')).toBeNull();
  });
});
