/**
 * Shared helpers for WebRTC cross-browser interop E2E specs.
 * Used by both webrtc-interop.spec.ts and webrtc-interop-headless-limited.spec.ts.
 */

import type { Page, Browser, BrowserContext } from '@playwright/test'
import { expect, firefox as playwrightFirefox, webkit as playwrightWebkit } from '@playwright/test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { mockHealthCheck } from '../fixtures/auth-pool'
import { makeAuthHeaders } from '../helpers/auth'

export type UserIdentity = { userId: string; username: string }

type UserStorageInfo = { id: string; email: string; username: string; userType: string }

const FAKE_FIREFOX_PREFS: Record<string, boolean | number | string> = {}
FAKE_FIREFOX_PREFS['media.navigator.streams.fake'] = true
FAKE_FIREFOX_PREFS['media.navigator.permission.disabled'] = true
FAKE_FIREFOX_PREFS['media.autoplay.default'] = 0
FAKE_FIREFOX_PREFS['media.volume_scale'] = '0.0'

/** Inject a silent-oscillator fake MediaStream so getUserMedia never throws on WebKit.
 *
 * Handles two WebKit-specific constraints:
 *  1. navigator.mediaDevices may be null on HTTP (Playwright WebKit doesn't expose it
 *     on insecure origins) — we polyfill the property with Object.defineProperty.
 *  2. AudioContext may be unavailable/restricted in some headless WebKit builds —
 *     we fall back to an empty MediaStream which is still sufficient for ICE/DataChannel.
 */
export async function injectFakeGetUserMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const makeFakeStream = (): MediaStream => {
      try {
        // Use 44100 Hz — the native sample rate for WebKit/Safari
        const ctx = new AudioContext({ sampleRate: 44100 })
        const osc = ctx.createOscillator()
        const dest = ctx.createMediaStreamDestination()
        osc.frequency.value = 0  // silent
        osc.connect(dest)
        osc.start()
        return dest.stream
      } catch {
        // AudioContext unavailable (headless, restricted context, etc.) —
        // return empty stream; ICE and DataChannel still negotiate without audio tracks.
        return new MediaStream()
      }
    }

    const fakeGetUserMedia = async (): Promise<MediaStream> => makeFakeStream()

    const patch = () => {
      const md = navigator.mediaDevices as MediaDevices | null
      if (!md) {
        // Playwright WebKit on HTTP doesn't expose navigator.mediaDevices.
        // Polyfill the property so the app's getUserMedia calls succeed.
        try {
          Object.defineProperty(navigator, 'mediaDevices', {
            value: { getUserMedia: fakeGetUserMedia },
            writable: true,
            configurable: true,
          })
        } catch {
          // defineProperty failed (strict mode / frozen object) — nothing we can do
          console.warn('[E2E] Could not polyfill navigator.mediaDevices on WebKit')
        }
      } else {
        md.getUserMedia = fakeGetUserMedia
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', patch, { once: true })
    } else {
      patch()
    }
  })
}

export async function readUserIdentity(page: Page): Promise<UserIdentity> {
  const handle = await page.waitForFunction<UserIdentity | null>(
    (): UserIdentity | null => {
      try {
        // Registered users persist to localStorage; guests persist to sessionStorage
        // (identityAwareStorage in shared/stores/userStore.ts, 2026-07-04 cross-tab storage
        // invariant). Mirror its own read preference (localStorage wins if both exist) so this
        // helper resolves a fresh guest identity instead of timing out.
        const raw = localStorage.getItem('user-store') ?? sessionStorage.getItem('user-store')
        if (!raw) return null
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const state = (parsed.state ?? {}) as Record<string, unknown>
        if (!state.userId || !state.username) return null
        return { userId: String(state.userId), username: String(state.username) }
      } catch { return null }
    },
    { timeout: 15_000 },
  )
  const result = await handle.jsonValue()
  if (!result) throw new Error('readUserIdentity: user identity not found in localStorage or sessionStorage after timeout')
  return result
}

