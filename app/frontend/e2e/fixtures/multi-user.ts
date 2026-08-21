/**
 * Multi-user Playwright fixture.
 *
 * Provides `user1Page` (the default `page`), `user2Page`, and `user3Page`
 * as separate browser contexts — each pre-authenticated via storageState.
 *
 * Usage:
 *   import { test, expect } from '../fixtures/multi-user'
 *
 *   test('two users see the same BPM', async ({ page, user2Page }) => { ... })
 *
 * Notes:
 * - `page` === user1 (default storageState from playwright.config.ts)
 * - user2 / user3 contexts are created fresh per test and closed on teardown
 * - Multi-user tests should run on chromium only (see `test:e2e:multi` script)
 *
 * Teardown:
 * - All rooms visited by any user page are left via API so the backend removes
 *   the user from Redis immediately instead of waiting for the ~10s grace period.
 *   This prevents the next test on the same worker from finding the user still
 *   "in a room" when it tries to join a fresh one.
 */
import { test as base, type BrowserContext, type Page } from '@playwright/test'
import {
  getStorageStatePathForUser,
  getWorkerUserIndex,
  mockHealthCheck,
} from './auth-pool'
import { makeAuthHeaders } from '../helpers/auth'

type MultiUserFixtures = {
  user2Context: BrowserContext
  user2Page: Page
  user3Context: BrowserContext
  user3Page: Page
}

const API_BASE = (process.env.VITE_API_URL ?? 'http://localhost:3001').replace('localhost', '127.0.0.1')

function trackRooms(page: Page): () => string[] {
  const ids = new Set<string>()
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const m = frame.url().match(/\/(perform|arrange)\/([^/?#]+)/)
      if (m) ids.add(m[2])
    }
  })
  return () => [...ids]
}

async function leaveRoomFast(page: Page, roomId: string): Promise<void> {
  const headers = await makeAuthHeaders(page).catch(() => ({}))
  const raw = await page.evaluate(() => localStorage.getItem('user-store')).catch(() => null)
  if (!raw) return
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const state = (parsed.state ?? parsed) as Record<string, unknown> | undefined
  const userId: string | undefined = state?.userId as string | undefined
  if (!userId) return

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await page.request.post(`${API_BASE}/api/rooms/${roomId}/leave`, {
        headers,
        data: { userId },
        timeout: 6_000,
      })
      if (res.ok()) return
    } catch {
      // ignore — retry on first attempt, give up on second
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1_500))
  }
}

export const test = base.extend<MultiUserFixtures>({
  storageState: async ({ browserName }, fixtureDone, testInfo) => {
    void browserName
    await fixtureDone(getStorageStatePathForUser(getWorkerUserIndex(testInfo.workerIndex, 0)))
  },

  page: async ({ context, page }, fixtureDone) => {
    await mockHealthCheck(context)
    const getRooms = trackRooms(page)
    await fixtureDone(page)
    for (const id of getRooms()) {
      await leaveRoomFast(page, id)
    }
    // Let backend fully process leave events before the next test's fixture setup.
    await new Promise(resolve => setTimeout(resolve, 1_000))
  },

  user2Context: async ({ browser }, fixtureDone, testInfo) => {
    const context = await browser.newContext({
      storageState: getStorageStatePathForUser(getWorkerUserIndex(testInfo.workerIndex, 1)),
    })
    await mockHealthCheck(context)
    await fixtureDone(context)
    await context.close()
  },

  user2Page: async ({ user2Context }, fixtureDone) => {
    const page = await user2Context.newPage()
    const getRooms = trackRooms(page)
    await fixtureDone(page)
    for (const id of getRooms()) {
      await leaveRoomFast(page, id)
    }
    await page.close()
  },

  user3Context: async ({ browser }, fixtureDone, testInfo) => {
    const context = await browser.newContext({
      storageState: getStorageStatePathForUser(getWorkerUserIndex(testInfo.workerIndex, 2)),
    })
    await mockHealthCheck(context)
    await fixtureDone(context)
    await context.close()
  },

  user3Page: async ({ user3Context }, fixtureDone) => {
    const page = await user3Context.newPage()
    const getRooms = trackRooms(page)
    await fixtureDone(page)
    for (const id of getRooms()) {
      await leaveRoomFast(page, id)
    }
    await page.close()
  },
})

export { expect } from '@playwright/test'
