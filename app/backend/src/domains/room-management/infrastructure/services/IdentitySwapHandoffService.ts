/**
 * Short-lived, single-use handoff record bridging a guest's grace-period session to their
 * newly-registered identity during a socket reconnect (DEV-208). Deliberately in-memory-only,
 * matching the existing NamespaceGracePeriodManager convention (not Redis-backed) — this
 * repo's grace-period mechanism already assumes sticky sessions in a clustered deployment;
 * this follows the same assumption rather than introducing a new one.
 */
interface HandoffRecord {
  roomId: string;
  oldUserId: string;
  expiresAt: number;
}

const HANDOFF_TTL_MS = 60_000;

export class IdentitySwapHandoffService {
  private readonly records = new Map<string, HandoffRecord>();

  create(params: { newUserId: string; roomId: string; oldUserId: string }): void {
    this.records.set(params.newUserId, {
      roomId: params.roomId,
      oldUserId: params.oldUserId,
      expiresAt: Date.now() + HANDOFF_TTL_MS,
    });
  }

  consume(newUserId: string, roomId: string): { oldUserId: string } | null {
    const record = this.records.get(newUserId);
    if (!record) return null;

    // Single-use regardless of outcome below — a stale/mismatched record should not linger.
    this.records.delete(newUserId);

    if (record.roomId !== roomId) return null;
    if (Date.now() > record.expiresAt) return null;

    return { oldUserId: record.oldUserId };
  }
}

export const identitySwapHandoffService = new IdentitySwapHandoffService();
