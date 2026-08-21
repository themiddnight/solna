/**
 * NamespaceGracePeriodManager — top-up coverage (BE-slices plan Task 16).
 *
 * The DEV-208 rekey path is already covered by `NamespaceGracePeriodManager.rekey.test.ts`
 * (entry move + userData replacement, audience variant, missing-user and missing-room
 * false cases) — per plan ruling, rekey is NOT duplicated here.
 *
 * Covered here: role-based grace durations (owner 10s vs member/audience 30s), per-room
 * isolation, lazy expiry on read, `cleanupExpiredGracePeriods` + EventBus publish, and
 * the NODE_ENV=test constructor guard (no interval in test env).
 */
import { NamespaceGracePeriodManager } from "../NamespaceGracePeriodManager";
import { GRACE_PERIOD_OWNER_MS, GRACE_PERIOD_MEMBER_MS } from "@jam-band/shared";
import { GracePeriodsExpired } from "@/domains/room-management/domain/events/GracePeriodsExpired";
import type { EventBus, DomainEvent } from "@/shared/domain/events/EventBus";
import type { BandMember, Audience } from "@/types";
import { createPartialMock } from "@/testing/mocks";

const ownerMember: BandMember = {
  id: "user-owner",
  username: "Owner",
  role: "room_owner",
  isReady: false,
};

const bandMember: BandMember = {
  id: "user-member",
  username: "Member",
  role: "band_member",
  isReady: false,
};

const audienceMember: Audience = {
  id: "user-audience",
  username: "Audience",
  role: "audience",
  joinedAt: new Date("2026-08-01T00:00:00.000Z"),
};

// Interval callbacks are async; flush the microtask continuations (e.g. the
// `.catch` on eventBus.publish) after advancing fake timers.
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// Restore NODE_ENV after temporarily switching it (exactOptionalPropertyTypes-safe).
function restoreNodeEnv(original: string | undefined): void {
  if (original === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = original;
  }
}

