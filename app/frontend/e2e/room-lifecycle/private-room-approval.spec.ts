import type { Page } from '@playwright/test';

/**
 * E2E Tests: Private Room Approval Flow (BR-3)
 *
 * Approval flow:
 * 1. user1 creates a private perform room and joins it → becomes room_owner
 * 2. user2 sees the room in lobby (refresh if needed) → clicks "Band Member"
 * 3. user2 stays on lobby with WaitingApprovalModal open
 * 4. user1 sees badge on bell (notification) icon
 * 5. user1 opens the popup and approves → user2 navigates into the room
 *    or user1 rejects → user2 sees RejectionModal
 *
 * Requires: E2E_USER1_*, E2E_USER2_* env vars + running backend
 */
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI, listRooms } from '../helpers/api'

// Run sequentially — shared room state between tests
test.describe.configure({ mode: 'serial' })

test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user approval E2E runs on chromium only')

// Skipped: this flow is driven by the lobby room-card "Band Member" button, which is hidden
// while LOBBY_ROOM_JOIN_ENABLED is off (audience mode not ready — DEV-145). Re-enable this
// describe together with that flag.
test.describe.skip('BR-3: Private Room Approval', () => {
  let roomId: string
  let roomName: string

  /**
   * Navigate user2 to the lobby and trigger the approval request by clicking
   * "Band Member" on the private room card — the same path a real user takes.
   *
   * After this function returns, user2 is on the lobby page with
   * WaitingApprovalModal open (connectionState === REQUESTING).
   */
  const requestJoinAsBandMember = async (
    user2Page: Page,
    targetRoomId: string,
  ): Promise<void> => {
    // Navigate to lobby and wait for DOM load
    await user2Page.goto('/', { waitUntil: 'load' })

    // Assert we're on the lobby — fail fast if something redirected us
    await expect(user2Page).toHaveURL('/', { timeout: 5_000 })

    // Clear any stale room session so auto-reconnect doesn't kick in
    await user2Page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })

    // Wait for the lobby Refresh button (confirms lobby is fully rendered)
    const refreshBtn = user2Page.getByRole('button', { name: 'Refresh' })
    await expect(refreshBtn).toBeVisible({ timeout: 15_000 })

    // Confirm still on lobby (not redirected during lobby init)
    await expect(user2Page).toHaveURL('/', { timeout: 2_000 })

    await expect
      .poll(async () => {
        const rooms = await listRooms(user2Page)
        return rooms.some((room) => room.id === targetRoomId)
      }, { timeout: 30_000 })
      .toBe(true)

    // Refresh the room list to ensure the newly created private room is visible.
    // Poll with Refresh until the specific room card appears.
    const roomCard = user2Page.getByTestId(`room-card-${targetRoomId}`)
    const maxAttempts = 10
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const [response] = await Promise.all([
        user2Page.waitForResponse(resp => resp.url().includes('/api/rooms') && resp.status() === 200, { timeout: 5_000 }),
        refreshBtn.click(),
      ])
      await response.finished()
      const isVisible = await roomCard.isVisible()
      if (isVisible) break
      if (attempt < maxAttempts - 1) {
        await user2Page.waitForTimeout(1000)
      }
    }

    // Find the room card by id and click "Band Member"
    await expect(roomCard).toBeVisible({ timeout: 5_000 })
    await roomCard.getByRole('button', { name: 'Band Member' }).click()
    
    // Confirm URL remains on lobby (user2 stays on lobby while waiting for approval)
    await expect(user2Page).toHaveURL('/', { timeout: 5_000 })
  }

  test.beforeEach(async ({ page }) => {
    // user1 creates a fresh private room before each test
    roomName = `E2E Private ${uuidv4().slice(0, 8)}`
    await page.goto('/')
    await page.waitForLoadState('load')

    const room = await createRoomViaAPI(
      page,
      { name: roomName, roomType: 'perform', isPrivate: true, isHidden: false },
    )
    roomId = room.id

    // user1 navigates into the room to make it active in Redis
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')

    // Wait until user1 is fully connected as room_owner before proceeding.
    // The bell button is only rendered once currentUser.role === "room_owner",
    // so its visibility is a reliable proxy for socket connection being ready.
    const bellButton = page.getByTestId('pending-requests-bell')
    await expect(bellButton).toBeVisible({ timeout: 20_000 })
  })

  test('user2 joining private room → sees WaitingApprovalModal', async ({
    user2Page,
  }) => {
    await requestJoinAsBandMember(user2Page, roomId)

    // WaitingApprovalModal appears on the lobby page (not the perform room)
    await expect(user2Page.getByText('Waiting for Approval')).toBeVisible({ timeout: 15_000 })
  })

  test('user1 approves → user2 enters the room', async ({
    page,
    user2Page,
  }) => {
    // user2 requests to join (user1 is already in room, bell button visible from beforeEach)
    await requestJoinAsBandMember(user2Page, roomId)

    // Confirm user2 is waiting for approval
    await expect(user2Page.getByText('Waiting for Approval')).toBeVisible({ timeout: 15_000 })

    // Wait for the pending badge to appear on user1's bell button (request arrived at server)
    await expect(page.getByTestId('pending-requests-bell').locator('.badge-error')).toBeVisible({
      timeout: 30_000,
    })

    // ── user1 approves ────────────────────────────────────────────────────────
    await page.getByTestId('pending-requests-bell').click()

    const approveBtn = page.locator('.btn.btn-success').filter({ hasText: '✓' }).first()
    await expect(approveBtn).toBeVisible({ timeout: 15_000 })
    await approveBtn.click()

    // user2 should now navigate into the perform room
    await expect(user2Page).toHaveURL(new RegExp(`/perform/${roomId}`), {
      timeout: 30_000,
    })
    // WaitingApprovalModal should be gone
    await expect(user2Page.getByText('Waiting for Approval')).not.toBeVisible()
  })

  test('user1 rejects → user2 sees Request Rejected modal', async ({
    page,
    user2Page,
  }) => {
    // user2 requests to join
    await requestJoinAsBandMember(user2Page, roomId)

    // Confirm user2 is waiting
    await expect(user2Page.getByText('Waiting for Approval')).toBeVisible({ timeout: 15_000 })

    // Wait for the pending badge to appear on user1's bell button
    await expect(page.getByTestId('pending-requests-bell').locator('.badge-error')).toBeVisible({
      timeout: 30_000,
    })

    // ── user1 rejects ─────────────────────────────────────────────────────────
    await page.getByTestId('pending-requests-bell').click()

    const rejectBtn = page.locator('.btn.btn-error').filter({ hasText: '✕' }).first()
    await expect(rejectBtn).toBeVisible({ timeout: 15_000 })
    await rejectBtn.click()

    // user2 should see the RejectionModal (on lobby page)
    await expect(user2Page.getByText('Request Rejected')).toBeVisible({ timeout: 10_000 })
    // user2 should NOT be in the room
    expect(user2Page.url()).not.toMatch(new RegExp(`/perform/${roomId}`))
  })
})
