/**
 * E2E Tests: Companion Management — Non-Audience Only (BR-18)
 *
 * BR-18: Only room_owner and band_member can manage companions.
 * Audience cannot add/update/remove or control companions.
 *
 * Requires: E2E_USER1_*, E2E_USER2_* env vars + running backend
 */
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

test.describe.configure({ mode: 'serial' })

test.skip(({ browserName }) => browserName !== 'chromium', 'Companion BR-18 E2E runs on chromium only')

test.describe('BR-18: Companion — Non-Audience Only', () => {
  test('audience cannot see companion Add/Play controls', async ({ page, user2Page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')
    await page.waitForTimeout(1_000)

    // Create a perform room as user1
    const room = await createRoomViaAPI(page, {
      name: `E2E BR18 ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    // user1 joins as room_owner (band_member is auto-promoted to room_owner)
    await page.goto(`/perform/${room.id}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2_000)

    // user2 joins as audience
    await user2Page.goto(`/perform/${room.id}/audience?role=audience`)
    await user2Page.waitForLoadState('load')
    await expect(user2Page).toHaveURL(/\/perform\/.+\/audience/, { timeout: 30_000 })
    await user2Page.waitForTimeout(2_000)

    // Companions tab — audience should NOT see "Add companion" or "Play companions"
    const companionTab = user2Page.getByTestId('sidebar-tab-companions').or(user2Page.getByText('Companions').first())
    const isCompanionTabVisible = await companionTab.isVisible().catch(() => false)

    if (isCompanionTabVisible) {
      await companionTab.click().catch(() => {})
      await user2Page.waitForTimeout(1_000)
    }

    // Audience should NOT see "Add companion" button (BR-18)
    await expect(user2Page.getByText('Add companion').or(user2Page.getByText('Add Companion'))).toBeHidden({ timeout: 5_000 })
    // Audience should NOT see "Play companions" / "Play All" button
    const playCompanions = user2Page.getByRole('button', { name: /play.*companion/i })
    const playCount = await playCompanions.count()
    expect(playCount).toBe(0)
  })
})