describe("NamespaceGracePeriodManager", () => {
  let manager: NamespaceGracePeriodManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new NamespaceGracePeriodManager();
  });

  afterEach(() => {
    manager.shutdown();
    jest.useRealTimers();
  });

  it("uses a 10s grace period for room owners and 30s for members/audience", () => {
    expect(GRACE_PERIOD_OWNER_MS).toBe(10_000);
    expect(GRACE_PERIOD_MEMBER_MS).toBe(30_000);

    expect(manager.getGracePeriodMs("room_owner")).toBe(GRACE_PERIOD_OWNER_MS);
    expect(manager.getGracePeriodMs("band_member")).toBe(GRACE_PERIOD_MEMBER_MS);
    expect(manager.getGracePeriodMs("audience")).toBe(GRACE_PERIOD_MEMBER_MS);
    expect(manager.getGracePeriodMs(undefined)).toBe(GRACE_PERIOD_MEMBER_MS);
  });

  it("expires an owner after 10s while a member stays in grace until 30s", () => {
    manager.addToGracePeriod(ownerMember.id, "room-1", "/room/room-1", ownerMember);
    manager.addToGracePeriod(bandMember.id, "room-1", "/room/room-1", bandMember);

    expect(manager.isUserInGracePeriod(ownerMember.id, "room-1")).toBe(true);
    expect(manager.isUserInGracePeriod(bandMember.id, "room-1")).toBe(true);

    jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1);
    expect(manager.isUserInGracePeriod(ownerMember.id, "room-1")).toBe(false);
    expect(manager.isUserInGracePeriod(bandMember.id, "room-1")).toBe(true);

    jest.advanceTimersByTime(GRACE_PERIOD_MEMBER_MS - GRACE_PERIOD_OWNER_MS - 1);
    expect(manager.isUserInGracePeriod(bandMember.id, "room-1")).toBe(true); // exactly 30s elapsed

    jest.advanceTimersByTime(1);
    expect(manager.isUserInGracePeriod(bandMember.id, "room-1")).toBe(false);
  });

  it("keeps an entry valid exactly at the grace duration (strictly-greater expiry)", () => {
    manager.addToGracePeriod(ownerMember.id, "room-1", "/room/room-1", ownerMember);

    jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS);
    expect(manager.isUserInGracePeriod(ownerMember.id, "room-1")).toBe(true);

    jest.advanceTimersByTime(1);
    expect(manager.isUserInGracePeriod(ownerMember.id, "room-1")).toBe(false);
  });

  it("expires grace in one room without touching another room", () => {
    manager.addToGracePeriod(ownerMember.id, "room-a", "/room/room-a", ownerMember);
    manager.addToGracePeriod(bandMember.id, "room-b", "/room/room-b", bandMember);

    jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1);

    expect(manager.isUserInGracePeriod(ownerMember.id, "room-a")).toBe(false);
    expect(manager.getGracePeriodEntry(ownerMember.id, "room-a")).toBeNull();
    expect(manager.isUserInGracePeriod(bandMember.id, "room-b")).toBe(true);
    expect(manager.getGracePeriodEntry(bandMember.id, "room-b")).not.toBeNull();

    // Room-a's map is dropped entirely; room-b remains tracked.
    expect(manager.getGracePeriodStats().roomCount).toBe(1);
    expect(manager.getGracePeriodStats().roomBreakdown[0]?.roomId).toBe("room-b");
  });

  it("removes grace entries per room without cross-room effects", () => {
    manager.addToGracePeriod(bandMember.id, "room-a", "/room/room-a", bandMember);
    manager.addToGracePeriod(audienceMember.id, "room-b", "/room/room-b", audienceMember);

    expect(manager.removeFromGracePeriod(bandMember.id, "room-a")).toBe(true);
    expect(manager.isUserInGracePeriod(bandMember.id, "room-a")).toBe(false);
    expect(manager.removeFromGracePeriod(bandMember.id, "room-a")).toBe(false); // already gone
    expect(manager.isUserInGracePeriod(audienceMember.id, "room-b")).toBe(true);

    manager.cleanupRoomGracePeriod("room-b");
    expect(manager.getGracePeriodEntry(audienceMember.id, "room-b")).toBeNull();
    expect(manager.getGracePeriodStats().roomCount).toBe(0);
  });

  it("lazily expires entries when read via isUserInGracePeriod", () => {
    manager.addToGracePeriod(ownerMember.id, "room-1", "/room/room-1", ownerMember);

    jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1);
    expect(manager.isUserInGracePeriod(ownerMember.id, "room-1")).toBe(false);

    // The expired entry is dropped from tracking entirely.
    expect(manager.getGracePeriodEntry(ownerMember.id, "room-1")).toBeNull();
    expect(manager.getGracePeriodStats().roomCount).toBe(0);
  });

  it("lazily expires entries when read via getGracePeriodEntry", () => {
    manager.addToGracePeriod(audienceMember.id, "room-1", "/room/room-1", audienceMember);

    jest.advanceTimersByTime(GRACE_PERIOD_MEMBER_MS + 1);
    expect(manager.getGracePeriodEntry(audienceMember.id, "room-1")).toBeNull();
    expect(manager.getGracePeriodStats().roomCount).toBe(0);
  });

  it("does not remove still-valid entries when read", () => {
    manager.addToGracePeriod(bandMember.id, "room-1", "/room/room-1", bandMember);

    jest.advanceTimersByTime(GRACE_PERIOD_MEMBER_MS - 1);
    expect(manager.isUserInGracePeriod(bandMember.id, "room-1")).toBe(true);
    expect(manager.getGracePeriodEntry(bandMember.id, "room-1")).not.toBeNull();
    expect(manager.getGracePeriodStats().totalUsers).toBe(1);
    expect(manager.getGracePeriodStats().roomCount).toBe(1);
  });

  it("returns only rooms with expired users from cleanupExpiredGracePeriods", () => {
    manager.addToGracePeriod(ownerMember.id, "room-a", "/room/room-a", ownerMember);
    manager.addToGracePeriod(bandMember.id, "room-b", "/room/room-b", bandMember);

    jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1);

    const roomsNeedingCleanup = manager.cleanupExpiredGracePeriods();

    expect(roomsNeedingCleanup).toEqual(["room-a"]);
    expect(manager.getGracePeriodEntry(ownerMember.id, "room-a")).toBeNull();
    expect(manager.getGracePeriodEntry(bandMember.id, "room-b")).not.toBeNull();
    expect(manager.getGracePeriodStats().roomCount).toBe(1);
  });

  it("removes expired users but keeps live ones in the same room during cleanup", () => {
    manager.addToGracePeriod(ownerMember.id, "room-1", "/room/room-1", ownerMember);
    manager.addToGracePeriod(bandMember.id, "room-1", "/room/room-1", bandMember);

    jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1);

    const roomsNeedingCleanup = manager.cleanupExpiredGracePeriods();

    expect(roomsNeedingCleanup).toEqual(["room-1"]);
    expect(manager.getGracePeriodEntry(ownerMember.id, "room-1")).toBeNull();
    expect(manager.getGracePeriodEntry(bandMember.id, "room-1")).not.toBeNull();
    expect(manager.getGracePeriodStats().roomCount).toBe(1);
    expect(manager.getGracePeriodStats().totalUsers).toBe(1);
  });

  it("does not run a background sweep when constructed in the test environment", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    let guarded: NamespaceGracePeriodManager | undefined;
    try {
      guarded = new NamespaceGracePeriodManager();
      const publish = jest.fn<Promise<void>, [DomainEvent]>().mockResolvedValue(undefined);
      guarded.setEventBus(createPartialMock<EventBus>({ publish }));

      guarded.addToGracePeriod(ownerMember.id, "room-1", "/room/room-1", ownerMember);
      jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1); // entry expired...
      jest.advanceTimersByTime(10 * 60 * 1000); // ...but no interval exists to sweep it
      await flushMicrotasks();

      expect(publish).not.toHaveBeenCalled();
      expect(guarded.getGracePeriodStats().roomCount).toBe(1); // no background sweep
    } finally {
      guarded?.shutdown();
      restoreNodeEnv(originalNodeEnv);
    }
  });

  it("starts the interval outside test env and publishes GracePeriodsExpired for expired rooms", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    let devManager: NamespaceGracePeriodManager | undefined;
    try {
      process.env.NODE_ENV = "development";
      devManager = new NamespaceGracePeriodManager();

      const publish = jest.fn<Promise<void>, [DomainEvent]>().mockResolvedValue(undefined);
      devManager.setEventBus(createPartialMock<EventBus>({ publish }));

      devManager.addToGracePeriod(ownerMember.id, "room-1", "/room/room-1", ownerMember);
      devManager.addToGracePeriod(ownerMember.id, "room-2", "/room/room-2", ownerMember);

      jest.advanceTimersByTime(GRACE_PERIOD_OWNER_MS + 1); // both owner entries expired
      jest.advanceTimersByTime(60_000); // fire the cleanup interval
      await flushMicrotasks();

      expect(publish).toHaveBeenCalledTimes(1);
      const publishedEvent = publish.mock.calls[0]?.[0];
      expect(publishedEvent).toBeInstanceOf(GracePeriodsExpired);
      expect(publishedEvent instanceof GracePeriodsExpired ? publishedEvent.roomIds : null).toEqual([
        "room-1",
        "room-2",
      ]);
      expect(devManager.getGracePeriodStats().roomCount).toBe(0);
    } finally {
      devManager?.shutdown();
      restoreNodeEnv(originalNodeEnv);
    }
  });

  it("does not publish when the interval finds nothing expired", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    let devManager: NamespaceGracePeriodManager | undefined;
    try {
      process.env.NODE_ENV = "development";
      devManager = new NamespaceGracePeriodManager();

      const publish = jest.fn<Promise<void>, [DomainEvent]>().mockResolvedValue(undefined);
      devManager.setEventBus(createPartialMock<EventBus>({ publish }));

      // Entries added half-way to the first fire are exactly 30s old at fire time —
      // not strictly greater than the member grace → nothing expires.
      jest.advanceTimersByTime(30_000);
      devManager.addToGracePeriod(bandMember.id, "room-1", "/room/room-1", bandMember);
      devManager.addToGracePeriod(audienceMember.id, "room-2", "/room/room-2", audienceMember);
      jest.advanceTimersByTime(30_000); // interval fires at t=60s
      await flushMicrotasks();

      expect(publish).not.toHaveBeenCalled();
      expect(devManager.isUserInGracePeriod(bandMember.id, "room-1")).toBe(true);
      expect(devManager.isUserInGracePeriod(audienceMember.id, "room-2")).toBe(true);
    } finally {
      devManager?.shutdown();
      restoreNodeEnv(originalNodeEnv);
    }
  });
});
