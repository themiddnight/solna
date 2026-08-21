/**
 * E2E Tests: Lobby — room creation and navigation
 *
 * Covers the two create-room flows (Perform + Arrange) and verifies
 * that the user lands in the correct room after creation.
 */
import { test, expect } from '../fixtures/e2e-test'
import type { Page } from '@playwright/test'
import { v4 as uuidv4 } from 'uuid'

async function gotoLobby(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('load')
  await expect(page.getByTestId('lobby-create-perform-card')).toBeVisible({ timeout: 15_000 })
}

// Uses default storageState (user1) — already logged in
test.describe('Lobby: Create Perform Room', () => {
  test('clicking Perform card → modal opens with correct title → creates room → navigates to /perform/:id', async ({
    page,
  }) => {
    await gotoLobby(page)

    // Click the Perform card using testid
    await page.getByTestId('lobby-create-perform-card').click()

    // Modal should open — verify the visible hero title (the Radix Dialog also
    // renders an sr-only <h2> title for a11y, so scope to the figure heading).
    await expect(
      page.getByRole('figure').getByRole('heading', { name: 'Create Perform Room' }),
    ).toBeVisible({ timeout: 8_000 })

    // Fill room name with a unique value to avoid collisions
    const roomName = `E2E Perform ${uuidv4().slice(0, 8)}`
    await page.getByPlaceholder('Enter room name').fill(roomName)

    // Submit
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Should navigate to the perform room
    await expect(page).toHaveURL(/\/perform\//, { timeout: 20_000 })
  })
})

test.describe('Lobby: Create Arrange Room', () => {
  test('clicking Arrange card → modal opens with correct title → creates room → navigates to /arrange/:id', async ({
    page,
  }) => {
    await gotoLobby(page)

    // Click the Arrange card using testid
    await page.getByTestId('lobby-create-arrange-card').click()

    // Modal should open — verify the visible hero title (the Radix Dialog also
    // renders an sr-only <h2> title for a11y, so scope to the figure heading).
    await expect(
      page.getByRole('figure').getByRole('heading', { name: 'Create Arrange Room' }),
    ).toBeVisible({ timeout: 8_000 })

    // Fill room name
    const roomName = `E2E Arrange ${uuidv4().slice(0, 8)}`
    await page.getByPlaceholder('Enter room name').fill(roomName)

    // Submit
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Should navigate to the arrange room
    await expect(page).toHaveURL(/\/arrange\//, { timeout: 20_000 })
  })
})

// NOTE: the former "Lobby: Room list → search input filters visible room cards"
// e2e was removed (DEV-225). It only asserted the input's own value (native React
// controlled-input behavior); the real search filter is server-side and covered by
// RoomDiscoveryService.test.ts ("should filter by text search") + SearchPagination.test.ts.

// NOTE: the former "Lobby: Hidden rooms (BR-4)" e2e ("hidden rooms do not appear in the
// public room list") was removed (DEV-225). Excluding hidden (and isolated) rooms from the
// lobby list is a server rule, now covered by the backend test
// RoomLifecycleService.listExclusion.test.ts ("excludes hidden and isolated rooms").
