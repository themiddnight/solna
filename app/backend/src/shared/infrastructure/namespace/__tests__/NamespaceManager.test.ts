/**
 * NamespaceManager — unit tests (BE-slices plan Task 16).
 *
 * Uses a fake `io.of()` namespace (createPartialMock, TR-27 compliant) plus fake
 * timers. The constructor starts a 5-minute cleanup interval unconditionally (no
 * NODE_ENV guard in the class) — fake timers contain it and `shutdown()` clears it.
 */
import { NamespaceManager } from "../NamespaceManager";
import { CORE_NAMESPACES } from "@jam-band/shared";
import { createPartialMock } from "@/testing/mocks";
import type { Server, Namespace, Socket } from "socket.io";

interface NamespaceHarness {
  namespace: jest.Mocked<Namespace>;
  disconnectSockets: jest.Mock;
  removeAllListeners: jest.Mock;
}

function createFakeNamespace(): NamespaceHarness {
  const disconnectSockets = jest.fn();
  const removeAllListeners = jest.fn();

  const namespace = createPartialMock<Namespace>({
    on: jest.fn(),
    emit: jest.fn(),
    disconnectSockets,
    removeAllListeners,
  });

  return { namespace, disconnectSockets, removeAllListeners };
}

function connectSocket(harness: NamespaceHarness, id: string): jest.Mocked<Socket> {
  const socket = createPartialMock<Socket>({ id, on: jest.fn(), onAny: jest.fn() });
  const call = harness.namespace.on.mock.calls.find(([event]) => event === "connection");
  const listener = call?.[1] as ((socket: Socket) => void) | undefined;
  if (listener == null) {
    throw new Error("no connection listener registered on the fake namespace");
  }
  listener(socket);
  return socket;
}

function disconnectSocket(socket: jest.Mocked<Socket>, reason = "client namespace disconnect"): void {
  const call = socket.on.mock.calls.find(([event]) => event === "disconnect");
  const listener = call?.[1];
  if (listener == null) {
    throw new Error("no disconnect listener registered on the fake socket");
  }
  listener(reason);
}

