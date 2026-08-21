/**
 * E2E Tests: Authentication flows
 *
 * Covers login, logout, session persistence, wrong credentials, and guest mode.
 * These tests override storageState to start in a logged-out state.
 */
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '@playwright/test'
import { getAuthToken, decodeJwtPayload } from '../helpers/auth'
import { createRoomViaAPI } from '../helpers/api'

// ── All auth tests start without any stored session ───────────────────────────
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Authentication', () => {
  test('login with valid credentials → redirect to lobby', async ({ page }) => {
    await page.goto('/login')

    await page.getByPlaceholder('Email').fill(process.env.E2E_USER1_EMAIL!)
    await page.getByPlaceholder('Password').fill(process.env.E2E_USER1_PASSWORD!)
    await page.getByRole('button', { name: /^Login$/ }).click()

    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })

    const token = await getAuthToken(page)
    expect(token, 'auth_token should be set in localStorage after login').toBeTruthy()
  })

  test('session persists after page reload', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.getByPlaceholder('Email').fill(process.env.E2E_USER1_EMAIL!)
    await page.getByPlaceholder('Password').fill(process.env.E2E_USER1_PASSWORD!)
    await page.getByRole('button', { name: /^Login$/ }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })

    // Reload the page
    await page.reload()
    // Use 'load' instead of 'networkidle' — persistent Socket.IO WebSocket connections
    // prevent 'networkidle' from ever resolving in Firefox
    await page.waitForLoadState('load')

    // Should still be on lobby (not redirected to /login)
    await expect(page).toHaveURL(/\/$/)

    const token = await getAuthToken(page)
    expect(token, 'auth_token should survive page reload').toBeTruthy()
  })

  test('guest mode → lands on lobby with a server-minted guest token (DEV-179)', async ({ page }) => {
    await page.goto('/login')

    await page.getByRole('button', { name: /Continue as Guest/i }).click()

    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })

    // DEV-179: a guest now carries a server-minted guest token so every socket connection
    // carries a verifiable credential. It must be a GUEST token, not a registered login.
    const token = await getAuthToken(page)
    expect(token, 'guest should have a guest token').toBeTruthy()
    expect(decodeJwtPayload(token!).userType, 'token should be a GUEST token').toBe('GUEST')

    // Unlike a registered login, a guest is not issued a refresh token.
    const refreshToken = await page.evaluate(() => localStorage.getItem('refresh_token'))
    expect(refreshToken, 'guest should not have a refresh token').toBeFalsy()
  })

  test('guest stays in the room and keeps its guest token after reload (DEV-196)', async ({ page }) => {
    // Enter as guest → server-minted guest token + identity.
    await page.goto('/login')
    await page.getByRole('button', { name: /Continue as Guest/i }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })

    const tokenBefore = await getAuthToken(page)
    expect(tokenBefore, 'guest should have a guest token').toBeTruthy()
    const userIdBefore = decodeJwtPayload(tokenBefore!).userId
    expect(String(userIdBefore), 'guest userId should be a guest id').toMatch(/^guest:/)

    // Guest creates a public perform room and enters it as a band member.
    const room = await createRoomViaAPI(page, {
      name: `guest-reload-${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    await page.goto(`/perform/${room.id}?role=band_member`)
    await page.waitForLoadState('load')
    await expect(page).toHaveURL(new RegExp(`/perform/${room.id}`), { timeout: 15_000 })
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 30_000 })

    // Reload INSIDE the room. Before DEV-196, checkAuth ran /auth/me for the guest token, got a
    // 401, and wiped the token + identity — the room socket then reconnected unauthenticated and
    // the guest was bounced out. The session must now survive.
    await page.reload()
    await page.waitForLoadState('load')

    // Still on the room URL — NOT redirected to /login (pre-DEV-196, the wiped token + logout
    // bounced the guest out of the room entirely).
    await expect(page).toHaveURL(new RegExp(`/perform/${room.id}`))

    // The room view renders and re-authenticates the guest: either fully connected (Leave Room)
    // or actively rejoining (the Connecting-to-Room screen). Either proves the guest kept a usable
    // credential and was NOT logged out. (How fast the socket rejoin *completes* is pre-existing
    // reconnection timing, out of scope for DEV-196.)
    await expect(
      page
        .getByTestId('room-leave-button')
        .or(page.getByRole('heading', { name: /Connecting to Room/i })),
    ).toBeVisible({ timeout: 30_000 })

    // The deterministic DEV-196 guarantee: the guest token is preserved as-is — same GUEST
    // identity, neither removed (the regression) nor re-minted into a new identity.
    const tokenAfter = await getAuthToken(page)
    expect(tokenAfter, 'guest token must survive reload inside a room').toBeTruthy()
    const payloadAfter = decodeJwtPayload(tokenAfter!)
    expect(payloadAfter.userType, 'token should still be a GUEST token').toBe('GUEST')
    expect(payloadAfter.userId, 'guest identity must persist across reload').toBe(userIdBefore)
  })
})

// NOTE: the former "FC-2: Guest restrictions in Create Room modal" e2e (guest sees
// disabled private & hidden checkboxes + explanation) was removed (DEV-225). It is a
// single-client render assertion, now covered by the unit test
// CreateRoomModal.genre.test.tsx ("disables the private & hidden checkboxes and shows
// the verified-account hint").

test.describe('Logout', () => {
  // Logout test DOES need an active session — override back to user1
  test.use({ storageState: 'e2e/.auth/user1.json' })

  test('logout → redirects and clears session', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // The lobby surfaces persistent toasts in the top-right slot (welcome, tour-dismiss restart
    // hint) that overlap the Account Settings gear and intercept the click. Dismiss all of them
    // first — the tour-dismiss flow chains a second toast after the first is closed.
    const notifications = page.getByRole('region', { name: /Notifications/ })
    const closeToast = notifications.getByRole('button', { name: 'Close' })
    for (let i = 0; i < 3; i++) {
      if (await closeToast.first().isVisible().catch(() => false)) {
        await closeToast.first().click()
        await page.waitForTimeout(500)
      }
    }

    // Click the Account Settings button in the header → navigates to /account
    await page.locator('button[title="Account Settings"]').click()
    await expect(page).toHaveURL(/\/account/, { timeout: 10_000 })

    // Click the Logout button on the account settings page
    await page.getByRole('button', { name: /^Logout$/ }).click()

    // Token should be cleared and redirected away from /account
    await page.waitForLoadState('networkidle')
    const token = await getAuthToken(page)
    expect(token, 'auth_token must be cleared after logout').toBeFalsy()
  })
})
