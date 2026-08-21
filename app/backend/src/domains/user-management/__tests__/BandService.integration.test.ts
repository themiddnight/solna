/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-assignment */

/**
 * BR-9: BandService Integration Tests
 *
 * Covers: create band, invite token, join, remove member, leave band,
 * delete band, band members list, and the critical auto-reset-to-PRIVATE
 * behavior when a member leaves or a band is deleted.
 */

import { prisma } from '../../../config/prisma';
import { BandService } from '../application/services/BandService';
import { BandRole, ProjectVisibility } from '@prisma/client';

describe('BR-9: BandService Integration Tests', () => {
  const users: Array<{ id: string; username: string | null; email: string | null }> = [];
  let bandIds: string[] = [];
  let projectIds: string[] = [];

  beforeAll(async () => {
    for (let i = 1; i <= 4; i++) {
      const user = await prisma.user.create({
        data: {
          username: `band-test-user-${i}-${Date.now()}`,
          email: `band-test-${i}-${Date.now()}@test.com`,
        },
      });
      users.push(user);
    }
  });

  afterEach(async () => {
    for (const projectId of projectIds) {
      await prisma.savedProject.delete({ where: { id: projectId } }).catch(() => {});
    }
    projectIds = [];

    for (const bandId of bandIds) {
      await prisma.band.delete({ where: { id: bandId } }).catch(() => {});
    }
    bandIds = [];
  });

  afterAll(async () => {
    for (const user of users) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  // ─── Create Band ───────────────────────────────────────────────────────────

  describe('createBand', () => {
    it('creates a band and auto-assigns creator as OWNER', async () => {
      const owner = users[0]!;
      const band = await BandService.createBand({ name: `TestBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const membership = await prisma.bandMember.findUnique({
        where: { bandId_userId: { bandId: band.id, userId: owner.id } },
      });

      expect(band.id).toBeDefined();
      expect(band.inviteToken).toBeDefined();
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe(BandRole.OWNER);
    });

    it('generates a unique invite token for each band', async () => {
      const owner = users[0]!;
      const band1 = await BandService.createBand({ name: `Band1-${Date.now()}`, ownerId: owner.id });
      const band2 = await BandService.createBand({ name: `Band2-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band1.id, band2.id);

      expect(band1.inviteToken).not.toBe(band2.inviteToken);
    });
  });

  // ─── Invite Token ──────────────────────────────────────────────────────────

  describe('refreshInviteToken', () => {
    it('owner can refresh invite token and gets a new token back', async () => {
      const owner = users[0]!;
      const band = await BandService.createBand({ name: `TokenBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const newToken = await BandService.refreshInviteToken(band.id, owner.id);

      expect(newToken).not.toBeNull();
      expect(newToken).not.toBe(band.inviteToken);
    });

    it('non-owner cannot refresh invite token and gets null', async () => {
      const owner = users[0]!;
      const member = users[1]!;
      const band = await BandService.createBand({ name: `TokenBand2-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      await prisma.bandMember.create({
        data: { bandId: band.id, userId: member.id, role: BandRole.MEMBER },
      });

      const result = await BandService.refreshInviteToken(band.id, member.id);
      expect(result).toBeNull();
    });
  });

  // ─── Join Band by Token ────────────────────────────────────────────────────

  describe('joinBandByToken', () => {
    it('user can join a band with valid invite token and gets MEMBER role', async () => {
      const owner = users[0]!;
      const joiner = users[1]!;
      const band = await BandService.createBand({ name: `JoinBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const membership = await BandService.joinBandByToken(band.inviteToken, joiner.id);

      expect(membership).not.toBeNull();
      expect(membership!.userId).toBe(joiner.id);
      expect(membership!.role).toBe(BandRole.MEMBER);
    });

    it('returns null for an invalid invite token', async () => {
      const result = await BandService.joinBandByToken('non-existent-token-xyz', users[1]!.id);
      expect(result).toBeNull();
    });

    it('returns existing membership when user is already a member (idempotent)', async () => {
      const owner = users[0]!;
      const joiner = users[1]!;
      const band = await BandService.createBand({ name: `IdempotentJoin-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const first = await BandService.joinBandByToken(band.inviteToken, joiner.id);
      const second = await BandService.joinBandByToken(band.inviteToken, joiner.id);

      expect(first!.bandId).toBe(second!.bandId);
      expect(first!.userId).toBe(second!.userId);
    });
  });

  // ─── Get Band Members ──────────────────────────────────────────────────────

  describe('getBandMembers', () => {
    it('returns all members with user info', async () => {
      const owner = users[0]!;
      const member1 = users[1]!;
      const member2 = users[2]!;

      const band = await BandService.createBand({ name: `MembersBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      await prisma.bandMember.createMany({
        data: [
          { bandId: band.id, userId: member1.id, role: BandRole.MEMBER },
          { bandId: band.id, userId: member2.id, role: BandRole.MEMBER },
        ],
      });

      const members = await BandService.getBandMembers(band.id);

      expect(members.length).toBe(3); // owner + 2 members
      const ids = members.map((m) => m.id);
      expect(ids).toContain(owner.id);
      expect(ids).toContain(member1.id);
      expect(ids).toContain(member2.id);
    });

    it('includes role and joinedAt for each member', async () => {
      const owner = users[0]!;
      const band = await BandService.createBand({ name: `RoleBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const members = await BandService.getBandMembers(band.id);

      expect(members[0]).toMatchObject({
        id: expect.any(String),
        role: expect.stringMatching(/^(OWNER|MEMBER)$/),
        joinedAt: expect.any(Date),
      });
    });
  });

  // ─── Remove Member ─────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('owner can remove a regular member', async () => {
      const owner = users[0]!;
      const member = users[1]!;

      const band = await BandService.createBand({ name: `RemoveBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);
      await prisma.bandMember.create({ data: { bandId: band.id, userId: member.id, role: BandRole.MEMBER } });

      const result = await BandService.removeMember(band.id, member.id, owner.id);

      expect(result).toBe(true);
      const remaining = await prisma.bandMember.findUnique({
        where: { bandId_userId: { bandId: band.id, userId: member.id } },
      });
      expect(remaining).toBeNull();
    });

    it('owner cannot remove themselves', async () => {
      const owner = users[0]!;
      const band = await BandService.createBand({ name: `SelfRemoveBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const result = await BandService.removeMember(band.id, owner.id, owner.id);
      expect(result).toBe(false);
    });

    it('non-owner cannot remove a member', async () => {
      const owner = users[0]!;
      const member1 = users[1]!;
      const member2 = users[2]!;

      const band = await BandService.createBand({ name: `NonOwnerRemove-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);
      await prisma.bandMember.createMany({
        data: [
          { bandId: band.id, userId: member1.id, role: BandRole.MEMBER },
          { bandId: band.id, userId: member2.id, role: BandRole.MEMBER },
        ],
      });

      const result = await BandService.removeMember(band.id, member2.id, member1.id);
      expect(result).toBe(false);
    });
  });

  // ─── Leave Band ────────────────────────────────────────────────────────────

  describe('leaveBand', () => {
    it('regular member can leave a band', async () => {
      const owner = users[0]!;
      const member = users[1]!;

      const band = await BandService.createBand({ name: `LeaveBand-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);
      await prisma.bandMember.create({ data: { bandId: band.id, userId: member.id, role: BandRole.MEMBER } });

      const result = await BandService.leaveBand(band.id, member.id);

      expect(result).toBe(true);
      const membership = await prisma.bandMember.findUnique({
        where: { bandId_userId: { bandId: band.id, userId: member.id } },
      });
      expect(membership).toBeNull();
    });

    it('owner cannot leave their own band', async () => {
      const owner = users[0]!;
      const band = await BandService.createBand({ name: `OwnerLeave-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const result = await BandService.leaveBand(band.id, owner.id);
      expect(result).toBe(false);
    });

    it('non-member returns false', async () => {
      const owner = users[0]!;
      const outsider = users[1]!;

      const band = await BandService.createBand({ name: `NonMemberLeave-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);

      const result = await BandService.leaveBand(band.id, outsider.id);
      expect(result).toBe(false);
    });

    it('[CRITICAL] member leaving resets sole-band BAND project to PRIVATE', async () => {
      const owner = users[0]!;
      const member = users[1]!;

      const band = await BandService.createBand({ name: `VisReset-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);
      await prisma.bandMember.create({ data: { bandId: band.id, userId: member.id, role: BandRole.MEMBER } });

      // member owns a project shared with only this band
      const project = await prisma.savedProject.create({
        data: {
          name: `SharedProject-${Date.now()}`,
          userId: member.id,
          roomType: 'arrange',
          visibility: ProjectVisibility.BAND,
          bands: { connect: { id: band.id } },
        },
      });
      projectIds.push(project.id);

      await BandService.leaveBand(band.id, member.id);

      const updated = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { bands: true },
      });

      expect(updated!.visibility).toBe(ProjectVisibility.PRIVATE);
      expect(updated!.bands).toHaveLength(0);
    });

    it('member leaving keeps BAND visibility when project is still shared with other bands', async () => {
      const owner = users[0]!;
      const member = users[1]!;

      const band1 = await BandService.createBand({ name: `MultiBand1-${Date.now()}`, ownerId: owner.id });
      const band2 = await BandService.createBand({ name: `MultiBand2-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band1.id, band2.id);

      await prisma.bandMember.create({ data: { bandId: band1.id, userId: member.id, role: BandRole.MEMBER } });
      // member is not required to be in band2; project can still reference it

      const project = await prisma.savedProject.create({
        data: {
          name: `MultiSharedProject-${Date.now()}`,
          userId: member.id,
          roomType: 'arrange',
          visibility: ProjectVisibility.BAND,
          bands: { connect: [{ id: band1.id }, { id: band2.id }] },
        },
      });
      projectIds.push(project.id);

      await BandService.leaveBand(band1.id, member.id);

      const updated = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { bands: true },
      });

      expect(updated!.visibility).toBe(ProjectVisibility.BAND);
      expect(updated!.bands.map((b) => b.id)).not.toContain(band1.id);
      expect(updated!.bands.map((b) => b.id)).toContain(band2.id);
    });
  });

  // ─── Delete Band ───────────────────────────────────────────────────────────

  describe('deleteBand', () => {
    it('owner can delete their band', async () => {
      const owner = users[0]!;
      const band = await BandService.createBand({ name: `DeleteBand-${Date.now()}`, ownerId: owner.id });

      const result = await BandService.deleteBand(band.id, owner.id);

      expect(result).toBe(true);
      const isFound = await prisma.band.findUnique({ where: { id: band.id } });
      expect(isFound).toBeNull();
    });

    it('non-owner cannot delete band', async () => {
      const owner = users[0]!;
      const member = users[1]!;

      const band = await BandService.createBand({ name: `DeleteForbidden-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band.id);
      await prisma.bandMember.create({ data: { bandId: band.id, userId: member.id, role: BandRole.MEMBER } });

      const result = await BandService.deleteBand(band.id, member.id);
      expect(result).toBe(false);
    });

    it('deleting band resets sole-band BAND project to PRIVATE', async () => {
      const owner = users[0]!;
      const projectOwner = users[1]!;

      const band = await BandService.createBand({ name: `DeleteReset-${Date.now()}`, ownerId: owner.id });
      await prisma.bandMember.create({ data: { bandId: band.id, userId: projectOwner.id, role: BandRole.MEMBER } });

      const project = await prisma.savedProject.create({
        data: {
          name: `ProjectToReset-${Date.now()}`,
          userId: projectOwner.id,
          roomType: 'arrange',
          visibility: ProjectVisibility.BAND,
          bands: { connect: { id: band.id } },
        },
      });
      projectIds.push(project.id);

      await BandService.deleteBand(band.id, owner.id);

      const updated = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { bands: true },
      });

      expect(updated!.visibility).toBe(ProjectVisibility.PRIVATE);
      expect(updated!.bands).toHaveLength(0);
    });

    it('deleting band keeps BAND visibility on projects still shared with other bands', async () => {
      const owner = users[0]!;

      const band1 = await BandService.createBand({ name: `DeleteKeep1-${Date.now()}`, ownerId: owner.id });
      const band2 = await BandService.createBand({ name: `DeleteKeep2-${Date.now()}`, ownerId: owner.id });
      bandIds.push(band2.id); // band1 will be deleted by the test

      const project = await prisma.savedProject.create({
        data: {
          name: `MultiSharedDelete-${Date.now()}`,
          userId: owner.id,
          roomType: 'arrange',
          visibility: ProjectVisibility.BAND,
          bands: { connect: [{ id: band1.id }, { id: band2.id }] },
        },
      });
      projectIds.push(project.id);

      await BandService.deleteBand(band1.id, owner.id);

      const updated = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { bands: true },
      });

      expect(updated!.visibility).toBe(ProjectVisibility.BAND);
      expect(updated!.bands.map((b) => b.id)).toContain(band2.id);
      expect(updated!.bands.map((b) => b.id)).not.toContain(band1.id);
    });
  });
});
