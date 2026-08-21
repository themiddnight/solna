import { SOCKET_ERROR_CODES, createSocketErrorPayload } from '@jam-band/shared';
import type { Socket } from 'socket.io';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';
import type { User, BandMember, UserSession } from '@/types';
import { RoomType } from '@/types';
import { MemberJoined } from '@/shared/domain/events/RoomEvents';
import { UserJoinedRoom } from '@/shared/domain/events/UserOnboardingEvents';
import { loggingService } from "@/shared/infrastructure/logging/LoggingService";
import { setSocketSession } from '@/shared/infrastructure/socket/socketSession';
import { ROOM_STATE_EVENTS, ROOM_LIFECYCLE_EVENTS, ERROR_EVENTS } from '@jam-band/shared';
import { DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS } from '@jam-band/shared';
import type { PrepareIdentitySwapData, JoinRoomEventData } from '@jam-band/shared';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { projectRoomService } from '@/domains/arrange-room/infrastructure/storage/ProjectRoomService';
import { emitJoinComplete } from './RoomJoinEmitter';
import { bindMembershipVerification, scheduleDuplicateSessionKick } from './RoomJoinSessionHelpers';
import { executeLeaveRoom } from './RoomLeaveExecutor';
import { resolveJoinIdentity, checkGhostRoom } from './RoomJoinIdentityHelpers';
import type { AuthUser } from '@/domains/auth/domain/models/User';
import { tokenService } from '@/domains/auth/domain/services/TokenService';
import { identitySwapHandoffService } from '../services/IdentitySwapHandoffService';
import { PhaseTimer } from '@/shared/infrastructure/profiling/PhaseTimer';
import { pollUntil } from '@/shared/utils/pollUntil';
import { config } from '@/config/environment';

// DEV-208: an identity-swap reconnect fires the OLD socket's disconnect immediately before the
// NEW socket joins. The disconnect registers the guest's grace-period entry (which the rekey
// below renames to the new identity); on a fast reconnect the join can beat the disconnect. Wait
// briefly for that entry so the rekey is deterministic instead of losing a race — otherwise the
// join falls through to a fresh join and the old identity lingers (visible duplicate) until the
// grace/ownership cleanup resolves it. The disconnect is already in flight, so this resolves in
// a few ms in practice; the cap only guards against a disconnect that never arrives.
const IDENTITY_SWAP_GRACE_WAIT_MS = 2000;
const IDENTITY_SWAP_GRACE_POLL_MS = 20;

/**
 * RoomConnectionHandler - Handles user connections, disconnects, and reconnect grace periods.
 * Extracted from RoomLifecycleHandler to comply with Single Responsibility Principle.
 */
export class RoomConnectionHandler {
  /* eslint-disable @typescript-eslint/member-ordering */
  constructor(private readonly handler: RoomLifecycleHandler) {}

  /**
   * Verifies a freshly-registered user's JWT and records a short-lived handoff so that when
   * their new socket connects (under the new userId), handleJoinRoomInner recognizes it as
   * continuing this guest's session rather than a brand-new join (DEV-208). Identity is derived
   * only from the verified token — never from any client-supplied userId (TR-33).
   */
  async handlePrepareIdentitySwap(socket: Socket, data: PrepareIdentitySwapData): Promise<void> {
    const session = socket.data as Partial<UserSession>;
    if (session.roomId == null || session.userId == null) {
      socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Not currently in a room'));
      return;
    }

    let payload;
    try {
      payload = tokenService.verifyToken(data.newAccessToken);
    } catch {
      socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Invalid identity-swap token'));
      return;
    }

    identitySwapHandoffService.create({
      newUserId: payload.userId,
      roomId: session.roomId,
      oldUserId: session.userId,
    });

    socket.emit(ROOM_LIFECYCLE_EVENTS.PREPARE_IDENTITY_SWAP, { acknowledged: true });
  }

  /**
   * Public entry point — wraps the join logic with hot-path profiling (DEV-178).
   * Emits a single `socket.join.handler` perf log per join when PROFILE_JOIN_PATH is on.
   */
  async handleJoinRoom(socket: Socket, data: JoinRoomEventData): Promise<void> {
    const timer = new PhaseTimer(config.profiling.joinPath);
    try {
      await this.handleJoinRoomInner(socket, data, timer);
    } finally {
      timer.flush('socket.join.handler', { roomId: data.roomId, socketId: socket.id });
    }
  }