export async function enterRoomOfType(
  page: Page,
  roomId: string,
  roomType: 'perform' | 'arrange',
): Promise<UserIdentity> {
  await page.goto('/', { waitUntil: 'load' })
  const identity = await readUserIdentity(page)
  const setSession = async () =>
    page.evaluate(
      ({ id, userId, username }) => {
        sessionStorage.setItem(
          'collab-room-session',
          JSON.stringify({ roomId: id, role: 'band_member', userId, username, timestamp: Date.now() }),
        )
      },
      { id: roomId, ...identity },
    )
  await setSession()

  // Navigate to the room. Two Firefox-specific failure modes may occur:
  //
  // 1. NS_ERROR_FAILURE — Firefox throws this when a concurrent client-side
  //    navigation (e.g. Axios offline-guard redirecting to /offline) is still
  //    in progress at the time we call goto. A short wait + retry resolves it.
  //
  // 2. "Something went wrong" ErrorBoundary — Vite's module cache can be
  //    briefly unstable after the previous test's browser (e.g., WebKit)
  //    closed, causing an ES module import to fail. Clicking "Refresh Page"
  //    gives Vite a clean connection and usually resolves it on the next load.
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      await page.goto(`/${roomType}/${roomId}`, { waitUntil: 'load' })
      break
    } catch (err: unknown) {
      if (attempt === 1 || !String((err as Error).message).includes('NS_ERROR_FAILURE')) throw err
      await page.waitForTimeout(1500)
    }
  }

  // Detect ErrorBoundary and recover by reloading via the "Refresh Page" button,
  // then re-navigate so React renders the correct route.
  if (await page.getByRole('heading', { name: 'Something went wrong' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Refresh Page' }).click()
    await page.waitForLoadState('load')
    // sessionStorage is wiped by a hard reload — restore it before re-navigating
    await setSession()
    await page.goto(`/${roomType}/${roomId}`, { waitUntil: 'load' })
  }

  // 35s: covers WebKit/Firefox ErrorBoundary recovery (Vite reconnect + module reload)
  await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 35_000 })
  return identity
}

export async function enterRoom(page: Page, roomId: string): Promise<UserIdentity> {
  return enterRoomOfType(page, roomId, 'perform')
}

export async function continueAsGuest(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'load' })
  await page.getByRole('button', { name: /Continue as Guest/i }).click()
  // Guest identity is server-minted; wait until the store holds it before proceeding.
  await readUserIdentity(page)
}

const API_BASE = (process.env.VITE_API_URL ?? 'http://localhost:3001').replace('localhost', '127.0.0.1')

export async function leaveRoomViaAPI(page: Page, roomId: string): Promise<void> {
  try {
    const headers = await makeAuthHeaders(page)
    const raw: string | null = await page.evaluate(() => localStorage.getItem('user-store')).catch(() => null)
    if (!raw) return
    const parsed: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>
    const state: Record<string, unknown> = (parsed.state ?? {}) as Record<string, unknown>
    const userId: string | undefined = state.userId as string | undefined
    if (!userId) return
    await page.request.post(`${API_BASE}/api/rooms/${roomId}/leave`, {
      headers, data: { userId }, timeout: 6_000,
    }).catch(() => { /* best-effort */ })
  } catch { /* best-effort */ }
}

