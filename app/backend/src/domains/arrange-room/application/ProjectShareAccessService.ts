import { prisma } from '../../../config/prisma';
import type { ProjectShareAccessResponse } from '@jam-band/shared';
import { isRestrictedUserTier } from '@jam-band/shared';
import { ProjectVisibility } from '@prisma/client';
import { BandService } from '../../user-management/application/services/BandService';

/** Verified-token identity of a share-link visitor. All fields null/false for anonymous visitors. */
export interface ShareAccessActor {
  userId: string | null;
  userType: string | null;
  isEmailVerified: boolean;
}

export class ProjectShareAccessService {
  /**
   * Resolve what a share-link visitor may do with a project. Returns a decision only — never leaks
   * project name on denied/not_found. Opening projects requires a verified registered account
   * (BR-20, same restricted-tier rule as the Community page): anonymous and guest visitors get
   * `auth_required` (the login page must not offer the guest option). Since the OTP hard gate,
   * `optionalAuthAllowGuest` degrades an unverified registered token to anonymous before this
   * method ever sees it, so `verification_required` is unreachable in practice — the
   * `isRestrictedUserTier` check below is not live defense-in-depth (see its own comment); it is
   * kept only because `verification_required` is still part of the response contract. Only
   * verified users reach the BR-6 `hasReadAccess` gate.
   */
  async resolveShareAccess(
    actor: ShareAccessActor,
    projectId: string
  ): Promise<ProjectShareAccessResponse> {
    const project = await prisma.savedProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        userId: true,
        visibility: true,
        roomType: true,
        bands: { select: { id: true } },
      },
    });

    if (!project) {
      return { decision: 'not_found' };
    }

    // Guests can never open projects (BR-20) — treat them like anonymous visitors so they are sent
    // to login/signup as their real identity. Checked before any project data is considered so the
    // response is identical for every existing project (anonymous callers can still distinguish
    // not_found — running that check first is deliberate UX, not a leak of access levels).
    if (!actor.userId || actor.userType === 'GUEST') {
      return { decision: 'auth_required' };
    }

    // Unreachable by construction, not live defense-in-depth: `isRestrictedUserTier` is now true
    // only for GUEST, and the check above already returns `auth_required` for exactly that actor.
    // Retained anyway because the `verification_required` decision is still part of the response
    // contract — a later frontend task (removing the client's handling of it) retires this branch.
    if (isRestrictedUserTier({ userType: actor.userType ?? '' })) {
      return { decision: 'verification_required' };
    }

    const canRead = await this.hasReadAccess(actor.userId, project);
    if (canRead) {
      return { decision: 'open', projectName: project.name, roomType: project.roomType === 'arrange' ? 'arrange' : 'perform' };
    }
    return { decision: 'denied' };
  }

  /**
   * Canonical BR-6 read-access rule: owner, PUBLIC, or BAND + membership in any linked band.
   * This is the single source of truth for project read access — ProjectApplicationService.hasReadAccess
   * delegates here; do not re-implement this logic elsewhere.
   */
  async hasReadAccess(
    userId: string,
    project: { userId: string; visibility: ProjectVisibility; bands: Array<{ id: string }> }
  ): Promise<boolean> {
    if (project.userId === userId) return true;
    if (project.visibility === ProjectVisibility.PUBLIC) return true;
    if (project.visibility === ProjectVisibility.BAND && project.bands.length > 0) {
      const membershipChecks = await Promise.all(
        project.bands.map((band) => BandService.isMember(band.id, userId))
      );
      return membershipChecks.some((isMember) => isMember);
    }
    return false;
  }
}

export const projectShareAccessService = new ProjectShareAccessService();
