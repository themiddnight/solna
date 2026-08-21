/**
 * E2E Tests: Real-time state sync in Perform Room
 *
 * Verifies that commit events (scale change / follow-owner) initiated by user1
 * are received and rendered correctly by user2 in the same room.
 * (BPM-change commit was demoted to backend coverage — see DEV-225.)
 *
 * Scale FOLLOW: this E2E covers the cross-user follow-mode UI toggling only —
 * independent → follow → unfollow, keyed off stable UI state (scale-slot-select
 * visibility + the "Following" indicator, which renders only once the member has
 * received the owner's room scale). The specific scale VALUE propagation is
 * covered more cheaply by unit tests (useRoomScaleSync, usePerformEffectiveScale,
 * shared resolveEffectiveScale) and backend integration
 * (RoomMembershipHandler.roomScaleChange, EventFlowIntegration) — same demotion
 * rationale as the BPM commit above. The "Following" label intentionally no longer
 * echoes the scale name, so asserting a scale value here is neither possible nor needed.
 *
 * Only commit events are tested here — ephemeral drag/knob events are
 * timing-sensitive and covered by unit/integration tests instead.
 *
 * Requires: E2E_USER1_*, E2E_USER2_* env vars + running backend
 */
import { v4 as uuidv4 } from 'uuid'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

const visibleTestId = (page: Page, testId: string): Locator =>
  page.getByTestId(testId).filter({ visible: true }).first()

async function hasBandMemberUi(page: Page) {
  const hasFollowToggle = await page.getByTestId('perform-follow-scale-checkbox').isVisible().catch(() => false)
  const hasBandMemberBadge = await page.getByText('Band Member').isVisible().catch(() => false)
  const hasLeave = await page.getByTestId('room-leave-button').isVisible().catch(() => false)
  return hasLeave && (hasFollowToggle || hasBandMemberBadge)
}

