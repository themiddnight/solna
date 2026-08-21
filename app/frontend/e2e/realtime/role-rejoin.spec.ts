/**
 * E2E Tests: legacy leave/rejoin role switching
 *
 * Covers the current fallback flow where a user changes role by leaving and
 * rejoining the same Perform Room with a different URL role parameter.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

test.describe.configure({ mode: 'serial' })

// Audience / role-rejoin joins go through a socket connect that the client retries with
// backoff on failure (CONNECTION_TIMEOUT_MS = 10s + retries). Under a saturated backend
// (e.g. the full sequential E2E suite) a single connect can legitimately exceed 20s, so
// give the connect / socket-propagation assertions extra headroom. The assertions
// themselves are unchanged — this only widens the wait window.
const CONNECT_TIMEOUT = 35_000

const visibleTestId = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true }).first()

async function clearRoomSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.removeItem('collab-room-session')
    sessionStorage.removeItem('pendingInvite')
  })
}

async function openCompanionControls(page: Page): Promise<void> {
  const panel = visibleTestId(page, 'companion-panel')
  await expect(panel).toBeVisible({ timeout: 15_000 })
  const addButton = visibleTestId(page, 'companion-add-button')
  if (await addButton.isVisible().catch(() => false)) return
  await panel.click()
}

test.describe('Legacy role switch via leave/rejoin', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user role switching E2E runs on chromium only')

  test('Perform Room user can rejoin the same room from audience to band_member via role param', async ({
    page,
    user2Page,
  }) => {
    for (const p of [page, user2Page]) {
      await p.goto('/')
      await p.waitForLoadState('load')
      await clearRoomSession(p)
    }

    const room = await createRoomViaAPI(page, {
      name: `E2E Role Rejoin ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    await page.goto(`/perform/${room.id}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: CONNECT_TIMEOUT })

    await user2Page.goto(`/perform/${room.id}?role=audience`)
    await user2Page.waitForLoadState('load')
    // Audience members are redirected to the dedicated AudienceRoom page
    await expect(user2Page).toHaveURL(new RegExp(`/perform/${room.id}/audience`), { timeout: CONNECT_TIMEOUT })
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: CONNECT_TIMEOUT })

    // Read user2 identity to track its member card on the owner page
    const user2Identity = await user2Page.evaluate(() => {
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
    })

    // AudienceRoom leaves directly without a confirmation dialog.
    // Re-assert visibility immediately before clicking: the identity evaluate
    // above can race a late audience-room re-render that detaches the button.
    const leaveBtn = user2Page.getByTestId('room-leave-button')
    await expect(leaveBtn).toBeVisible({ timeout: CONNECT_TIMEOUT })
    await leaveBtn.click()
    // Wait until user has successfully left the room (navigated to home)
    await expect(user2Page).toHaveURL('/', { timeout: 10_000 })
    
    // Also wait until the owner's screen reflects user2 has left, ensuring complete backend socket cleanup
    if (user2Identity && user2Identity.userId) {
      await expect(page.getByTestId(`room-member-${user2Identity.userId}`)).toBeHidden({ timeout: CONNECT_TIMEOUT })
    }
    await user2Page.waitForTimeout(1000) // Allow extra time for page redirect logic to settle

    await user2Page.goto(`/perform/${room.id}?role=band_member`)
    await user2Page.waitForLoadState('load')

    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: CONNECT_TIMEOUT })
    
    await expect(visibleTestId(user2Page, 'companion-panel')).toBeVisible({ timeout: 15_000 })
    await openCompanionControls(user2Page)
    await expect(visibleTestId(user2Page, 'companion-add-button')).toBeVisible({ timeout: 15_000 })
  })
})
