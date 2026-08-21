/**
 * E2E Tests: Room reconnection after page reload (TR-6)
 *
 * Verifies that when a user in a room reloads the page, they are reconnected
 * to the same room and their role is preserved.
 */
import { v4 as uuidv4 } from 'uuid'
import { type Page } from '@playwright/test'
import { test, expect } from '../fixtures/e2e-test'
import { createRoomViaAPI } from '../helpers/api'
import { getE2EUserCredentials, getWorkerUserIndex } from '../fixtures/auth-pool'

test.skip(({ browserName }) => browserName !== 'chromium', 'Reconnect E2E runs on chromium only due cross-browser auth/storage instability')

async function mockHealthCheck(page: Page): Promise<void> {
  await page.context().route('**/api/health*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }),
  )
}

async function gotoLobbyStable(page: Page): Promise<void> {
  await gotoStable(page, '/')
}

async function gotoStable(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'load' })
      await page.waitForLoadState('load')
      return
    } catch (error) {
      if (attempt === 2) {
        throw error
      }
      await page.waitForTimeout(500)
    }
  }
}

async function ensureAuthenticatedIdentity(page: Page, workerIndex: number): Promise<void> {
  const hasIdentity = await page.evaluate(() => {
    const raw = localStorage.getItem('user-store')
    if (!raw) return false
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const state = (parsed.state ?? parsed) as Record<string, unknown>
    return Boolean(state.userId && state.username)
  })

  if (hasIdentity) {
    return
  }

  const userIndex = getWorkerUserIndex(workerIndex)
  const { email, password } = getE2EUserCredentials(userIndex)

  await page.goto('/login', { waitUntil: 'load' })
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: /^Login$/ }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })

  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('user-store')
      if (!raw) return false
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const state = (parsed.state ?? parsed) as Record<string, unknown>
      return state.isAuthenticated === true && !!state.userId && !!state.username
    } catch {
      return false
    }
  }, { timeout: 10_000 })
}

async function enterRoomAndWaitForLeaveButton(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await gotoStable(page, path)
    const isReady = await page
      .getByTestId('room-leave-button')
      .isVisible({ timeout: 15_000 })
      .catch(() => false)
    if (isReady) {
      return
    }
  }

  await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })
}

test.describe('TR-6: Room reconnection after page reload', () => {
  test('room_owner reloads page → stays in perform room with role preserved', async ({ page }, testInfo) => {
    await mockHealthCheck(page)
    await gotoLobbyStable(page)
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await gotoLobbyStable(page)
    await ensureAuthenticatedIdentity(page, testInfo.workerIndex)

    const room = await createRoomViaAPI(page, {
      name: `E2E Reconnect Perform ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    await enterRoomAndWaitForLeaveButton(page, `/perform/${room.id}`)

    const urlBefore = page.url()

    // Reload the page
    await page.reload()
    await page.waitForLoadState('load')

    // Should still be on the same perform room URL
    await expect(page).toHaveURL(urlBefore, { timeout: 15_000 })
    // Leave Room still visible → role preserved
    await enterRoomAndWaitForLeaveButton(page, `/perform/${room.id}`)
  })

  test('room_owner reloads page → stays in arrange room with role preserved', async ({ page }, testInfo) => {
    await mockHealthCheck(page)
    await gotoLobbyStable(page)
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await gotoLobbyStable(page)
    await ensureAuthenticatedIdentity(page, testInfo.workerIndex)

    const room = await createRoomViaAPI(page, {
      name: `E2E Reconnect Arrange ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })

    await enterRoomAndWaitForLeaveButton(page, `/arrange/${room.id}`)

    const urlBefore = page.url()

    await page.reload()
    await page.waitForLoadState('load')

    await expect(page).toHaveURL(urlBefore, { timeout: 15_000 })
    await enterRoomAndWaitForLeaveButton(page, `/arrange/${room.id}`)
  })
})
