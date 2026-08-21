import { BandService } from './services/BandService';
import { parsePaginationParams } from '../../../shared/utils/paginationUtils';
import { projectRoomService } from '../../arrange-room/infrastructure/storage/ProjectRoomService';
import { emailService } from '../../auth/infrastructure/services/EmailService';

export interface PaginationQuery {
  search?: string;
  page?: string | number;
  limit?: string | number;
}

interface ProjectWithRoom {
  id: string;
  name: string;
  description: string | null;
  roomType: string;
  metadata: unknown;
  visibility: string;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; username: string | null; profilePictureUrl: string | null };
  contributors: Array<{
    id: string;
    username: string | null;
    profilePictureUrl: string | null;
    lastContributedAt: Date;
  }>;
  activeRoomId: string | null;
  activeUserCount: number;
  activeRoomIsPrivate: boolean;
}

export class BandApplicationService {
  async listUserBands(userId: string, query: PaginationQuery) {
    const { search, page, limit, skip } = parsePaginationParams(query as unknown as Record<string, unknown>, { lowercaseSearch: true });

    let bands = await BandService.getUserBands(userId);

    if (search.length > 0) {
      bands = bands.filter((band) => {
        const hasNameMatch = band.name.toLowerCase().includes(search);
        const hasDescMatch = (band.description ?? '').toLowerCase().includes(search);
        return hasNameMatch || hasDescMatch;
      });
    }

    const total = bands.length;
    const paginatedBands = bands.slice(skip, skip + limit);

    const formattedBands = paginatedBands.map((band) => ({
      id: band.id,
      name: band.name,
      description: band.description,
      createdAt: band.createdAt,
      memberCount: band.members.length,
      myRole: band.members.find((m) => m.userId === userId)?.role,
      members: band.members.slice(0, 5).map((m) => ({
        id: m.user.id,
        username: m.user.username,
        role: m.role,
        profilePictureUrl: m.user.profilePictureUrl,
      })),
    }));

    return {
      bands: formattedBands,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getJoinPreview(token: string) {
    const band = await BandService.getBandByInviteToken(token);
    if (!band) throw new Error('NOT_FOUND: Invalid invite link');
    return { band: { id: band.id, name: band.name, description: band.description } };
  }

  async joinBand(token: string, userId: string) {
    const membership = await BandService.joinBandByToken(token, userId);
    if (!membership) throw new Error('NOT_FOUND: Invalid invite link');
    return { message: 'Successfully joined band', bandId: membership.bandId };
  }

  async listBandProjects(bandId: string, userId: string, query: PaginationQuery) {
    const isMember = await BandService.isMember(bandId, userId);
    if (!isMember) throw new Error('FORBIDDEN: Not a member of this band');

    const { search, page, limit, skip } = parsePaginationParams(query as unknown as Record<string, unknown>, { lowercaseSearch: true });

    let projects = await BandService.getBandProjects(bandId);

    if (search.length > 0) {
      projects = projects.filter((project) => {
        const hasNameMatch = project.name.toLowerCase().includes(search);
        const hasDescMatch = (project.description ?? '').toLowerCase().includes(search);
        return hasNameMatch || hasDescMatch;
      });
    }

    const total = projects.length;
    const paginatedProjects = projects.slice(skip, skip + limit);

    const enrichedProjects = await Promise.all(
      paginatedProjects.map(async (project) => {
        const roomInfo = await projectRoomService.getActiveRoomWithRealCount(project.id);
        return {
          ...project,
          activeRoomId: roomInfo.activeRoomId,
          activeUserCount: roomInfo.activeUserCount,
          activeRoomIsPrivate: roomInfo.isPrivate,
        } satisfies ProjectWithRoom;
      })
    );

    return {
      projects: enrichedProjects,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateBand(bandId: string, userId: string, cmd: { name?: string; description?: string }) {
    if (cmd.name !== undefined && (typeof cmd.name !== 'string' || cmd.name.trim().length === 0)) {
      throw new Error('BAD_REQUEST: Name cannot be empty');
    }

    try {
      const updateData: { name?: string; description?: string } = {};
      if (cmd.name !== undefined) updateData.name = cmd.name.trim();
      if (cmd.description !== undefined) updateData.description = cmd.description.trim();

      const updatedBand = await BandService.updateBand(bandId, userId, updateData);
      return { band: updatedBand };
    } catch (error) {
      if (error instanceof Error && error.message.includes('owner')) {
        throw new Error(`FORBIDDEN: ${error.message}`);
      }
      throw error;
    }
  }

  async getBandDetails(bandId: string, userId: string) {
    const isMember = await BandService.isMember(bandId, userId);
    if (!isMember) throw new Error('FORBIDDEN: Not a member of this band');

    const band = await BandService.getBand(bandId);
    if (!band) throw new Error('NOT_FOUND: Band not found');

    const myRole = band.members.find((m) => m.userId === userId)?.role;

    return {
      band: {
        id: band.id,
        name: band.name,
        description: band.description,
        createdAt: band.createdAt,
        updatedAt: band.updatedAt,
        inviteToken: myRole === 'OWNER' ? band.inviteToken : undefined,
        members: band.members.map((m) => ({
          id: m.user.id,
          username: m.user.username,
          email: m.user.email,
          role: m.role,
          joinedAt: m.joinedAt,
          profilePictureUrl: m.user.profilePictureUrl,
        })),
      },
      myRole,
    };
  }

  async createBand(userId: string, cmd: { name: string; description?: string }) {
    if (cmd.name.trim().length === 0) {
      throw new Error('BAD_REQUEST: Band name is required');
    }

    const createData: { name: string; ownerId: string; description?: string } = {
      name: cmd.name.trim(),
      ownerId: userId,
    };
    if (cmd.description !== undefined) createData.description = cmd.description.trim();

    const band = await BandService.createBand(createData);

    return {
      band: {
        id: band.id,
        name: band.name,
        description: band.description,
        inviteToken: band.inviteToken,
        createdAt: band.createdAt,
      },
    };
  }

  async refreshInviteToken(bandId: string, userId: string) {
    const newToken = await BandService.refreshInviteToken(bandId, userId);
    if (!newToken) throw new Error('FORBIDDEN: Only band owner can refresh invite token');
    return { inviteToken: newToken };
  }

  async removeMember(bandId: string, memberId: string, userId: string) {
    const isSuccess = await BandService.removeMember(bandId, memberId, userId);
    if (!isSuccess) {
      throw new Error('FORBIDDEN: Cannot remove member. You may not be the owner or trying to remove yourself.');
    }
    return { message: 'Member removed successfully' };
  }

  async leaveBand(bandId: string, userId: string) {
    const isSuccess = await BandService.leaveBand(bandId, userId);
    if (!isSuccess) {
      throw new Error('FORBIDDEN: Cannot leave band. You may be the owner or not a member.');
    }
    return { message: 'Left band successfully' };
  }

  async deleteBand(bandId: string, userId: string) {
    const isSuccess = await BandService.deleteBand(bandId, userId);
    if (!isSuccess) {
      throw new Error('FORBIDDEN: Only band owner can delete the band');
    }
    return { message: 'Band deleted successfully' };
  }

  async inviteByEmail(bandId: string, email: string, userId: string, inviterName: string) {
    if (email.length === 0) {
      throw new Error('BAD_REQUEST: Email is required');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const result = await BandService.inviteByEmail(bandId, email, userId);

    if (!result.success) {
      if (result.error === 'not_owner') throw new Error('FORBIDDEN: Only band owner can send invitations');
      if (result.error === 'user_not_found') throw new Error('NOT_FOUND: No user found with this email address');
      if (result.error === 'already_member') throw new Error('BAD_REQUEST: This user is already a member of this band');
    }

    const band = await BandService.getBand(bandId);
    const inviteUrl = `${frontendUrl}/join/${result.inviteToken}`;

    await emailService.sendBandInvitationEmail(
      result.user!.email,
      band?.name || 'a band',
      inviteUrl,
      inviterName
    );

    return { message: `Invitation sent to ${result.user!.email}` };
  }
}

export const bandApplicationService = new BandApplicationService();
