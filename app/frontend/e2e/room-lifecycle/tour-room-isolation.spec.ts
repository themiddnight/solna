import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI, listRooms } from '../helpers/api'

/**
 * DEV-221 regression — a guest's onboarding-tour room must be isolated: undiscoverable in the
 * room list and unjoinable by other users. This guards the exact gap that let the bug ship — the
 * isolation was originally wired only to the socket create path while the tour creates via REST,
 * so no test ever compared "a tour-created room" against "what another user can see/join".
 *
 * We exercise the real stack end-to-end (POST /api/rooms with isTourRoom → Redis → GET /api/rooms
 * + a real socket join attempt), which unit tests (mocked repo) cannot cover.
 */

test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user tests run on chromium only')

test.describe('DEV-221: Onboarding-tour room isolation', () => {
  test('an isTourRoom room is hidden from the lobby list and cannot be joined by others', async ({ page, user2Page }) => {
    // user1 creates an isolated tour room — the same request the tour's lobby (REST) create sends.
    await page.goto('/')
    await page.waitForLoadState('load')
    const room = await createRoomViaAPI(page, {
      name: `TourIso ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
      isTourRoom: true,
    })
    // The server must force isolation regardless of what the client asked for.
    expect(room.isHidden).toBe(true)

    // user2: the room must NOT appear in their lobby room list…
    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')
    const rooms = await listRooms(user2Page)
    expect(rooms.some((r) => r.id === room.id)).toBe(false)

    // …nor render as a room card in the lobby UI.
    await expect(user2Page.getByTestId(`room-card-${room.id}`)).toHaveCount(0)

    // user2: a direct join attempt is hard-rejected (ROOM_ISOLATED) — they never reach the room.
    await user2Page.evaluate((id) => {
      sessionStorage.setItem(
        'collab-room-session',
        JSON.stringify({ roomId: id, role: 'band_member', userId: 'e2e', username: 'e2e', timestamp: Date.now() }),
      )
    }, room.id)
    await user2Page.goto(`/perform/${room.id}`)
    await user2Page.waitForLoadState('load')
    await expect(user2Page.getByTestId('room-leave-button')).toHaveCount(0, { timeout: 10_000 })
  })
})
