/**
 * E2E Test: Ghost Private Room (TR-16)
 *
 * Test 1: When the FE detects a ghost private room (checkRoomExists → userCount=0),
 *   clicking "Band Member" in the lobby must NOT open WaitingApprovalModal.
 *   — Fully mocked via HTTP route intercepts for /api/rooms and /api/rooms/:id/exists.
 *
 * Test 2: When the socket emits ghost_room_error, GhostRoomModal appears and
 *   clicking "Go Back" calls DELETE /ghost.
 *   — Uses ws.connectToServer() passthrough so the real backend handles auth/join,
 *     then injects ghost_room_error into the client stream after room_joined arrives.
 *     This guarantees the socket handler is registered and React state is populated
 *     before the ghost packet fires.
 */
import { v4 as uuidv4 } from 'uuid'
import type { WebSocketRoute } from '@playwright/test'
import { test, expect } from '../fixtures/e2e-test'
import { createRoomViaAPI } from '../helpers/api'

test.describe('TR-16: Ghost Private Room', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(({ browserName }) => browserName !== 'chromium', 'Ghost Private Room E2E utilizes advanced WebSocket routing which runs on chromium only')

  // NOTE: the former Test 1 ("lobby: joining ghost private room should NOT show
  // WaitingApprovalModal") was removed (DEV-225). It fully route-mocked /api/rooms and
  // /exists (userCount: 0), so it had no real-stack value; the skip decision (private +
  // band_member + userCount===0 → abort without requesting approval) is now covered by the
  // unit test useJoinRoom.ghostSkip.test.ts. Test 2 below stays — it needs real WS routing.

  test('ghost room in Redis: navigating directly should show GhostRoomModal', async ({
    page,
  }) => {
    // Bootstrap auth and create a real room so HTTP API calls (auth checks,
    // room-detail fetches) succeed when the FE loads the perform-room page.
    await page.goto('/')
    await page.waitForLoadState('load')

    const room = await createRoomViaAPI(page, {
      name: `E2E Ghost Room ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    // ── Socket.IO injection strategy ──────────────────────────────────────
    // We pass through to the real backend (ws.connectToServer) so the FE
    // fully authenticates and receives room_joined normally. Then we inject
    // a ghost_room_error packet into the client stream after the room UI loads.
    //
    // NOTE: In E2E env, RoomSocketManager uses ['polling', 'websocket'] transports,
    // so room_joined arrives via HTTP polling — NOT via the WebSocket intercept.
    // We save the WebSocket reference and inject after detecting the loaded room
    // via DOM state, which guarantees the ghost_room_error handler is registered.

    const roomNs = `/room/${room.id}`
    const ghostPacket = `42${roomNs},["ghost_room_error",${JSON.stringify({
      message: 'This room has no active sessions.',
      roomId: room.id,
      roomName: room.name,
    })}]`

    // The FE opens a separate socket.io connection per namespace (lobby, room),
    // and in E2E uses the ['polling', 'websocket'] transports — so the room
    // namespace traffic only lands on one of potentially several intercepted
    // websockets, and only once the polling→websocket upgrade completes. Rather
    // than guess which connection is the right one, collect every intercepted
    // websocket and broadcast the ghost packet to all of them: a frame addressed
    // to /room/:id is silently ignored by any connection that lacks that namespace.
    const sockets: WebSocketRoute[] = []

    await page.routeWebSocket(/socket\.io/, async (ws) => {
      sockets.push(ws)
      const server = await ws.connectToServer()

      // Forward all server → client messages transparently
      server.onMessage((msg) => ws.send(msg))

      // Forward all client → server messages transparently
      ws.onMessage((msg) => server.send(msg))
    })

    // Track DELETE /ghost call (triggered by "Go Back" in GhostRoomModal).
    let hasGhostDeleteCalled = false
    await page.route(`**/api/rooms/${room.id}/ghost`, async (route) => {
      if (route.request().method() === 'DELETE') hasGhostDeleteCalled = true
      await route.fulfill({ status: 200, json: { success: true } })
    })

    // ── Navigate and assert ───────────────────────────────────────────────
    await page.goto(`/perform/${room.id}`)

    // Wait for room to fully load via DOM — this confirms room_joined was processed
    // and the ghost_room_error handler is registered on the socket.
    await expect(page.getByText('Room Owner')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(300) // let all React state settle

    // Broadcast the ghost packet to every intercepted websocket. The room socket
    // may still be completing its polling→websocket upgrade, so a single attempt
    // can race the ghost_room_error handler registration. Re-send until the modal
    // appears — emitting it more than once (and to extra connections) is idempotent.
    const ghostModalHeading = page.getByText('Room Not Available')
    await expect(async () => {
      for (const ws of sockets) ws.send(ghostPacket)
      await expect(ghostModalHeading).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await expect(page.getByText(room.name)).toBeVisible()

    // "Go Back" triggers DELETE /ghost then navigate(-1).
    const goBackBtn = page.getByRole('button', { name: 'Go Back' })
    await expect(goBackBtn).toBeVisible()
    await goBackBtn.click()

    await page.waitForTimeout(1_500) // let async DELETE fire
    expect(hasGhostDeleteCalled, 'Expected DELETE /ghost to be called on "Go Back"').toBe(true)
    await expect(page).toHaveURL(/127\.0\.0\.1:4173/, { timeout: 10_000 })
  })
})
