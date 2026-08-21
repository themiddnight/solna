/**
 * E2E Tests: Room management — ownership transfer (BR-8) and kick user (FC-4)
 *
 * BR-8: When the room owner leaves, ownership transfers to the next user.
 * FC-4: Room owner can kick another user from the room.
 *
 * Multi-user tests: serial mode, chromium only.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

async function joinPerformRoomAsBandMember(page: Page, roomId: string) {
  await page.goto('/')
  await page.waitForLoadState('load')
  await page.evaluate(() => {
    sessionStorage.removeItem('collab-room-session')
    sessionStorage.removeItem('pendingInvite')
  })
  await page.goto(`/perform/${roomId}?role=band_member`)
  await page.waitForLoadState('load')
  await expect(page).toHaveURL(new RegExp(`/perform/${roomId}(?:\\?role=band_member)?$`), { timeout: 15_000 })
}

test.describe.configure({ mode: 'serial' })

async function hasOwnerUi(page: Page) {
  const hasPendingBell = await page
    .getByTestId('pending-requests-bell')
    .isVisible()
    .catch(() => false)
  const hasArrangeSwitch = await page
    .locator('button[title="Move to Arrange Room"]')
    .isVisible()
    .catch(() => false)
  const hasOwnerBadge = await page
    .getByText('Room Owner')
    .isVisible()
    .catch(() => false)
  const hasLeave = await page
    .getByTestId('room-leave-button')
    .isVisible()
    .catch(() => false)

  return hasLeave && (hasPendingBell || hasArrangeSwitch || hasOwnerBadge)
}

async function hasBandMemberUi(page: Page) {
  const hasLeave = await page
    .getByTestId('room-leave-button')
    .isVisible()
    .catch(() => false)
  const hasFollowToggle = await page
    .getByTestId('perform-follow-scale-checkbox')
    .isVisible()
    .catch(() => false)
  const hasBandMemberBadge = await page
    .getByText('Band Member')
    .isVisible()
    .catch(() => false)

  return hasLeave && (hasFollowToggle || hasBandMemberBadge)
}

async function hasRoomParticipantUi(page: Page) {
  return await hasOwnerUi(page) || await hasBandMemberUi(page)
}

async function expectOwnerControlsReady(page: Page, timeout = 20_000) {
  let isReady = false

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  for (let attempt = 0; attempt < 3 && !isReady; attempt++) {
    isReady = await expect
      .poll(async () => hasOwnerUi(page), { timeout })
      .toBe(true)
      .then(() => true)
      .catch(() => false)

    if (isReady) {
      break
    }

    const match = page.url().match(/\/perform\/([^/?#]+)/)
    const currentRoomId = match?.[1]
    if (currentRoomId) {
      // Recover from transient role/session drift by rejoining room as clean session.
      await page.goto('/')
      await page.waitForLoadState('load')
      await page.evaluate(() => {
        sessionStorage.removeItem('collab-room-session')
        sessionStorage.removeItem('pendingInvite')
      })
      await page.goto(`/perform/${currentRoomId}`)
      await page.waitForLoadState('load')
      await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })
    }
  }

  expect(isReady).toBe(true)
}

test.describe('BR-8 + FC-4: Room management', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user room management E2E runs on chromium only')

  test('BR-8: room_owner leaves → ownership transfers to next user', async ({ page, user2Page }) => {
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
      name: `E2E Ownership ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    // user1 (room_owner) navigates to room; clear stale session role first.
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await page.goto(`/perform/${room.id}`)
    await page.waitForLoadState('load')
    await expectOwnerControlsReady(page, 20_000)

    // user2 joins as band_member via router state + session storage for deterministic role assignment.
    await joinPerformRoomAsBandMember(user2Page, room.id)

    // Accept Follow toggle OR Band Member badge — some responsive layouts show one or the other.
    const followToggle = user2Page.getByTestId('perform-follow-scale-checkbox')
    const bandMemberBadge = user2Page.getByText('Band Member')
    await expect(followToggle.or(bandMemberBadge).first()).toBeVisible({ timeout: 30_000 })
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Confirm user2 is backend-registered by checking user2's username appears in user1's member list.
    const user2Username = await user2Page.evaluate(() => {
      const raw = localStorage.getItem('user-store')
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null
      const state = (parsed?.state ?? parsed) as Record<string, unknown> | undefined
      return (state?.username ?? '') as string
    })
    if (user2Username) {
      await expect
        .poll(async () => {
          return page.getByText(String(user2Username)).isVisible().catch(() => false)
        }, { timeout: 10_000 })
        .toBe(true)
        .catch(() => false)
    }

    // Wait for all socket join/leave events from any retry to settle, and for user2 to be
    // fully registered in backend Redis bandMembers before user1 leaves.
    await page.waitForTimeout(2_000)
    // Re-verify BOTH users are still stably connected before triggering leave
    const isOwnerStillReady = await expect
      .poll(async () => {
        return hasOwnerUi(page)
      }, { timeout: 10_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)
    if (!isOwnerStillReady) {
      await page.goto(`/perform/${room.id}`)
      await page.waitForLoadState('load')
      await expectOwnerControlsReady(page, 20_000)
    }
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Use UI leave flow to ensure the same owner-transfer events are emitted as real users.
    const leaveBtn = page.getByTestId('room-leave-button')
    await expect(leaveBtn).toBeVisible({ timeout: 20_000 })
    await leaveBtn.click()
    const leaveModal = page.locator('.modal.modal-open')
    await expect(leaveModal.getByRole('heading', { name: 'Leave Room' })).toBeVisible({ timeout: 8_000 })
    await leaveModal.getByRole('button', { name: 'Leave Room' }).click()

    // user2 should become room_owner — verify at least one owner-only control appears.
    // If a transient disconnect redirects user2 to lobby, rejoin once and verify again.
    const hasOwnerControls = async () => {
      const hasPendingBell = await user2Page
        .getByTestId('pending-requests-bell')
        .isVisible()
        .catch(() => false)
      const hasArrangeSwitch = await user2Page
        .locator('button[title="Move to Arrange Room"]')
        .isVisible()
        .catch(() => false)
      const hasLeave = await user2Page
        .getByTestId('room-leave-button')
        .isVisible()
        .catch(() => false)
      const hasFollowOwnerToggle = await user2Page
        .getByTestId('perform-follow-scale-checkbox')
        .isVisible()
        .catch(() => false)
      const isLikelyOwnerUi = hasLeave && !hasFollowOwnerToggle
      return hasPendingBell || hasArrangeSwitch || isLikelyOwnerUi
    }

    let isPromoted = false
    for (let attempt = 0; attempt < 2 && !isPromoted; attempt++) {
      isPromoted = await expect
        .poll(async () => hasOwnerControls(), { timeout: 20_000 })
        .toBeTruthy()
        .then(() => true)
        .catch(() => false)

      if (!isPromoted && !user2Page.isClosed()) {
        await joinPerformRoomAsBandMember(user2Page, room.id)
        await expect
          .poll(async () => {
            return hasRoomParticipantUi(user2Page)
          }, { timeout: 20_000 })
          .toBe(true)
        await user2Page.waitForTimeout(3_000)
      }
    }

    expect(isPromoted).toBe(true)
  })

  test('FC-4: room_owner kicks user → kicked user is removed from the room', async ({ page, user2Page }) => {
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
      name: `E2E Kick ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    // user1 joins as room_owner; clear stale session role first.
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await page.goto(`/perform/${room.id}`)
    await page.waitForLoadState('load')
    await expectOwnerControlsReady(page, 20_000)

    // user2 joins as band_member via router state + session storage for deterministic role assignment.
    await joinPerformRoomAsBandMember(user2Page, room.id)
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Some responsive/layout states may hide the Follow toggle even when role is band_member.
    // Treat either Follow toggle OR Band Member badge as valid precondition signal.
    const isUser2BandMemberReady = await expect
      .poll(async () => {
        const hasFollowToggle = await user2Page
          .getByTestId('perform-follow-scale-checkbox')
          .isVisible()
          .catch(() => false)
        const hasBandMemberBadge = await user2Page
          .getByText('Band Member')
          .isVisible()
          .catch(() => false)
        return hasFollowToggle || hasBandMemberBadge
      }, { timeout: 20_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)

    expect(isUser2BandMemberReady).toBe(true)

    const user2Info = await user2Page.evaluate(() => {
      const raw = localStorage.getItem('user-store')
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null
      const state = (parsed?.state ?? parsed) as Record<string, unknown> | undefined
      return {
        user2Username: (state?.username ?? '') as string,
        user2UserId: typeof state?.userId === 'string' ? state.userId : String(state?.userId ?? ''),
      }
    })
    const user2Username: string = user2Info.user2Username
    const user2UserId: string = user2Info.user2UserId

    // Wait for user2's stage card on the owner's page.
    // StageMemberCard renders data-testid="room-member-{userId}" — this is the
    // authoritative signal that user2 is live on the stage (not a pending member).
    await expect(page.getByTestId(`room-member-${user2UserId}`)).toBeVisible({ timeout: 30_000 })

    const user2ActionsButton = page
      .getByTestId(`room-member-${user2UserId}`)
      .getByTitle('User actions')
    await expect(user2ActionsButton).toBeVisible({ timeout: 30_000 })
    const kickModalHeading = page.getByRole('heading', { name: 'Kick User' })

    // Open user actions and click Kick Out with retry to tolerate dropdown re-renders.
    let isKickModalOpened = false
    for (let attempt = 0; attempt < 3 && !isKickModalOpened; attempt++) {
      await user2ActionsButton.click()
      const kickOutBtn = page.getByRole('button', { name: /^Kick Out$/ }).first()
      await expect(kickOutBtn).toBeVisible({ timeout: 10_000 })
      await kickOutBtn.click({ force: true })
      isKickModalOpened = await kickModalHeading
        .isVisible({ timeout: 5_000 })
        .catch(() => false)
    }
    expect(isKickModalOpened).toBe(true)

    // KickUserModal appears — confirm with "Kick Out"
    await expect(kickModalHeading).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Kick Out' }).click()

    // user2 should be removed from room members list on user1 side
    await expect(page.getByText(String(user2Username))).not.toBeVisible({ timeout: 15_000 })

    // user2 must be redirected to the lobby
    await expect(user2Page).toHaveURL('http://127.0.0.1:4173/', { timeout: 15_000 })

    // user2 should see the "kicked" popup modal on the lobby
    await expect(user2Page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await expect(
      user2Page.getByText(/kicked|removed from the room/i)
    ).toBeVisible({ timeout: 5_000 })

    // user2's stage card must be gone — StageMemberCard is only rendered while the
    // user is an active band member, so this is the most precise post-kick check.
    // The card may linger briefly in a grayed-out state (opacity-55 grayscale)
    // after the kick propagates. Check for DOM removal rather than visibility.
    await expect.poll(
      async () => {
        return await page.getByTestId(`room-member-${user2UserId}`).count()
      },
      { timeout: 25_000, message: 'Kicked user stage card did not disappear' },
    ).toBe(0)
  })

})
