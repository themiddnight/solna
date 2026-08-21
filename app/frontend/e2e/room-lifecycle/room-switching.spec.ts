/**
 * E2E Tests: Room switching — owner moves between room types (BR-10)
 *
 * BR-10: When room_owner switches room type (Perform → Arrange or vice versa),
 *        band members see a FollowOwnerModal and can choose to follow to the new room.
 *
 * Requires: E2E_USER1_*, E2E_USER2_* env vars + running backend
 */
import { v4 as uuidv4 } from 'uuid'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

test.describe.configure({ mode: 'serial' })

test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user room-switching E2E runs on chromium only')

async function joinPerformRoomAsOwner(page: Page, roomId: string) {
  let isOwnerReady = false

  for (let attempt = 0; attempt < 2 && !isOwnerReady; attempt++) {
    await page.goto('/')
    await page.waitForLoadState('load')
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')

    const isBellReady = await page.getByTestId('pending-requests-bell')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)

    const isArrangeReady = await page.locator('button[title="Move to Arrange Room"]')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false)

    isOwnerReady = isBellReady && isArrangeReady
  }

  expect(isOwnerReady).toBe(true)
}

test.describe('BR-10: Room owner switches room type → band member can follow', () => {
  let roomId: string

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await page.goto('/')
    await page.waitForLoadState('load')
    // Short settle wait — fixture teardown now calls leaveRoomViaAPI so the
    // backend removes the user immediately; 2s is enough for event propagation.
    await page.waitForTimeout(2_000)

    const room = await createRoomViaAPI(page, {
      name: `E2E BR10 ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    roomId = room.id
  })

  test('user1 (room_owner) moves to Arrange → user2 sees FollowOwnerModal → user2 follows → both in /arrange/:id', async ({
    page,
    user2Page,
  }) => {
    // Clear stale session role then join perform room; room creator should become room_owner.
    await joinPerformRoomAsOwner(page, roomId)

    const bellButton = page.getByTestId('pending-requests-bell')
    await expect(bellButton).toBeVisible({ timeout: 10_000 })

    // user2 joins as band_member via ?role=band_member query param
    let didUser2FollowVisible = false
    for (let attempt = 0; attempt < 2 && !didUser2FollowVisible; attempt++) {
      await user2Page.goto(`/perform/${roomId}?role=band_member`)
      await user2Page.waitForLoadState('load')
      didUser2FollowVisible = await user2Page.getByTestId('perform-follow-scale-checkbox')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
    }
    await expect(user2Page.getByTestId('perform-follow-scale-checkbox')).toBeVisible({ timeout: 20_000 })
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Verify user2's socket is registered on the backend by waiting for user2's username
    // to appear in user1's member list — this only happens via socket events, not URL params.
    const user2Username: string = await user2Page.evaluate(() => {
      const raw = localStorage.getItem('user-store')
      if (!raw) return ''
      const parsed: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>
      const state: Record<string, unknown> = (parsed.state ?? {}) as Record<string, unknown>
      return String(state.username ?? '')
    })
    if (user2Username) {
      await expect.poll(
        () => page.getByText(user2Username).isVisible().catch(() => false),
        { timeout: 20_000 }
      ).toBe(true)
    }

    // Wait briefly to let socket events settle before initiating the room switch
    await page.waitForTimeout(2_000)
    // Re-verify both clients are still stably connected before initiating switch.
    const isBellStillVisible = await bellButton
      .isVisible({ timeout: 10_000 })
      .catch(() => false)
    if (!isBellStillVisible) {
      await joinPerformRoomAsOwner(page, roomId)
    }
    await expect(bellButton).toBeVisible({ timeout: 20_000 })
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 10_000 })

    // user1 clicks the "Arrange" button (Move to Arrange Room) — with retry on silent socket failure
    const arrangeBtn = page.locator('button[title="Move to Arrange Room"]')
    const ownerMovedHeading = user2Page.getByRole('heading', { name: 'Room Owner Moved' })

    const doSwitch = async () => {
      await expect(arrangeBtn).toBeVisible({ timeout: 10_000 })
      await arrangeBtn.click()
      await expect(page.getByText('Move to Arrange Room')).toBeVisible({ timeout: 8_000 })
      await page.getByRole('button', { name: /New Empty Arrange Room/i }).click()
    }

    await doSwitch()

    // Wait for user1 to navigate to the new arrange room.
    // If the socket ack times out, arrange button re-appears — retry once.
    const didNavigate = await page.waitForURL(/\/arrange\//, { timeout: 38_000 })
      .then(() => true)
      .catch(() => false)

    if (!didNavigate) {
      if (await arrangeBtn.isVisible()) {
        await doSwitch()
      }
      await page.waitForURL(/\/arrange\//, { timeout: 38_000 })
    }

    const newArrangeUrl = page.url()
    const newRoomId = newArrangeUrl.match(/\/arrange\/([^/?#]+)/)?.[1]
    expect(newRoomId).toBeTruthy()

    // user1 has didNavigate — give user2 a fresh timer to receive the room-switch socket event.
    // Wait for modal with enhanced debugging on failure
    const isModalVisible = await ownerMovedHeading.waitFor({ state: 'visible', timeout: 50_000 }).then(() => true).catch(() => false)
    if (!isModalVisible) {
      console.warn('[E2E-FAIL] user2 current URL:', user2Page.url())
    }
    await expect(ownerMovedHeading).toBeVisible({ timeout: 5_000 })

    await user2Page.getByRole('button', { name: /Follow to Arrange/i }).click()
    await expect(user2Page).toHaveURL(new RegExp(`/arrange/${newRoomId}`), { timeout: 30_000 })
    await expect(ownerMovedHeading).not.toBeVisible({ timeout: 5_000 })
  })
})
