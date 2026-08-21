import { test as base } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  getStorageStatePathForUser,
  getWorkerUserIndex,
  mockHealthCheck,
} from './auth-pool'
import { makeAuthHeaders } from '../helpers/auth'

const API_BASE = (process.env.VITE_API_URL ?? 'http://localhost:3001').replace('localhost', '127.0.0.1')

/**
 * Attaches a framenavigated listener to track every room URL the page visits.
 * Returns a getter that yields the collected room IDs at any time.
 * Used by fixture teardown to leave rooms via API so the backend removes the
 * user immediately — without waiting for the socket disconnect grace period (~10s).
 */
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

/**
 * Fast teardown variant of leaveRoomViaAPI.
 * Uses page.evaluate directly (no waitForFunction) to avoid blocking the
 * fixture teardown for up to 10s when the page is in an unstable state.
 */
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

export const test = base.extend({
  storageState: async ({ browserName }, fixtureDone, testInfo) => {
    void browserName
    const userIndex = getWorkerUserIndex(testInfo.workerIndex)
    await fixtureDone(getStorageStatePathForUser(userIndex))
  },

  page: async ({ context, page }, fixtureDone) => {
    await mockHealthCheck(context)
    const getRooms = trackRooms(page)
    await fixtureDone(page)
    // Teardown: explicitly leave every room visited so the backend removes the
    // user from Redis immediately instead of waiting for the ~10s grace period.
    for (const id of getRooms()) {
      await leaveRoomFast(page, id)
    }
    // Let backend fully process leave events before the next test's fixture setup.
    await new Promise(resolve => setTimeout(resolve, 1_000))
  },
})

export { expect } from '@playwright/test'