function getUserInfoFromStorageState(storageStatePath: string): UserStorageInfo {
  type StorageStateOrigin = { localStorage?: Array<{ name: string; value: string }> }
  try {
    const absolutePath = resolve(process.cwd(), storageStatePath)
    const content = readFileSync(absolutePath, 'utf-8')
    const parsed = JSON.parse(content) as { origins?: StorageStateOrigin[] }
    const origins: StorageStateOrigin[] = parsed.origins ?? []
    for (const origin of origins) {
      const ls = origin.localStorage ?? []
      const userStoreItem = ls.find((item) => item.name === 'user-store')
      if (userStoreItem) {
        const storeVal: Record<string, unknown> = JSON.parse(userStoreItem.value) as Record<string, unknown>
        const state: Record<string, unknown> = (storeVal.state ?? {}) as Record<string, unknown>
        const authUser: Record<string, unknown> = (state.authUser ?? {}) as Record<string, unknown>
        return {
          id: String(state.userId ?? authUser.id ?? 'e2e-mock-id'),
          email: String(state.email ?? authUser.email ?? 'e2e.parallel.01@collab.local'),
          username: String(state.username ?? authUser.username ?? 'E2E Mock User'),
          userType: String(state.userType ?? authUser.userType ?? 'REGISTERED'),
        }
      }
    }
  } catch (err) {
    console.error('Error reading storage state:', err)
  }
  return {
    id: 'e2e-mock-id',
    email: 'e2e.parallel.01@collab.local',
    username: 'E2E Mock User',
    userType: 'REGISTERED'
  }
}

async function setupApiProxy(ctx: BrowserContext, userInfo: UserStorageInfo): Promise<void> {
  await ctx.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const urlStr = route.request().url()

    // 1. Health check
    if (urlStr.includes('/api/health')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
      return
    }

    // 2. Presets (expects { presets: [] })
    if (urlStr.includes('/api/user/presets')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"presets":[]}' })
      return
    }

    // 3. User profile / Auth check (expects { user: User })
    if (urlStr.includes('/api/auth/me') || urlStr.includes('/api/user/me')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: userInfo.id,
            email: userInfo.email,
            username: userInfo.username,
            userType: userInfo.userType,
            emailVerified: true,
            profilePictureUrl: null,
            hasPassword: true,
          },
        }),
      })
      return
    }

    // 4. Fallback in-memory mock response
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

/** Launch a Firefox browser with fake media and return browser + context + page. */
export async function launchFirefox(storageState: string): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  const userInfo = getUserInfoFromStorageState(storageState)
  const browser = await playwrightFirefox.launch({ firefoxUserPrefs: FAKE_FIREFOX_PREFS })
  const ctx = await browser.newContext({
    storageState,
    ignoreHTTPSErrors: true,
    bypassCSP: true
  })
  await mockHealthCheck(ctx)
  await setupApiProxy(ctx, userInfo)
  const page = await ctx.newPage()
  page.on('console', async (msg) => {
    if (msg.type() === 'error') {
      const args = await Promise.all(msg.args().map(async (arg) => {
        try { return await arg.jsonValue() as unknown; } catch { return arg.toString(); }
      }));
      console.warn(`[Firefox Console] error:`, ...args);
    } else {
      console.warn(`[Firefox Console] ${msg.type()}: ${msg.text()}`);
    }
  })
  page.on('pageerror', (err) => console.error(`[Firefox PageError] ${err.toString()}`))
  return { browser, ctx, page }
}

/** Launch a WebKit browser and return browser + context + page (with getUserMedia mock). */
export async function launchWebKit(storageState: string): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  const userInfo = getUserInfoFromStorageState(storageState)
  const browser = await playwrightWebkit.launch()
  const ctx = await browser.newContext({
    storageState,
    ignoreHTTPSErrors: true,
    bypassCSP: true
  })
  await mockHealthCheck(ctx)
  await setupApiProxy(ctx, userInfo)
  const page = await ctx.newPage()
  page.on('console', async (msg) => {
    if (msg.type() === 'error') {
      const args = await Promise.all(msg.args().map(async (arg) => {
        try { return await arg.jsonValue() as unknown; } catch { return arg.toString(); }
      }));
      console.warn(`[WebKit Console] error:`, ...args);
    } else {
      console.warn(`[WebKit Console] ${msg.type()}: ${msg.text()}`);
    }
  })
  page.on('pageerror', (err) => console.error(`[WebKit PageError] ${err.toString()}`))
  await injectFakeGetUserMedia(page)
  return { browser, ctx, page }
}
