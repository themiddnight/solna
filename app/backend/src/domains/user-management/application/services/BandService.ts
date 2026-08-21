/* eslint-disable @typescript-eslint/naming-convention */

import type { Band, BandMember, User } from '@prisma/client';
import { BandRole } from '@prisma/client';
import { prisma } from '../../../../config/prisma';
import crypto from 'crypto';

export interface BandWithMembers extends Band {
  members: (BandMember & { user: Pick<User, 'id' | 'username' | 'email' | 'profilePictureUrl'> })[];
}

export interface CreateBandInput {
  name: string;
  description?: string;
  ownerId: string;
}

export interface BandMemberInfo {
  id: string;
  username: string | null;
  email: string | null;
  role: BandRole;
  joinedAt: Date;
  profilePictureUrl: string | null;
}

export class BandService {
  /**
   * Create a new band with the creator as OWNER
   */
  static async createBand(input: CreateBandInput): Promise<Band> {
    const { name, description, ownerId } = input;

    // Generate a unique invite token
    const inviteToken = crypto.randomUUID();

    const band = await prisma.band.create({
      data: {
        name,
        description: description ?? null,
        inviteToken,
        members: {
          create: {
            userId: ownerId,
            role: BandRole.OWNER,
          },
        },
      },
    });

    return band;
  }