  private async handleJoinRoomInner(socket: Socket, data: JoinRoomEventData, timer: PhaseTimer): Promise<void> {
    const { roomId, role } = data;

    // Capture guest status now: socket.data is later reassigned to a room session,
    // so reading socket.data.user further down would be unreliable. Under DEV-179 every
    // connection is authenticated, so guests carry a guest token (userType 'GUEST') rather
    // than a null user — detect by userType, mirroring RoomCreationHandler.
    const authUser = (socket.data as { user?: AuthUser }).user;
    const isGuestUser = authUser == null || (authUser.userType as string) === 'GUEST';

    // Validate input
    if (roomId.length === 0) {
      socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Missing required field: roomId'));
      return;
    }

    const identity = await resolveJoinIdentity(this.handler, socket, data);
    timer.mark('resolveIdentity');
    if (!identity) return; // error already emitted

    const { finalUserId, finalUsername } = identity;

    const roomIdTyped = this.handler.ensureRoomId(roomId);
    const userIdTyped = this.handler.ensureUserId(finalUserId);
    const roomIdString = this.handler.roomIdToString(roomIdTyped);
    const userIdString = this.handler.userIdToString(userIdTyped);

    // DEV-208: if a prepare_identity_swap handoff is pending for this connecting user, rekey
    // the guest's grace-period entry to the new identity BEFORE the isInGracePeriod check below
    // runs — this makes the existing (hardened) grace-period-restore path handle the rest with
    // zero further special-casing, since isUserInGracePeriod(finalUserId, roomId) becomes true.
    const handoff = identitySwapHandoffService.consume(userIdString, roomIdString);
    let identitySwapPreviousUserId: string | null = null;
    let identitySwapProfilePictureUrl: string | null = null;
    if (handoff) {
      // Close the disconnect-vs-join race: give the old socket's in-flight disconnect a bounded
      // window to register the guest's grace-period entry before we decide whether to rekey.
      await pollUntil(
        () => this.handler.roomLifecycleService.isUserInGracePeriod(handoff.oldUserId, roomIdString),
        { timeoutMs: IDENTITY_SWAP_GRACE_WAIT_MS, intervalMs: IDENTITY_SWAP_GRACE_POLL_MS },
      );
    }
    if (handoff && this.handler.roomLifecycleService.isUserInGracePeriod(handoff.oldUserId, roomIdString)) {
      const priorUserData = this.handler.roomLifecycleService.getGracePeriodUserData(handoff.oldUserId, roomIdString);
      if (priorUserData) {
        const upgradedUserData: User = {
          ...priorUserData,
          id: userIdString,
          username: finalUsername,
          // For a registered swap target, adopt the verified identity's userType AND profile
          // picture (server/DB-sourced) — priorUserData is the guest's data (no picture), so this
          // is what makes the swapped-in avatar appear via IDENTITY_UPGRADED + the member list.
          ...(authUser != null && (authUser.userType as string) !== 'GUEST' && {
            userType: authUser.userType,
            profilePictureUrl: authUser.profilePictureUrl ?? null,
          }),
        };
        const hasRekeyed = this.handler.roomLifecycleService.rekeyGracePeriodEntry(
          roomIdString, handoff.oldUserId, userIdString, upgradedUserData,
        );
        if (hasRekeyed) {
          identitySwapPreviousUserId = handoff.oldUserId;
          identitySwapProfilePictureUrl = upgradedUserData.profilePictureUrl ?? null;
        }
      }
    }

    // DEV-221: if the swapped-out identity owned an isolated tour room, hand the room to the new
    // registered identity and lift isolation. Runs BEFORE the isolated join guard so the new
    // socket's join is admitted. The room stays hidden — now a legit verified-hidden room.
    if (identitySwapPreviousUserId != null) {
      await this.handler.roomLifecycleService.transferOwnershipAndUnisolate(
        roomIdString, userIdString, identitySwapPreviousUserId,
      );
    }

    loggingService.logInfo('handleJoinRoom: called', { roomId: roomIdString, userId: userIdString, socketId: socket.id });

    const room = await this.handler.roomLifecycleService.getRoom(roomIdString);
    timer.mark('getRoom');
    if (!room) {
      loggingService.logInfo('handleJoinRoom: ROOM NOT FOUND', { roomId: roomIdString, userId: userIdString });
      socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    // Check if user is already connected with a different socket
    // This prevents duplicate connections and role conflicts
    const existingUser = await this.handler.roomMembershipService.findUserInRoom(roomIdString, userIdString);
    timer.mark('findUser');

    // If existing user is switching roles (e.g., legacy URL role change during page switch),
    // gracefully remove them from the old role so they can join with the new role.
    const requestedRole = data.role;
    const isCurrentOwner = room.owner === userIdString || (existingUser && existingUser.role === 'room_owner');

    if (existingUser && !isCurrentOwner && requestedRole !== existingUser.role) {
      loggingService.logInfo('handleJoinRoom: Role change detected for existing user', {
        roomId: roomIdString,
        userId: userIdString,
        oldRole: existingUser.role,
        newRole: requestedRole,
      });
      // DEV-139: Change role in-place to avoid the 0-user window between
      // remove and re-add that could trigger aggressive room cleanup.
      const hasRoleChanged = await this.handler.roomMembershipService.changeUserRole(roomIdString, userIdString, requestedRole);
      if (!hasRoleChanged) {
        loggingService.logError(new Error('changeUserRole failed'), {
          context: 'RoomConnectionHandler.handleJoinRoom.roleChange',
          roomId: roomIdString,
          userId: userIdString,
          requestedRole,
        });
        await this.handler.roomSessionManager.removeSession(socket.id);
        socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Failed to change role. Please try rejoining.'));
        return;
      }
      existingUser.role = requestedRole;
    }

    const isInGracePeriod = this.handler.roomLifecycleService.isUserInGracePeriod(userIdString, roomIdString);
    const hasIntentionallyLeft = await this.handler.roomLifecycleService.hasUserIntentionallyLeft(userIdString, roomIdString);

    loggingService.logInfo('handleJoinRoom state check', {
      roomId: roomIdString,
      userId: userIdString,
      username: finalUsername,
      existingUser: !!existingUser,
      isInGracePeriod,
      hasIntentionallyLeft,
      bandMemberCount: room.bandMembers.size,
    });

    // Ghost room validation — skip for existing/grace-period users and new rooms
    if (!existingUser) {
      const isGhost = await checkGhostRoom(this.handler, socket, roomIdString, room, userIdString, isInGracePeriod);
      timer.mark('ghostCheck');
      if (isGhost) return;
    }

    // DEV-221: an isolated onboarding-tour room admits only its owner. Existing users and
    // grace-period rejoins (including the DEV-208 registered swap, which arrives in grace period
    // after ownership has been transferred at ~L145-151) are exempt.
    if (room.isIsolated && !existingUser && !isInGracePeriod && userIdString !== room.owner) {
      socket.emit(
        ERROR_EVENTS.JOIN_ERROR,
        createSocketErrorPayload('This room is a private tour session and cannot be joined.', {
          code: SOCKET_ERROR_CODES.ROOM_ISOLATED,
        }),
      );
      return;
    }

    let user: User;

    if (existingUser) {
      loggingService.logInfo('handleJoinRoom: taking existingUser path', { roomId: roomIdString, userId: userIdString, role: existingUser.role });
      // User already exists in room, use their existing data (e.g., page refresh)
      user = existingUser;
      // Remove from grace period if they were there
      await this.handler.roomLifecycleService.removeFromGracePeriod(userIdString, roomIdString);
    } else if (isInGracePeriod) {
      loggingService.logInfo('handleJoinRoom: taking isInGracePeriod path', { roomId: roomIdString, userId: userIdString });
      // User is in grace period, restore them to the room
      // Requirements: 6.7 - State restoration (user role, instrument, settings) after reconnection
      const gracePeriodUserData = this.handler.roomLifecycleService.getGracePeriodUserData(userIdString, roomIdString);
      if (gracePeriodUserData) {
        // ISSUE-49 (BR-3): For private rooms, validate that the user's approval is still valid
        // before restoring from grace period. If the user was kicked (revoked) while in grace period,
        // they should not be allowed to bypass the approval check on reconnect.
        const previousRole = gracePeriodUserData.role;
        const isRoomOwnerRejoining = previousRole === 'room_owner' || room.owner === userIdString;

        if (room.isPrivate && !isRoomOwnerRejoining) {
          const isStillMember = room.bandMembers.has(userIdString) || room.audiences.has(userIdString);
          if (!isStillMember) {
            // User was removed from room during grace period (e.g., via HTTP kick or other path)
            // Clear grace period and redirect to approval to enforce BR-3
            await this.handler.roomLifecycleService.removeFromGracePeriod(userIdString, roomIdString);
            loggingService.logInfo('[BR-3] Grace period user was removed from private room, redirecting to approval', {
              roomId: roomIdString,
              userId: userIdString,
              previousRole,
            });
            await this.handler.roomSessionManager.removeSession(socket.id);
            socket.emit(ROOM_LIFECYCLE_EVENTS.REDIRECT_TO_APPROVAL, {
              roomId: roomIdTyped.toString(),
              message: 'Private room requires approval. Please connect to approval namespace.',
              approvalNamespace: `/approval/${roomIdTyped.toString()}`,
            });
            return;
          }
        }

        // Check if the user is trying to join with a different role than they had before
        const requestedRole: 'room_owner' | 'band_member' | 'audience' = data.role;

        // Preserve room owner role if user had it before (they can't request it via join)
        const shouldPreserveOwnerRole = previousRole === 'room_owner';

        if (shouldPreserveOwnerRole) {
          user = {
            ...gracePeriodUserData,
            username: finalUsername,
          };
        } else if (requestedRole !== previousRole) {
          // `profilePictureUrl`/`userType` are not part of the validated JOIN_ROOM payload
          // (joinRoomSchema does not declare them) — they were always `undefined` here even
          // before convergence onto the shared DTO. The real values come from the verified
          // socket identity elsewhere (TR-33; identity-swap branch above, and the
          // `user.profilePictureUrl` overwrite after user creation below).
          user = this.handler.createUserByRole(userIdString, finalUsername, requestedRole, undefined, undefined, data.currentInstrument, data.currentCategory);
        } else {
          // Same role - restore user with their original data (instruments, settings, etc.)
          user = {
            ...gracePeriodUserData,
            username: finalUsername, // Update username in case it changed
          };
        }
        await this.handler.roomLifecycleService.removeFromGracePeriod(userIdString, roomIdString);
      } else {
        // Grace period hasExpired, create new user
        const userRole = data.role;
        user = this.handler.createUserByRole(userIdString, finalUsername, userRole, undefined, undefined, data.currentInstrument, data.currentCategory);
      }
    } else if (hasIntentionallyLeft) {
      // User has intentionally left this room - they need approval to rejoin
      // Remove them from the intentional leave list since they're trying to rejoin
      this.handler.roomLifecycleService.removeFromIntentionallyLeft(userIdString);

      // Create new user that will need approval
      const userRole = data.role;
      user = this.handler.createUserByRole(userIdString, finalUsername, userRole, undefined, undefined, data.currentInstrument, data.currentCategory);
    } else {
      // Create new user
      const userRole = data.role;
      user = this.handler.createUserByRole(userIdString, finalUsername, userRole, undefined, undefined, data.currentInstrument, data.currentCategory);
    }

    // Safety check: ensure room owner always gets room_owner role if they rejoin
    // This handles cases where grace period expired or user refreshed and default role was 'audience'
    if (room.owner === userIdString && user.role !== 'room_owner') {
      // Recreate user as band member with room_owner role
      user = this.handler.createUserByRole(userIdString, finalUsername, 'room_owner', user.profilePictureUrl, user.userType);
      if ('isReady' in user) {
        user.isReady = true;
      }
    }

    // TR-33: the profile picture is identity-derived data — source it from the verified socket
    // identity (DB-backed via socket auth), never the client join payload. This is the single
    // authoritative point regardless of which branch built `user` (new join, grace restore, or
    // guest→registered identity swap), and it feeds both Perform and Arrange member lists via
    // emitJoinComplete. Guests have no picture.
    user.profilePictureUrl = isGuestUser ? null : (authUser.profilePictureUrl ?? null);

    // Remove old sessions for this user in this room globally (cross-node safe)
    // Find the old session BEFORE setting the new session to prevent overwriting
    const oldSocketId = await this.handler.roomSessionManager.findSocketByUserIdAsync(roomIdString, userIdString);

    if (oldSocketId && oldSocketId !== socket.id) {
      scheduleDuplicateSessionKick({
        handler: this.handler,
        roomId: roomIdString,
        userId: userIdString,
        oldSocketId,
        newSocketId: socket.id,
      });
    }

    // Set up session
    const session: UserSession = { roomId: roomIdString, userId: userIdString };
    setSocketSession(socket, session);
    await this.handler.roomSessionManager.setRoomSession(roomIdString, socket.id, session);

    // Remove any additional stale sessions for this user in this room just in case
    await this.handler.roomSessionManager.removeOldSessionsForUser(userIdString, socket.id, roomIdString);

    // Handle membership verification requests (register for all join paths)
    bindMembershipVerification(socket, this.handler);

    if (existingUser) {
      // User already exists in room, join them directly (e.g., page refresh)
      // Ensure effect chains only for band members
      if (user.role !== 'audience') {
        this.handler.roomMembershipService.ensureUserEffectChains(user as BandMember);
      }

      // Update session in Redis BEFORE socket.join() to prevent split-brain (ISSUE-60)
      const rejoinSession: UserSession = {
        roomId: roomIdString,
        userId: userIdString,
        username: finalUsername,
        role: user.role
      };
      setSocketSession(socket, rejoinSession);
      await this.handler.roomSessionManager.setRoomSession(roomIdString, socket.id, rejoinSession);

      // socket.join() is now handled inside emitJoinComplete
      await emitJoinComplete(this.handler, { socket, roomIdString, userIdString, user, timer });
      return;
    } else if (isInGracePeriod) {
      // User is in grace period (isDisconnected, not intentionally left)

      // Only cancel the owner grace period timer if the reconnecting user IS
      // the room owner — non-owner rejoins must not cancel the owner's timer
      // (which was set in RoomOwnershipHandler.handleRoomOwnerLeaving).
      if (user.role === 'room_owner') {
        const existingTimer = this.handler.ownerGracePeriodTimers.get(roomIdString);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.handler.ownerGracePeriodTimers.delete(roomIdString);
        }
      }

      // Cancel this specific user's member grace period timer.
      this.handler.clearMemberGracePeriodTimer(roomIdString, userIdString);

      const lockKey = `room-promotion-lock:${roomIdString}`;
      try {
        await redisStateService.executeWithLock(lockKey, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
          // get fresh room inside lock to avoid stale state
          const freshRoom = await this.handler.roomLifecycleService.getRoom(roomIdString);
          if (!freshRoom) return;

          // Ensure effect chains only for band members
          if (user.role !== 'audience') {
            this.handler.roomMembershipService.ensureUserEffectChains(user as BandMember);
          }

          // If replacing owner, check if the room got a new owner during our absence
          if (user.role === 'room_owner') {
            const hasNewOwner = Array.from(freshRoom.bandMembers.values()).some(m => m.role === 'room_owner');
            if (hasNewOwner) {
              loggingService.logInfo('Grace period restore: Room already has a new owner, demoting returning user to band_member', { roomId: roomIdString, userId: userIdString });
              user.role = 'band_member';
            }
          }

          const hasGraceAddSuccess = await this.handler.roomMembershipService.addUserToRoom(roomIdString, user);
          if (!hasGraceAddSuccess) {
            throw new Error('addUserToRoom failed during grace period restore');
          }
          await this.handler.roomLifecycleService.removeFromGracePeriod(userIdString, roomIdString);

          // Update session in Redis BEFORE socket.join() to prevent split-brain (ISSUE-60)
          const graceSession: UserSession = {
            roomId: roomIdString,
            userId: userIdString,
            username: finalUsername,
            role: user.role
          };
          setSocketSession(socket, graceSession);
          await this.handler.roomSessionManager.setRoomSession(roomIdString, socket.id, graceSession);

          // socket.join() is now handled inside emitJoinComplete
          await emitJoinComplete(this.handler, {
            socket, roomIdString, userIdString, user, room: freshRoom, timer,
            ...(identitySwapPreviousUserId !== null && {
              extraBroadcasts: async (roomNamespace) => {
                roomNamespace.emit(ROOM_STATE_EVENTS.IDENTITY_UPGRADED, {
                  previousUserId: identitySwapPreviousUserId,
                  userId: userIdString,
                  username: finalUsername,
                  userType: authUser?.userType ?? 'REGISTERED',
                  profilePictureUrl: identitySwapProfilePictureUrl,
                });
              },
            }),
          });
        });

      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'RoomLifecycleHandler.handleJoinRoom.gracePeriodRestore.executeWithLock',
          roomId: roomIdString,
          userId: userIdString
        });
        // DEV-142: Clean up session on failure to prevent orphaned Redis session
        await this.handler.roomSessionManager.removeSession(socket.id);
        socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Failed to restore session. Please try rejoining.'));
      }
      return;
    }

    // Check if user is the room owner or already a member (owners and approved members bypass approval)
    const isRoomOwner = room.owner === userIdString ||
      Array.from(room.bandMembers.values()).some(m => m.id === userIdString && m.role === 'room_owner');

    // BR-2: Check if user is project owner (for arrange rooms only)
    const isProjectOwner = room.roomType === RoomType.ARRANGE 
      ? await this.handler.checkIsProjectOwner(roomIdString, userIdString)
      : false;

    if (role === 'band_member' && room.isPrivate && !isRoomOwner && !isProjectOwner) {
      // Guests cannot join private rooms (mirrors the frontend useJoinRoom rule). The invite
      // flow navigates straight to the room and bypasses that frontend check, so enforce it
      // here at the backend boundary, before the approval flow.
      if (isGuestUser) {
        await this.handler.roomSessionManager.removeSession(socket.id);
        socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload(
          'Guest users cannot join private rooms. Please sign up to access this feature.',
          { code: SOCKET_ERROR_CODES.PRIVATE_ROOM_REQUIRED },
        ));
        return;
      }

      // Requesting to join as band member in a private room - redirect to approval namespace
      await this.handler.roomSessionManager.removeSession(socket.id);
      socket.emit(ROOM_LIFECYCLE_EVENTS.REDIRECT_TO_APPROVAL, {
        roomId: roomIdTyped.toString(),
        message: 'Private room requires approval. Please connect to approval namespace.',
        approvalNamespace: `/approval/${roomIdTyped.toString()}`
      });
    } else if (isProjectOwner && !isRoomOwner) {
      // BR-2: Project owner auto-joins as room_owner, demote current owner
      
      const lockKey = `room-promotion-lock:${roomIdString}`;
      try {
        await redisStateService.executeWithLock(lockKey, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
          // Fetch fresh room state inside lock
          const freshRoom = await this.handler.roomLifecycleService.getRoom(roomIdString);
        if (!freshRoom) return;

        // 1. Create user as room_owner
        user = this.handler.createUserByRole(userIdString, finalUsername, 'room_owner', undefined, undefined);
        if ('isReady' in user) {
          user.isReady = true;
        }
        
        // 2. Ensure effect chains
        this.handler.roomMembershipService.ensureUserEffectChains(user as BandMember);
        
        // 3. Add to room
        const hasOwnerAddSuccess = await this.handler.roomMembershipService.addUserToRoom(roomIdString, user);
        if (!hasOwnerAddSuccess) {
          throw new Error('addUserToRoom failed during project owner auto-join');
        }

        // 4. Transfer ownership (demote old owner)
        const currentOwner = Array.from(freshRoom.bandMembers.values()).find(m => m.role === 'room_owner');
        if (currentOwner) {
          await this.handler.roomMembershipService.transferOwnership(roomIdString, userIdString, currentOwner);
          // DEV-143 (L-4): Release the demoted owner's arrange locks so the new
          // owner isn't blocked by stale locks (TTL 5 min otherwise).
          await this.handler.releaseArrangeLocksForUser(roomIdString, currentOwner.id);
        }

        // 5. Publish events
        if (this.handler.eventBus) {
          const memberJoinedEvent = new MemberJoined(roomIdString, userIdString, user.username, user.role);
          await this.handler.eventBus.publish(memberJoinedEvent);
          
          const userJoinedRoomEvent = new UserJoinedRoom(roomIdString, userIdString, user.username, user.role);
          await this.handler.eventBus.publish(userJoinedRoomEvent);
        }
        
        // 6. Update project user count
        const project = await projectRoomService.getProjectByActiveRoom(roomIdString);
        if (project) {
          await projectRoomService.incrementUserCount(project.id);
        }
        
        // 7. Update session in Redis BEFORE socket.join() to prevent split-brain (ISSUE-60)
        const ownerSession: UserSession = {
          roomId: roomIdString,
          userId: userIdString,
          username: finalUsername,
          role: user.role
        };
        setSocketSession(socket, ownerSession);
        await this.handler.roomSessionManager.setRoomSession(roomIdString, socket.id, ownerSession);
        
        // 8. Broadcast to room (socket.join is handled inside emitJoinComplete)
        // NOTE: Do NOT pass room: freshRoom here — freshRoom was fetched before
        // transferOwnership (step 4). Passing it would cause emitJoinComplete to
        // build the ROOM_STATE_UPDATED payload from stale room state (old owner),
        // overwriting the correct owner set by OWNERSHIP_TRANSFERRED.
        // Let emitJoinComplete re-fetch to get the post-transfer state.
        await emitJoinComplete(this.handler, {
          socket,
          roomIdString,
          userIdString,
          user,
          timer,
          extraBroadcasts: async (_roomNamespace, _room, preBuiltPayload) => {
            if (currentOwner) {
              _roomNamespace.emit(ROOM_STATE_EVENTS.OWNERSHIP_TRANSFERRED, {
                newOwner: user,
                oldOwner: currentOwner,
              });
            }
            _roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, preBuiltPayload);
          },
        });
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'RoomLifecycleHandler.handleJoinRoom.projectOwnerAutoPromote.executeWithLock',
          roomId: roomIdString,
          userId: userIdString
        });
        // DEV-142: Clean up session on failure to prevent orphaned Redis session
        await this.handler.roomSessionManager.removeSession(socket.id);
        socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Failed to join as project owner. Please try again.'));
      }
      
      return;
    } else {
      // New audience member or band member in public room - join directly
      // Ensure effect chains only for band members
      if (user.role !== 'audience') {
        this.handler.roomMembershipService.ensureUserEffectChains(user as BandMember);
      }
      const hasAddSuccess = await this.handler.roomMembershipService.addUserToRoom(roomIdString, user);
      loggingService.logInfo('handleJoinRoom: addUserToRoom result', { roomId: roomIdString, userId: userIdString, role: user.role, success: hasAddSuccess });
      if (!hasAddSuccess) {
        await this.handler.roomSessionManager.removeSession(socket.id);
        socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Failed to join room. Please try again.'));
        return;
      }
      // Publish domain events for user joining
      if (this.handler.eventBus) {
        const memberJoinedEvent = new MemberJoined(
          roomIdString,
          userIdString,
          user.username,
          user.role
        );
        await this.handler.eventBus.publish(memberJoinedEvent);

        // Also publish UserJoinedRoom event to start onboarding coordination
        const userJoinedRoomEvent = new UserJoinedRoom(
          roomIdString,
          userIdString,
          user.username,
          user.role
        );
        await this.handler.eventBus.publish(userJoinedRoomEvent);
      }

      const project = await projectRoomService.getProjectByActiveRoom(roomIdString);
      if (project) {
          await projectRoomService.incrementUserCount(project.id);
      }

      // Update session in Redis BEFORE socket.join() to prevent split-brain (ISSUE-60)
      const newUserSession: UserSession = {
        roomId: roomIdString,
        userId: userIdString,
        username: finalUsername,
        role: user.role
      };
      setSocketSession(socket, newUserSession);
      await this.handler.roomSessionManager.setRoomSession(roomIdString, socket.id, newUserSession);

      // socket.join() is now handled inside emitJoinComplete
      await emitJoinComplete(this.handler, { socket, roomIdString, userIdString, user, room, timer });
    }
  }

  /**
   * Handle user leaving room - coordinates cleanup and state updates
   * Requirements: 6.5, 6.6, 6.7 - Grace period management, session cleanup, state restoration
   */
  async handleLeaveRoom(socket: Socket, isIntendedLeave: boolean = false): Promise<void> {
    return executeLeaveRoom(socket, isIntendedLeave, this.handler);
  }
}
