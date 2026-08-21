/**
 * E2E Tests: room member status sync across Perform and Arrange rooms.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'Room member realtime status E2E runs on chromium only')

type RoomType = 'perform' | 'arrange'
type UserIdentity = { userId: string; username: string }

async function gotoStable(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' })
  await page.waitForLoadState('load')
}

async function readUserIdentity(page: Page): Promise<UserIdentity> {
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
  }, { timeout: 15_000 }).then((handle) => handle.jsonValue() as Promise<UserIdentity>)
}

async function enterRoomAsBandMember(page: Page, roomId: string, roomType: RoomType): Promise<UserIdentity> {
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

function memberCard(page: Page, userId: string): Locator {
  return page.getByTestId(`room-member-${userId}`)
}

async function expectMembersSeeEachOther(ownerPage: Page, memberPage: Page, owner: UserIdentity, member: UserIdentity): Promise<void> {
  await expect(memberCard(ownerPage, member.userId)).toContainText(member.username, { timeout: 20_000 })
  await expect(memberCard(memberPage, owner.userId)).toContainText(owner.username, { timeout: 20_000 })
}

async function toggleMicMuteAndExpectSynced(senderPage: Page, observerPage: Page, senderId: string): Promise<void> {
  await senderPage.getByTestId('voice-mic-toggle').click()
  await expect(observerPage.getByTestId(`room-member-mic-muted-${senderId}`)).toBeVisible({ timeout: 20_000 })

  await senderPage.getByTestId('voice-mic-toggle').click()
  await expect(observerPage.getByTestId(`room-member-mic-muted-${senderId}`)).toBeHidden({ timeout: 20_000 })
}

async function changePerformInstrument(senderPage: Page, observerPage: Page, senderId: string): Promise<void> {
  await senderPage
    .getByRole('button', { name: /Acoustic Grand Piano|Bright Acoustic Piano|Electric Guitar \(Clean\)|Select instrument/ })
    .click()
  await senderPage.getByPlaceholder('Search instruments...').fill('Electric Guitar (Clean)')
  await senderPage.getByText('Electric Guitar (Clean)', { exact: true }).click()
  await expect(observerPage.getByTestId(`room-member-instrument-${senderId}`)).toContainText(
    /electric guitar/i,
    { timeout: 20_000 },
  )
}

test.describe('Room member status sync', () => {
  test('Perform Room syncs owner, mic mute, shadow capture, practice state, and selected instrument name', async ({ page, user2Page }) => {
    await gotoStable(page, '/')
    const owner = await readUserIdentity(page)
    const room = await createRoomViaAPI(page, {
      name: `E2E Member Sync Perform ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    await gotoStable(page, `/perform/${room.id}`)
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    const member = await enterRoomAsBandMember(user2Page, room.id, 'perform')
    await expectMembersSeeEachOther(page, user2Page, owner, member)

    await expect(user2Page.getByTestId(`room-member-owner-status-${owner.userId}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId(`room-member-instrument-${member.userId}`)).toBeVisible({ timeout: 20_000 })
    await changePerformInstrument(user2Page, page, member.userId)

    await toggleMicMuteAndExpectSynced(user2Page, page, member.userId)

    await user2Page.getByRole('button', { name: 'Switch instrument to practice mode' }).click()
    await expect(page.getByTestId(`room-member-practice-status-${member.userId}`)).toBeVisible({ timeout: 20_000 })

    await user2Page.getByRole('button', { name: /Record/ }).click()
    await user2Page.getByLabel('Enable Shadow Buffer').click()
    await expect(page.getByTestId(`room-member-shadow-capture-${member.userId}`)).toBeVisible({ timeout: 20_000 })
  })

  test('Arrange Room syncs owner, mic mute, and monitor share status', async ({ page, user2Page }) => {
    await gotoStable(page, '/')
    const owner = await readUserIdentity(page)
    const room = await createRoomViaAPI(page, {
      name: `E2E Member Sync Arrange ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })

    await gotoStable(page, `/arrange/${room.id}`)
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    const member = await enterRoomAsBandMember(user2Page, room.id, 'arrange')
    await expectMembersSeeEachOther(page, user2Page, owner, member)

    await expect(user2Page.getByTestId(`room-member-owner-status-${owner.userId}`)).toBeVisible({ timeout: 20_000 })

    // Allow arrange sync service and arrange namespace socket to fully initialize
    // before exercising voice mute sync. The arrange socket may still be setting
    // up its listeners immediately after the member list appears.
    await page.waitForTimeout(2_000)

    await toggleMicMuteAndExpectSynced(user2Page, page, member.userId)

    await user2Page.getByRole('button', { name: '+ Add Track' }).click()
    await user2Page.getByRole('button', { name: /Instrument Track/ }).click()
    await user2Page.getByRole('button', { name: 'Monitor Share' }).click()
    await expect(page.getByTestId(`room-member-monitor-share-status-${member.userId}`)).toBeVisible({ timeout: 20_000 })
  })
})