  /**
   * Get band by ID with members
   */
  static async getBand(bandId: string): Promise<BandWithMembers | null> {
    return prisma.band.findUnique({
      where: { id: bandId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, username: true, email: true, profilePictureUrl: true },
            },
          },
        },
      },
    });
  }

  /**
   * Get band by invite token
   */
  static async getBandByInviteToken(token: string): Promise<Band | null> {
    return prisma.band.findUnique({
      where: { inviteToken: token },
    });
  }

  /**
   * Join a band using invite token
   */
  static async joinBandByToken(token: string, userId: string): Promise<BandMember | null> {
    const band = await this.getBandByInviteToken(token);
    if (!band) {
      return null;
    }

    // Check if already a member
    const existingMember = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId: band.id,
          userId,
        },
      },
    });

    if (existingMember) {
      return existingMember;
    }

    // Add as member
    return prisma.bandMember.create({
      data: {
        bandId: band.id,
        userId,
        role: BandRole.MEMBER,
      },
    });
  }

  /**
   * Get all bands for a user
   */
  static async getUserBands(userId: string): Promise<BandWithMembers[]> {
    const memberships = await prisma.bandMember.findMany({
      where: { userId },
      include: {
        band: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, username: true, email: true, profilePictureUrl: true },
                },
              },
            },
          },
        },
      },
    });

    return memberships.map((m) => m.band);
  }

  /**
   * Get band members with their info
   */
  static async getBandMembers(bandId: string): Promise<BandMemberInfo[]> {
    const members = await prisma.bandMember.findMany({
      where: { bandId },
      include: {
        user: {
          select: { id: true, username: true, email: true, profilePictureUrl: true },
        },
      },
    });

    return members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt,
      profilePictureUrl: m.user.profilePictureUrl,
    }));
  }

  /**
   * Remove a member from a band (only by owner)
   */
  static async removeMember(bandId: string, targetUserId: string, requesterId: string): Promise<boolean> {
    // Check requester is owner
    const requesterMembership = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId: requesterId,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role !== BandRole.OWNER) {
      return false;
    }

    // Cannot remove yourself as owner
    if (targetUserId === requesterId) {
      return false;
    }

    await prisma.bandMember.delete({
      where: {
        bandId_userId: {
          bandId,
          userId: targetUserId,
        },
      },
    });

    return true;
  }

  /**
   * Leave a band (member can leave, owner cannot leave their own band)
   */
  static async leaveBand(bandId: string, userId: string): Promise<boolean> {
    const membership = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId,
        },
      },
    });

    if (!membership) {
      return false;
    }

    // Owner cannot leave their own band
    if (membership.role === BandRole.OWNER) {
      return false;
    }

    // Smart cleanup: Remove band from projects owned by this user
    // Only reset to PRIVATE if no other bands remain
    const ownerProjects = await prisma.savedProject.findMany({
      where: {
        userId: userId,
        visibility: 'BAND',
        bands: { some: { id: bandId } }
      },
      include: { bands: true }
    });

    // Batch projects into two groups: those to reset to PRIVATE vs those to just disconnect
    const projectsToResetPrivate = ownerProjects
      .filter(p => p.bands.filter(b => b.id !== bandId).length === 0)
      .map(p => p.id);
    
    const projectsToDisconnect = ownerProjects
      .filter(p => p.bands.filter(b => b.id !== bandId).length > 0)
      .map(p => p.id);

    // Execute all updates in a single transaction
    await prisma.$transaction([
      // Reset projects with no remaining bands to PRIVATE
      ...(projectsToResetPrivate.length > 0 ? [
        prisma.savedProject.updateMany({
          where: { id: { in: projectsToResetPrivate } },
          data: { visibility: 'PRIVATE' }
        }),
        // Clear all band connections for these projects
        ...projectsToResetPrivate.map(projectId =>
          prisma.savedProject.update({
            where: { id: projectId },
            data: { bands: { set: [] } }
          })
        )
      ] : []),
      // Just disconnect this band from projects with other bands
      ...projectsToDisconnect.map(projectId =>
        prisma.savedProject.update({
          where: { id: projectId },
          data: { bands: { disconnect: { id: bandId } } }
        })
      ),
      // Delete the band membership
      prisma.bandMember.delete({
        where: {
          bandId_userId: {
            bandId,
            userId,
          },
        },
      })
    ]);

    return true;
  }

  /**
   * Regenerate invite token (only by owner)
   */
  static async refreshInviteToken(bandId: string, requesterId: string): Promise<string | null> {
    const requesterMembership = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId: requesterId,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role !== BandRole.OWNER) {
      return null;
    }

    const newToken = crypto.randomUUID();

    await prisma.band.update({
      where: { id: bandId },
      data: { inviteToken: newToken },
    });

    return newToken;
  }

  /**
   * Check if user is a member of a band
   */
  static async isMember(bandId: string, userId: string): Promise<boolean> {
    const membership = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId,
        },
      },
    });

    return !!membership;
  }

  /**
   * Delete a band (only by owner)
   */
  static async deleteBand(bandId: string, requesterId: string): Promise<boolean> {
    const requesterMembership = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId: requesterId,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role !== BandRole.OWNER) {
      return false;
    }

    // Smart cleanup: Remove band from all projects
    // Only reset to PRIVATE if no other bands remain
    const bandProjects = await prisma.savedProject.findMany({
      where: {
        visibility: 'BAND',
        bands: { some: { id: bandId } }
      },
      include: { bands: true }
    });

    // Batch projects into two groups: those to reset to PRIVATE vs those to just disconnect
    const projectsToResetPrivate = bandProjects
      .filter(p => p.bands.filter(b => b.id !== bandId).length === 0)
      .map(p => p.id);
    
    const projectsToDisconnect = bandProjects
      .filter(p => p.bands.filter(b => b.id !== bandId).length > 0)
      .map(p => p.id);

    // Execute all updates in a single transaction
    await prisma.$transaction([
      // Reset projects with no remaining bands to PRIVATE
      ...(projectsToResetPrivate.length > 0 ? [
        prisma.savedProject.updateMany({
          where: { id: { in: projectsToResetPrivate } },
          data: { visibility: 'PRIVATE' }
        }),
        // Clear all band connections for these projects
        ...projectsToResetPrivate.map(projectId =>
          prisma.savedProject.update({
            where: { id: projectId },
            data: { bands: { set: [] } }
          })
        )
      ] : []),
      // Just disconnect this band from projects with other bands
      ...projectsToDisconnect.map(projectId =>
        prisma.savedProject.update({
          where: { id: projectId },
          data: { bands: { disconnect: { id: bandId } } }
        })
      ),
      // Delete the band
      prisma.band.delete({
        where: { id: bandId },
      })
    ]);

    return true;
  }

  /**
   * Invite a user to band by email (only by owner)
   * Returns user info if email exists in system, null otherwise
   */
  static async inviteByEmail(
    bandId: string,
    email: string,
    requesterId: string
  ): Promise<{
    success: boolean;
    error?: 'not_owner' | 'user_not_found' | 'already_member';
    user?: { id: string; username: string | null; email: string };
    inviteToken?: string | undefined;
  }> {
    // Check requester is owner
    const requesterMembership = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId: requesterId,
        },
      },
    });

    if (!requesterMembership || requesterMembership.role !== BandRole.OWNER) {
      return { success: false, error: 'not_owner' };
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, username: true, email: true },
    });

    if (!user || !user.email) {
      return { success: false, error: 'user_not_found' };
    }

    // Check if user is already a member
    const existingMember = await prisma.bandMember.findUnique({
      where: {
        bandId_userId: {
          bandId,
          userId: user.id,
        },
      },
    });

    if (existingMember) {
      return { success: false, error: 'already_member' };
    }

    // Get band invite token
    const band = await prisma.band.findUnique({
      where: { id: bandId },
      select: { inviteToken: true },
    });

    return {
      success: true,
      user: { id: user.id, username: user.username, email: user.email },
      inviteToken: band?.inviteToken ?? undefined,
    };
  }

  /**
   * Get all projects shared with a band (visibility = BAND)
   */
  static async getBandProjects(bandId: string) {
    const projects = await prisma.savedProject.findMany({
      where: {
        visibility: { in: ['BAND', 'PUBLIC'] },
        bands: { some: { id: bandId } }
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        roomType: true,
        metadata: true,
        visibility: true,
        isLocked: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            profilePictureUrl: true,
          },
        },
        contributors: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profilePictureUrl: true,
              },
            },
          },
          orderBy: { lastContributedAt: 'desc' },
          take: 5,
        },
      },
    });

    return projects.map((p) => ({
      ...p,
      owner: p.user,
      contributors: p.contributors.map((c) => ({
        id: c.user.id,
        username: c.user.username,
        profilePictureUrl: c.user.profilePictureUrl,
        lastContributedAt: c.lastContributedAt,
      })),
    }));
  }

  /**
   * Update band details (name, description) - only owner can update
   */
  static async updateBand(
    bandId: string,
    userId: string,
    data: { name?: string; description?: string }
  ): Promise<Band> {
    // Check if user is the owner of this band
    const membership = await prisma.bandMember.findFirst({
      where: {
        bandId,
        userId,
        role: BandRole.OWNER,
      },
    });

    if (!membership) {
      throw new Error('Only the band owner can update band details');
    }

    // Update the band
    const updatedBand = await prisma.band.update({
      where: { id: bandId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });

    return updatedBand;
  }
}

