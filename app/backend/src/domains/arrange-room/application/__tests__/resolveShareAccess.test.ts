const mockFindUnique = jest.fn<Promise<unknown>, [unknown]>();
jest.mock('@/config/prisma', () => ({ prisma: { savedProject: { findUnique: (a: unknown) => mockFindUnique(a) } } }));

const mockIsMember = jest.fn<Promise<boolean>, [string, string]>();
jest.mock('../../../user-management/application/services/BandService', () => ({
  BandService: { isMember: (b: string, u: string) => mockIsMember(b, u) },
}));

import { projectApplicationService } from '../ProjectApplicationService';
import type { ShareAccessActor } from '../ProjectShareAccessService';

const PUBLIC = { id: 'p1', name: 'Pub', userId: 'owner', visibility: 'PUBLIC', roomType: 'arrange', bands: [] };
const BAND = { id: 'p2', name: 'Bnd', userId: 'owner', visibility: 'BAND', roomType: 'arrange', bands: [{ id: 'b1' }] };
const PRIVATE = { id: 'p3', name: 'Priv', userId: 'owner', visibility: 'PRIVATE', roomType: 'arrange', bands: [] };

const ANONYMOUS: ShareAccessActor = { userId: null, userType: null, isEmailVerified: false };
const GUEST: ShareAccessActor = { userId: 'g1', userType: 'GUEST', isEmailVerified: false };
const VERIFIED = (userId: string): ShareAccessActor => ({ userId, userType: 'REGISTERED', isEmailVerified: true });

describe('resolveShareAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('not_found when project missing', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await projectApplicationService.resolveShareAccess(VERIFIED('x'), 'nope'))
      .toEqual({ decision: 'not_found' });
  });

  // BR-20: anonymous and guest visitors can never open projects — always sent to login/signup,
  // with an identical response for every existing project (no visibility probing pre-auth).
  it.each([
    ['PUBLIC', PUBLIC, 'p1'],
    ['BAND', BAND, 'p2'],
    ['PRIVATE', PRIVATE, 'p3'],
  ])('auth_required for %s + anonymous', async (_label, project, id) => {
    mockFindUnique.mockResolvedValue(project);
    expect(await projectApplicationService.resolveShareAccess(ANONYMOUS, id))
      .toEqual({ decision: 'auth_required' });
  });

  it.each([
    ['PUBLIC', PUBLIC, 'p1'],
    ['BAND', BAND, 'p2'],
    ['PRIVATE', PRIVATE, 'p3'],
  ])('auth_required for %s + guest', async (_label, project, id) => {
    mockFindUnique.mockResolvedValue(project);
    expect(await projectApplicationService.resolveShareAccess(GUEST, id))
      .toEqual({ decision: 'auth_required' });
  });

  it('open for PUBLIC + verified registered', async () => {
    mockFindUnique.mockResolvedValue(PUBLIC);
    expect(await projectApplicationService.resolveShareAccess(VERIFIED('u'), 'p1'))
      .toEqual({ decision: 'open', projectName: 'Pub', roomType: 'arrange' });
  });

  it('open for BAND + verified member', async () => {
    mockFindUnique.mockResolvedValue(BAND);
    mockIsMember.mockResolvedValue(true);
    expect(await projectApplicationService.resolveShareAccess(VERIFIED('member'), 'p2'))
      .toEqual({ decision: 'open', projectName: 'Bnd', roomType: 'arrange' });
  });

  it('denied for BAND + verified non-member', async () => {
    mockFindUnique.mockResolvedValue(BAND);
    mockIsMember.mockResolvedValue(false);
    expect(await projectApplicationService.resolveShareAccess(VERIFIED('stranger'), 'p2'))
      .toEqual({ decision: 'denied' });
  });

  it('open for PRIVATE + owner', async () => {
    mockFindUnique.mockResolvedValue(PRIVATE);
    expect(await projectApplicationService.resolveShareAccess(VERIFIED('owner'), 'p3'))
      .toEqual({ decision: 'open', projectName: 'Priv', roomType: 'arrange' });
  });

  it('denied for PRIVATE + verified non-owner', async () => {
    mockFindUnique.mockResolvedValue(PRIVATE);
    expect(await projectApplicationService.resolveShareAccess(VERIFIED('other'), 'p3'))
      .toEqual({ decision: 'denied' });
  });
});
