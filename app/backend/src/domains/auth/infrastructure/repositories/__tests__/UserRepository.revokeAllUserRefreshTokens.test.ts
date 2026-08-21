/**
 * DEV-338: revokeAllUserRefreshTokens must hard-delete, not soft-revoke.
 *
 * AuthService.refreshAccessToken grants a 30s grace period to any token record whose
 * `revokedAt` is recent, to tolerate a legitimate multi-tab rotation race. A soft-revoke
 * (updateMany setting revokedAt) leaves a row for that branch to find, so a polling
 * attacker holding a stale token can ride out the 30s window after ANY security-triggered
 * revocation (OTP verify, OAuth link, logout) and mint a fresh session. Hard-deleting the
 * rows removes the token record entirely, so `findRefreshTokenByToken` returns null and
 * `refreshAccessToken` rejects immediately, with no grace period possible.
 */

const mockDeleteMany = jest.fn<Promise<{ count: number }>, [unknown]>().mockResolvedValue({ count: 1 });
const mockUpdateMany = jest.fn<Promise<{ count: number }>, [unknown]>().mockResolvedValue({ count: 1 });

jest.mock('@/config/prisma', () => ({
  prisma: {
    refreshToken: {
      deleteMany: (a: unknown) => mockDeleteMany(a),
      updateMany: (a: unknown) => mockUpdateMany(a),
    },
  },
}));

import { UserRepository } from '../UserRepository';

describe('UserRepository.revokeAllUserRefreshTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hard-deletes all of the user refresh tokens instead of soft-revoking them', async () => {
    const repo = new UserRepository();

    await repo.revokeAllUserRefreshTokens('user-123');

    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
