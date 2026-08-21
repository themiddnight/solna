/**
 * E2E Tests: grace-period room members stay visible as reconnecting (TR-17)
 */
import { v4 as uuidv4 } from 'uuid'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'Grace-period presence E2E runs on chromium only')

async function gotoStable(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' })
  await page.waitForLoadState('load')
}

async function readUserIdentity(page: Page): Promise<{ userId: string; username: string }> {
  return page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('user-store')
      if (!raw) return null
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const state = (parsed.state ?? parsed) as Record<string, unknown>
      if (!state.userId || !state.username) return null
      return { userId: String(state.userId), username: String(state.username) }
    } catch {
      return null
    }
  }, { timeout: 15_000 }).then((handle) => handle.jsonValue())
}

async function enterRoomAsBandMember(page: Page, roomId: string, roomType: 'perform' | 'arrange'): Promise<{ userId: string; username: string }> {
  await gotoStable(page, '/')
  const identity = await readUserIdentity(page)

  await page.evaluate(({ id, userId, username }) => {
    sessionStorage.setItem(
      'collab-room-session',
      JSON.stringify({
        roomId: id,
        role: 'band_member',
        userId,
        username,
        timestamp: Date.now(),
      }),
    )
  }, { id: roomId, ...identity })

  await gotoStable(page, `/${roomType}/${roomId}`)
  await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })
  return identity
}

async function expectInactiveAfterDisconnect(ownerPage: Page, disconnectingPage: Page, username: string): Promise<void> {
  await expect(ownerPage.getByText(username, { exact: true })).toBeVisible({ timeout: 20_000 })

  await disconnectingPage.close()

  await expect(ownerPage.getByText(username, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(ownerPage.getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 20_000 })
}

test.describe('TR-17: Grace-period member lists', () => {
  test('Perform Room shows a disconnected band member as reconnecting', async ({ page, user2Page }) => {
    await gotoStable(page, '/')
    const room = await createRoomViaAPI(page, {
      name: `E2E Grace Perform ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    await gotoStable(page, `/perform/${room.id}`)
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    const { username } = await enterRoomAsBandMember(user2Page, room.id, 'perform')
    await expectInactiveAfterDisconnect(page, user2Page, username)
  })
})