describe("NamespaceManager", () => {
  let manager: NamespaceManager;
  let harness: NamespaceHarness;
  let of: jest.MockedFunction<Server["of"]>;

  beforeEach(() => {
    jest.useFakeTimers();
    harness = createFakeNamespace();
    const io = createPartialMock<Server>({
      of: jest.fn().mockReturnValue(harness.namespace),
    });
    of = jest.mocked(io.of);
    manager = new NamespaceManager(io);
  });

  afterEach(() => {
    manager.shutdown();
    jest.useRealTimers();
  });

  it("creates a room namespace via io.of and tracks it", () => {
    const namespace = manager.createRoomNamespace("room-1");

    expect(of).toHaveBeenCalledWith("/room/room-1");
    expect(namespace).toBe(harness.namespace);
    expect(manager.hasNamespace("/room/room-1")).toBe(true);
    expect(manager.getActiveNamespaces()).toEqual(["/room/room-1"]);
    expect(manager.getNamespaceStats().totalNamespaces).toBe(1);
    expect(harness.namespace.on).toHaveBeenCalledWith("connection", expect.any(Function));
    expect(manager.getRoomNamespace("room-1")).toBe(namespace);
    expect(manager.getRoomNamespace("missing")).toBeUndefined();
  });

  it("reuses an existing room namespace instead of creating a second one", () => {
    const first = manager.createRoomNamespace("room-1");
    const second = manager.createRoomNamespace("room-1");

    expect(second).toBe(first);
    expect(of).toHaveBeenCalledTimes(1);
    expect(manager.getNamespaceStats().totalNamespaces).toBe(1);

    // ensure* helpers reuse too.
    expect(manager.ensureRoomNamespaceExists("room-1")).toBe(first);
    expect(of).toHaveBeenCalledTimes(1);
  });

  it("creates and reuses approval and lobby-monitor namespaces", () => {
    const approval = manager.createApprovalNamespace("room-1");
    expect(of).toHaveBeenCalledWith("/approval/room-1");
    expect(manager.createApprovalNamespace("room-1")).toBe(approval);
    expect(manager.getApprovalNamespace("room-1")).toBe(approval);
    expect(manager.ensureApprovalNamespaceExists("room-1")).toBe(approval);

    const lobbyMonitor = manager.createLobbyMonitorNamespace();
    expect(of).toHaveBeenCalledWith(CORE_NAMESPACES.LOBBY_MONITOR);
    expect(manager.createLobbyMonitorNamespace()).toBe(lobbyMonitor);
    expect(manager.getLobbyMonitorNamespace()).toBe(lobbyMonitor);

    expect(manager.hasNamespace("/approval/room-1")).toBe(true);
    expect(manager.hasNamespace(CORE_NAMESPACES.LOBBY_MONITOR)).toBe(true);
    expect(of).toHaveBeenCalledTimes(2); // approval + lobby-monitor, no re-creates
  });

  it("counts connections and disconnections via namespace listeners", () => {
    manager.createRoomNamespace("room-1");

    const socketA = connectSocket(harness, "socket-a");
    const socketB = connectSocket(harness, "socket-b");

    let details = manager.getNamespaceStats().namespaceDetails;
    expect(details.find((d) => d.path === "/room/room-1")?.connectionCount).toBe(2);
    expect(manager.getNamespaceStats().totalConnections).toBe(2);
    expect(socketA.on).toHaveBeenCalledWith("disconnect", expect.any(Function));
    expect(socketA.onAny).toHaveBeenCalledWith(expect.any(Function));

    disconnectSocket(socketA);
    disconnectSocket(socketB);

    details = manager.getNamespaceStats().namespaceDetails;
    expect(details.find((d) => d.path === "/room/room-1")?.connectionCount).toBe(0);
    expect(manager.getNamespaceStats().totalConnections).toBe(0);
  });

  it("never lets the connection count drop below zero", () => {
    manager.createRoomNamespace("room-1");
    const socket = connectSocket(harness, "socket-a");

    disconnectSocket(socket);
    disconnectSocket(socket); // double disconnect

    const details = manager.getNamespaceStats().namespaceDetails;
    expect(details.find((d) => d.path === "/room/room-1")?.connectionCount).toBe(0);
  });

  it("cleans up inactive room namespaces but skips core namespaces", () => {
    manager.createRoomNamespace("room-1");
    manager.createLobbyMonitorNamespace();

    // Interval fires every 5 minutes; a namespace is stale after 30 minutes of inactivity.
    jest.advanceTimersByTime(35 * 60 * 1000);

    expect(manager.hasNamespace("/room/room-1")).toBe(false);
    expect(manager.hasNamespace(CORE_NAMESPACES.LOBBY_MONITOR)).toBe(true);
    expect(manager.getActiveNamespaces()).toEqual([CORE_NAMESPACES.LOBBY_MONITOR]);
    expect(harness.disconnectSockets).toHaveBeenCalledWith(true);
    expect(harness.removeAllListeners).toHaveBeenCalled();
  });

  it("keeps an inactive namespace that still has connections", () => {
    manager.createRoomNamespace("room-1");
    connectSocket(harness, "socket-a");

    jest.advanceTimersByTime(35 * 60 * 1000);

    expect(manager.hasNamespace("/room/room-1")).toBe(true);
    expect(harness.disconnectSockets).not.toHaveBeenCalled();
  });

  it("treats namespace lookups as activity that resets the idle clock", () => {
    manager.createRoomNamespace("room-1");

    jest.advanceTimersByTime(25 * 60 * 1000);
    expect(manager.getRoomNamespace("room-1")).toBe(harness.namespace); // refreshes lastActivity

    // 30 minutes after the refresh (55 after creation): still under the strict
    // 30-minute threshold; without the refresh it would have been cleaned at 35.
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(manager.hasNamespace("/room/room-1")).toBe(true);
  });

  it("cleanupNamespace disconnects sockets, removes listeners and deletes tracking", () => {
    manager.createRoomNamespace("room-1");
    connectSocket(harness, "socket-a");

    const didCleanup = manager.cleanupNamespace("/room/room-1");

    expect(didCleanup).toBe(true);
    expect(harness.disconnectSockets).toHaveBeenCalledWith(true);
    expect(harness.removeAllListeners).toHaveBeenCalled();
    expect(manager.hasNamespace("/room/room-1")).toBe(false);
    expect(manager.getActiveNamespaces()).toEqual([]);

    // Untracked path returns false.
    expect(manager.cleanupNamespace("/room/room-1")).toBe(false);
  });

  it("cleanupRoomNamespace and cleanupApprovalNamespace target the right paths", () => {
    manager.createRoomNamespace("room-1");
    manager.createApprovalNamespace("room-1");

    expect(manager.cleanupRoomNamespace("room-1")).toBe(true);
    expect(manager.hasNamespace("/room/room-1")).toBe(false);
    expect(manager.hasNamespace("/approval/room-1")).toBe(true);

    expect(manager.cleanupApprovalNamespace("room-1")).toBe(true);
    expect(manager.hasNamespace("/approval/room-1")).toBe(false);
  });

  it("shutdown clears the interval and cleans up every tracked namespace", () => {
    manager.createRoomNamespace("room-1");
    manager.createLobbyMonitorNamespace();

    manager.shutdown();

    expect(harness.disconnectSockets).toHaveBeenCalledTimes(2);
    expect(harness.removeAllListeners).toHaveBeenCalledTimes(2);
    expect(manager.getActiveNamespaces()).toEqual([]);
  });
});
