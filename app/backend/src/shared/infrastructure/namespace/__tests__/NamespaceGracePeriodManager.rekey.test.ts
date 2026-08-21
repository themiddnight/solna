import { NamespaceGracePeriodManager } from "../NamespaceGracePeriodManager";
import type { BandMember, Audience } from "@/types";

describe("NamespaceGracePeriodManager.rekeyGracePeriodEntry", () => {
  let manager: NamespaceGracePeriodManager;

  const roomId = "room-1";
  const namespacePath = "/room-room-1";

  const oldBandMember: BandMember = {
    id: "guest-1",
    username: "GuestUser",
    role: "band_member",
    isReady: false
  };

  const newBandMember: BandMember = {
    id: "registered-1",
    username: "RegisteredUser",
    role: "band_member",
    isReady: false,
    profilePictureUrl: "https://example.com/avatar.png",
    userType: "REGISTERED"
  };

  const audienceMember: Audience = {
    id: "guest-audience-1",
    username: "GuestAudience",
    role: "audience",
    joinedAt: new Date("2026-07-01T00:00:00.000Z")
  };

  beforeEach(() => {
    manager = new NamespaceGracePeriodManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  it("moves the entry from oldUserId to newUserId, replacing userData and preserving other fields", () => {
    manager.addToGracePeriod("guest-1", roomId, namespacePath, oldBandMember, true);

    const beforeEntry = manager.getGracePeriodEntry("guest-1", roomId);
    expect(beforeEntry).not.toBeNull();
    const originalTimestamp = beforeEntry?.timestamp;

    const isRekeyed = manager.rekeyGracePeriodEntry(roomId, "guest-1", "registered-1", newBandMember);

    expect(isRekeyed).toBe(true);

    // Old key no longer resolves
    expect(manager.getGracePeriodEntry("guest-1", roomId)).toBeNull();

    // New key resolves with updated userData, preserved namespacePath/timestamp/isIntendedLeave
    const afterEntry = manager.getGracePeriodEntry("registered-1", roomId);
    expect(afterEntry).not.toBeNull();
    expect(afterEntry?.userId).toBe("registered-1");
    expect(afterEntry?.roomId).toBe(roomId);
    expect(afterEntry?.namespacePath).toBe(namespacePath);
    expect(afterEntry?.isIntendedLeave).toBe(true);
    expect(afterEntry?.timestamp).toBe(originalTimestamp);
    expect(afterEntry?.userData).toEqual(newBandMember);
  });

  it("works for an audience entry, rekeying to a registered audience userData", () => {
    manager.addToGracePeriod("guest-audience-1", roomId, namespacePath, audienceMember, false);

    const updatedAudience: Audience = {
      ...audienceMember,
      id: "registered-audience-1",
      username: "RegisteredAudience",
      userType: "REGISTERED"
    };

    const isRekeyed = manager.rekeyGracePeriodEntry(
      roomId,
      "guest-audience-1",
      "registered-audience-1",
      updatedAudience
    );

    expect(isRekeyed).toBe(true);
    expect(manager.getGracePeriodEntry("guest-audience-1", roomId)).toBeNull();

    const afterEntry = manager.getGracePeriodEntry("registered-audience-1", roomId);
    expect(afterEntry?.userData).toEqual(updatedAudience);
  });

  it("returns false when no entry exists under oldUserId", () => {
    const isRekeyed = manager.rekeyGracePeriodEntry(roomId, "nonexistent-user", "registered-1", newBandMember);

    expect(isRekeyed).toBe(false);
    expect(manager.getGracePeriodEntry("registered-1", roomId)).toBeNull();
  });

  it("returns false when the room has no grace period map at all", () => {
    const isRekeyed = manager.rekeyGracePeriodEntry("nonexistent-room", "guest-1", "registered-1", newBandMember);

    expect(isRekeyed).toBe(false);
  });
});
