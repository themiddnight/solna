/**
 * E2E Tests: Same-User Multi-Device Session Kicking (DEV-109)
 *
 * Verifies:
 *   1. User joins a room on Device A.
 *   2. Same user joins the SAME room on Device B.
 *   3. Device A is forcefully kicked and redirected to the lobby with a message.
 *   4. Device B remains active in the room.
 */
import { test, expect } from '../fixtures/e2e-test'
import { getStorageStatePathForUser, getWorkerUserIndex, mockHealthCheck } from '../fixtures/auth-pool'
import { createRoomViaAPI } from '../helpers/api'
import { v4 as uuidv4 } from 'uuid'
import type { Page } from '@playwright/test'

async function clearRoomSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.removeItem('collab-room-session')
    sessionStorage.removeItem('pendingInvite')
  })
}

test.describe('DEV-109: Same-User Multi-Device Session Kicking', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-device E2E runs on chromium only')

  test('should kick Device A when the same user joins from Device B', async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000)

    // Clear session state for the default page (Device A)
    await page.goto('/')
    await page.waitForLoadState('load')
    await clearRoomSession(page)

    // Device A creates a perform room
    const room = await createRoomViaAPI(page, {
      name: `E2E Kick Room ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    const roomId = room.id

    // Device A joins the perform room
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Open Device B (new browser context) using the SAME user account
    const sameUserStorageState = getStorageStatePathForUser(getWorkerUserIndex(testInfo.workerIndex, 0))
    const deviceBContext = await browser.newContext({
      storageState: sameUserStorageState,
    })
    await mockHealthCheck(deviceBContext)

    const deviceBPage = await deviceBContext.newPage()
    await deviceBPage.goto('/')
    await deviceBPage.waitForLoadState('load')
    await clearRoomSession(deviceBPage)

    // Device B joins the SAME room under the SAME user
    await deviceBPage.goto(`/perform/${roomId}`)
    await deviceBPage.waitForLoadState('load')

    // Verify Device B joins successfully (can see Leave Room button)
    await expect(deviceBPage.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Verify Device A is kicked! (should be redirected to lobby '/' and show modal)
    // Increased timeout to 30_000ms to reduce flakiness under concurrent run environments
    await expect(page).toHaveURL('/', { timeout: 30_000 })

    // Verify the Kicked Modal is visible on Device A with the correct reason
    const kickedModal = page.locator('.modal-box').first()
    await expect(kickedModal).toBeVisible({ timeout: 15_000 })
    await expect(kickedModal).toContainText('You have joined this room from another device.', { timeout: 10_000 })

    // Clean up Device B resources
    await deviceBPage.close()
    await deviceBContext.close()

    // Leave room via Device A API cleanup if possible
    await page.request.post(`/api/rooms/${roomId}/leave`, {
      headers: {
        'Authorization': `Bearer ${await page.evaluate(() => {
          const raw = localStorage.getItem('user-store')
          if (!raw) return ''
          const parsed = JSON.parse(raw) as Record<string, unknown>
          return String(((parsed.state ?? parsed) as Record<string, unknown>).token ?? '')
        })}`
      },
      data: { userId: room.owner },
      timeout: 5000
    }).catch(() => {})
  })
})
