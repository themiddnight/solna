/**
 * E2E: voice mesh continuity after an in-room guest→registered identity swap.
 *
 * A guest with voice enabled, in a fresh room with a registered peer B, triggers the in-room
 * signup modal (arrange: Save button; perform: record) and LOGS IN to a pool account. On B we
 * assert the swapping member re-keys from the guest id to the registered id AND that voice mute
 * still syncs under the new id — i.e. the mesh is correctly re-keyed to the verified identity
 * (locks the C1 regression from the voice-mesh-resync feature).
 *
 * Chromium-only, fake media, serial. Login (not register) avoids OTP + DB pollution.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI, leaveRoomViaAPI } from '../helpers/api'
import { getE2EUserCredentials, mockHealthCheck } from '../fixtures/auth-pool'
import { enterRoomOfType, continueAsGuest } from './webrtc-interop-helpers'
import { loginInModal, waitForIdentitySwap } from './identity-swap-helpers'

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
})
test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'WebRTC tests run on chromium only')

function memberCard(page: Page, userId: string): Locator {
  return page.getByTestId(`room-member-${userId}`)
}

function mutedBadge(page: Page, userId: string): Locator {
  return page.getByTestId(`room-member-mic-muted-${userId}`)
}

// A dedicated pool credential the guest logs into. The `multi-user` fixture assigns this file's
// single worker (mode: 'serial' → workerIndex 0) offsets 0/1/2 → E2E_USER1/2/3 to
// page/user2Page/user3Page (see getWorkerUserIndex in auth-pool.ts). Index 4 is outside that
// slice, so logging into it here can never collide with an identity already live on this worker.
const SWAP_LOGIN_INDEX = 4

for (const roomType of ['perform', 'arrange'] as const) {
  test(`voice re-syncs under the verified identity after guest→registered swap (${roomType})`, async ({
    browser,
    user2Page: peerPage,
  }) => {
    // The guest must be UNauthenticated. The multi-user fixture's `page` is pre-authenticated via
    // a pooled storageState, so navigating it to /login would redirect straight to the lobby and
    // the "Continue as Guest" button would never render. Create a fresh, storage-less context for A.
    //
    // This test environment's headless Chromium does NOT give a brand-new `browser.newContext()`
    // a clean per-origin storage partition: a stale, fully-authenticated `user-store` (plus a
    // `refresh_token` cookie) for the pool's user1 leaks in from elsewhere in the browser process
    // and is already present before the very first navigation (confirmed via an `addInitScript`
    // probe that logs localStorage at document_start — populated before any app code runs).
    // Clearing cookies alone is not enough (localStorage carries the same bleed independently) —
    // wipe both explicitly before the guest's first paint so `continueAsGuest` actually lands on
    // an unauthenticated /login instead of an already-logged-in lobby.
    //
    // `enterRoomOfType` does two more full `page.goto()` reloads after the guest identity is
    // minted, and `addInitScript` re-runs on every document load in this context — so a naive
    // unconditional clear would also wipe the guest's own freshly-minted sessionStorage identity
    // on those later reloads. Gate the wipe behind a same-origin marker cookie (untouched by
    // `localStorage.clear()`/`sessionStorage.clear()` and persisted across reloads) so it fires
    // exactly once, before the contamination can be read, and never again afterward.
    const guestContext = await browser.newContext()
    await guestContext.clearCookies()
    await guestContext.addInitScript(() => {
      if (document.cookie.includes('e2e_guest_storage_primed=1')) return
      localStorage.clear()
      sessionStorage.clear()
      document.cookie = 'e2e_guest_storage_primed=1; path=/'
    })
    await mockHealthCheck(guestContext)
    const guestPage = await guestContext.newPage()

    // Hoisted so the finally block can free the guest's (post-swap) room membership via API.
    let roomId: string | undefined

    try {
      // user2Page starts on about:blank — localStorage is inaccessible there (SecurityError), so
      // load the app origin first to make the pre-authenticated storageState token readable.
      await peerPage.goto('/', { waitUntil: 'load' })

      // Fresh room, no project/owner → guest New Save is eligible (arrange) and record is open (perform).
      const room = await createRoomViaAPI(peerPage, {
        name: `swap-${roomType}-${uuidv4().slice(0, 8)}`,
        roomType,
      })
      roomId = room.id

      // Peer B (pre-authenticated fixture user) joins with voice.
      const peerId = await enterRoomOfType(peerPage, room.id, roomType)

      // Guest A (fresh context) joins with voice.
      await continueAsGuest(guestPage)
      const guestIdentity = await enterRoomOfType(guestPage, room.id, roomType)

      // B sees A as a guest member; mesh forms.
      await expect(memberCard(peerPage, guestIdentity.userId)).toBeVisible({ timeout: 25_000 })
      await expect(memberCard(guestPage, peerId.userId)).toBeVisible({ timeout: 25_000 })

      // A triggers the in-room signup modal.
      if (roomType === 'arrange') {
        await guestPage.getByTestId('arrange-save-button').click()
      } else {
        // Perform: the header's Record control routes restricted users through
        // useInRoomRestrictionGate.guardAction instead of opening the record-type dropdown
        // (confirmed by the DEV-217 unit test PerformRoomHeader.recordTrigger.test.tsx, which
        // asserts this exact selector opens the in-room auth prompt for a restricted user).
        await guestPage.getByRole('button', { name: /record/i }).click()
      }
      await expect(guestPage.getByRole('button', { name: /log ?in|already have an account/i }))
        .toBeVisible({ timeout: 15_000 })

      // A logs into a pool account → identity swap + voice re-sync.
      await loginInModal(guestPage, getE2EUserCredentials(SWAP_LOGIN_INDEX))

      // A's store now holds the registered identity. The submit click only resolves once the
      // request is sent -- prepareForIdentitySwapFn/swapIdentityFn's socket rekey finishes
      // asynchronously afterward, so poll until user-store actually moves off the guest id
      // instead of reading it immediately (which would just re-observe the still-valid guest
      // entry and never actually exercise the swap).
      const registered = await waitForIdentitySwap(guestPage, guestIdentity.userId)

      // ── Continuity assertions on B ──────────────────────────────────────────
      // The stale guest member card disappears; the registered one appears (mesh re-keyed).
      await expect(memberCard(peerPage, guestIdentity.userId)).toBeHidden({ timeout: 25_000 })
      await expect(memberCard(peerPage, registered.userId)).toBeVisible({ timeout: 25_000 })

      // The post-swap reconnect occasionally hits a transient "Invalid session or room" retry
      // (RoomSocketManager/ErrorRecoveryService recover from it automatically -- confirmed via
      // console logs during investigation) before the room socket settles, which gates the
      // arrange sidebar's voice panel (and therefore the Mute button) behind
      // ArrangeRoomHeader's `isConnected` flag. Wait for the "Connecting..." badge to clear
      // instead of clicking immediately, mirroring the generous runway already used by the
      // member-card assertions above.
      await expect(guestPage.getByText('Connecting...')).toBeHidden({ timeout: 90_000 })

      // Voice mute syncs under the NEW id (proves the mesh signaling is keyed to the verified id).
      await guestPage.getByTestId('voice-mic-toggle').click()
      await expect(mutedBadge(peerPage, registered.userId)).toBeVisible({ timeout: 25_000 })
    } finally {
      // The `multi-user` fixture only leaves rooms for its own pages; this hand-rolled guest
      // context is invisible to it. Free the guest's (post-swap) room membership via API so the
      // backend releases the pool account immediately instead of after the ~10s grace period —
      // otherwise the next serial run reusing this account can hang at "Connecting to Room".
      if (roomId) {
        await leaveRoomViaAPI(guestPage, roomId).catch(() => {})
      }
      await guestContext.close()
    }
  })
}