test.describe('Real-time sync: Perform Room', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user realtime E2E runs on chromium only')

  let roomId: string

  test.beforeEach(async ({ page, user2Page }) => {
    // user1 creates a room
    await page.goto('/')
    await page.waitForLoadState('load')
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await page.goto('/')
    await page.waitForLoadState('load')

    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')
    await user2Page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')

    // Short settle wait — fixture teardown now calls leaveRoomViaAPI so the
    // backend removes the user immediately; 2s is enough for event propagation.
    await page.waitForTimeout(2_000)

    const room = await createRoomViaAPI(page, {
      name: `E2E Sync ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    roomId = room.id

    // Clear stale room session before joining the newly created room.
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
    })

    // user1 navigates to the room
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // user2 joins as band_member using URL role param to avoid history/state races.
    let isUser2BandMemberReady = false
    for (let attempt = 0; attempt < 2 && !isUser2BandMemberReady; attempt++) {
      await user2Page.goto(`/perform/${roomId}?role=band_member`)
      await user2Page.waitForLoadState('load')
      isUser2BandMemberReady = await expect
        .poll(async () => hasBandMemberUi(user2Page), { timeout: 15_000 })
        .toBe(true)
        .then(() => true)
        .catch(() => false)
    }

    expect(isUser2BandMemberReady).toBe(true)
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Let join/leave retries settle before assertions in each test.
    await page.waitForTimeout(3_000)
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 10_000 })

    // Ensure both pages have the expected controls before each test starts.
    // This prevents role/socket drift from previous suites from causing false negatives.
    let isOwnerControlsReady = false
    let isMemberControlsReady = false

    for (let attempt = 0; attempt < 3; attempt++) {
      isOwnerControlsReady = await page.getByRole('button', { name: /♩\s*\d+\s*BPM|♩\s*\d+/ })
        .first()
        .isVisible({ timeout: 3_000 })
        .catch(() => false)

      isMemberControlsReady = await hasBandMemberUi(user2Page)

      if (isOwnerControlsReady && isMemberControlsReady) {
        break
      }

      await page.goto(`/perform/${roomId}`)
      await page.waitForLoadState('load')
      await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

      await user2Page.goto(`/perform/${roomId}?role=band_member`)
      await user2Page.waitForLoadState('load')
      await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

      await page.waitForTimeout(2_000)
    }

    expect(isOwnerControlsReady).toBe(true)
    expect(isMemberControlsReady).toBe(true)
  })

  // NOTE: the former "BPM change by user1 → user2 sees updated BPM" e2e was removed
  // (DEV-225). The server-authoritative broadcast (perform:bpm_changed to the room) is
  // covered by the backend PerformRoomIntegration test; the FE receive→button-update is
  // thin ephemeral binding.

  test('Scale follow: independent mode, follow owner, unfollow (DEV-93)', async ({
    page,
    user2Page,
  }) => {
    // ── Selectors ─────────────────────────────────────────────────────────────
    const followToggle = user2Page.getByTestId('perform-follow-scale-checkbox').first()

    // The "Following" indicator renders only when the member is following AND has
    // received the owner's room scale — so its presence is a cross-user signal that
    // the room scale propagated. Absence uses toHaveCount(0) (the indicator is not
    // rendered at all in independent mode); presence uses the visible-filtered copy
    // (a hidden responsive duplicate may also exist).
    const followingIndicatorAll = user2Page.getByTestId('scale-following-indicator')
    const followingIndicatorVisible = visibleTestId(user2Page, 'scale-following-indicator')

    const openScaleSlotMenu = async (targetPage: Page) => {
      const trigger = visibleTestId(targetPage, 'scale-slot-select')
      await expect(trigger).toBeVisible({ timeout: 15_000 })
      await trigger.click()
      await expect(visibleTestId(targetPage, 'scale-slot-1')).toBeVisible({ timeout: 5_000 })
    }

    const selectScaleSlot = async (targetPage: Page, slotId: number) => {
      await openScaleSlotMenu(targetPage)
      const slot = visibleTestId(targetPage, `scale-slot-${slotId}`)
      await expect(slot).toBeVisible({ timeout: 5_000 })
      await slot.click()
    }

    // Wait for both pages to have usable controls
    await expect.poll(() => hasBandMemberUi(user2Page), { timeout: 20_000 }).toBe(true)

    // Ensure user2 is in independent mode before expecting local slot buttons.
    if (await followToggle.isChecked().catch(() => false)) {
      await followToggle.click()
      await expect(followToggle).not.toBeChecked({ timeout: 5_000 })
    }

    await expect(visibleTestId(user2Page, 'scale-slot-select')).toBeVisible({ timeout: 15_000 })
    await expect(visibleTestId(page, 'scale-slot-select')).toBeVisible({ timeout: 15_000 })

    // ── Step 1: Independent mode ───────────────────────────────────────────────
    // Slot dropdown is visible — user2 is in independent mode.
    await openScaleSlotMenu(user2Page)
    await expect(visibleTestId(user2Page, 'scale-slot-1')).toBeVisible()
    await expect(visibleTestId(user2Page, 'scale-slot-2')).toBeVisible()
    await user2Page.keyboard.press('Escape').catch(() => undefined)

    // user2 selects their own slot — does NOT change owner's selection
    await selectScaleSlot(user2Page, 2)
    // Owner's slot selector still visible and unchanged
    await expect(visibleTestId(page, 'scale-slot-select')).toBeVisible()
    // No "Following" indicator in independent mode
    await expect(followingIndicatorAll).toHaveCount(0)

    // ── Step 2: Owner sets the room scale, then user2 follows ─────────────────
    // Owner selects a slot so a room scale exists (and is broadcast) to follow.
    await selectScaleSlot(page, 1)

    await followToggle.click()
    await expect(followToggle).toBeChecked({ timeout: 5_000 })

    // Cross-user signal: the indicator appears only once user2 has received the
    // owner's room scale over the socket — no reload needed. (The scale VALUE is
    // asserted in the unit/backend tests noted in the file header.)
    await expect(followingIndicatorVisible).toBeVisible({ timeout: 10_000 })
    // Scale slot selector disappears in follow mode
    await expect(visibleTestId(user2Page, 'scale-slot-select')).not.toBeVisible({ timeout: 5_000 })

    // ── Step 3: Unfollow → back to independent ────────────────────────────────
    await followToggle.click()
    await expect(followToggle).not.toBeChecked({ timeout: 5_000 })

    // Scale slot selector and options reappear; following indicator gone
    await expect(visibleTestId(user2Page, 'scale-slot-select')).toBeVisible({ timeout: 10_000 })
    await expect(followingIndicatorAll).toHaveCount(0)
    await openScaleSlotMenu(user2Page)
    await expect(visibleTestId(user2Page, 'scale-slot-1')).toBeVisible({ timeout: 10_000 })
    await expect(visibleTestId(user2Page, 'scale-slot-2')).toBeVisible({ timeout: 10_000 })
    await user2Page.keyboard.press('Escape').catch(() => undefined)

    // user2 is free to select their own slot again
    await selectScaleSlot(user2Page, 1)
    await expect(followingIndicatorAll).toHaveCount(0)
  })
})
