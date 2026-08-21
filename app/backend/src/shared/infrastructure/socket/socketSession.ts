import type { Socket } from 'socket.io';
import type { UserSession } from '@/types';
import type { SocketAuthUser } from '@/config/socket';

/**
 * Assign a room {@link UserSession} onto `socket.data` WITHOUT dropping the authenticated
 * identity (`socket.data.user`) that the connection middleware attached from the verified token
 * (see `authenticateSocket` / `createDynamicNamespaceMiddleware` in `@/config/socket`).
 *
 * A bare `socket.data = session` clobbers `.user`, which forces every downstream room handler's
 * restriction check (companion cap, track cap — they read `socket.data.user`) to treat an
 * authenticated user as an unauthenticated guest: verified users get capped at the restricted
 * limit and receive REGISTER_REQUIRED. Route every room-session assignment through this helper so
 * the token-verified identity survives.
 */
export function setSocketSession(socket: Socket, session: UserSession): void {
  const user = (socket.data as { user?: SocketAuthUser } | undefined)?.user;
  socket.data = user == null ? { ...session } : { ...session, user };
}
