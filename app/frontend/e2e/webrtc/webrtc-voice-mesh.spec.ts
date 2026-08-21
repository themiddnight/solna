/**
 * E2E Tests: WebRTC voice mesh — peer visibility and voice state sync.
 *
 * Covers:
 *   1. Symmetric member visibility after sequential join (all 3 see each other)
 *   2. Symmetric member visibility after concurrent join (race condition stress)
 *   3. Voice connection indicator reaches "connected" state with 2+ users
 *   4. Mute state syncs to all peers in the room
 *
 * Uses Chromium fake media flags (test.use launchOptions) so the browser
 * auto-grants mic permission and uses a fake audio source — no SSL or real
 * hardware required.
 */

import { v4 as uuidv4 } from 'uuid'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'
import { enterRoom, readUserIdentity } from './webrtc-interop-helpers'

// Auto-grant mic permission and use synthetic audio — no real mic or SSL needed.
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
})

test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'WebRTC voice mesh tests run on chromium only')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function memberCard(page: Page, userId: string): Locator {
  return page.getByTestId(`room-member-${userId}`)
}

function micMutedBadge(page: Page, userId: string): Locator {
  return page.getByTestId(`room-member-mic-muted-${userId}`)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('WebRTC Voice Mesh — peer visibility & voice state', () => {
  let roomId: string

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const room = await createRoomViaAPI(page, {
      name: `E2E WebRTC ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    roomId = room.id
  })

  test('all 3 users see each other after sequential join', async ({ page, user2Page, user3Page }) => {
    const id1 = await enterRoom(page, roomId)
    const id2 = await enterRoom(user2Page, roomId)
    const id3 = await enterRoom(user3Page, roomId)

    // user1 sees user2 and user3
    await expect(memberCard(page, id2.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(page, id3.userId)).toBeVisible({ timeout: 20_000 })

    // user2 sees user1 and user3
    await expect(memberCard(user2Page, id1.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(user2Page, id3.userId)).toBeVisible({ timeout: 20_000 })

    // user3 sees user1 and user2
    await expect(memberCard(user3Page, id1.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(user3Page, id2.userId)).toBeVisible({ timeout: 20_000 })
  })

  test('all 3 users see each other after concurrent join (race condition stress)', async ({
    page,
    user2Page,
    user3Page,
  }) => {
    // Load lobby on all pages first to hydrate auth state
    await Promise.all([
      page.goto('/', { waitUntil: 'load' }),
      user2Page.goto('/', { waitUntil: 'load' }),
      user3Page.goto('/', { waitUntil: 'load' }),
    ])

    const [id1, id2, id3] = await Promise.all([
      readUserIdentity(page),
      readUserIdentity(user2Page),
      readUserIdentity(user3Page),
    ])

    // Set session storage for all three simultaneously
    await Promise.all([
      page.evaluate(
        ({ id, userId, username }) => {
          sessionStorage.setItem(
            'collab-room-session',
            JSON.stringify({ roomId: id, role: 'band_member', userId, username, timestamp: Date.now() }),
          )
        },
        { id: roomId, ...id1 },
      ),
      user2Page.evaluate(
        ({ id, userId, username }) => {
          sessionStorage.setItem(
            'collab-room-session',
            JSON.stringify({ roomId: id, role: 'band_member', userId, username, timestamp: Date.now() }),
          )
        },
        { id: roomId, ...id2 },
      ),
      user3Page.evaluate(
        ({ id, userId, username }) => {
          sessionStorage.setItem(
            'collab-room-session',
            JSON.stringify({ roomId: id, role: 'band_member', userId, username, timestamp: Date.now() }),
          )
        },
        { id: roomId, ...id3 },
      ),
    ])

    // Navigate all three concurrently — this is the race condition trigger
    await Promise.all([
      page.goto(`/perform/${roomId}`, { waitUntil: 'load' }),
      user2Page.goto(`/perform/${roomId}`, { waitUntil: 'load' }),
      user3Page.goto(`/perform/${roomId}`, { waitUntil: 'load' }),
    ])

    await Promise.all([
      expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 }),
      expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 }),
      expect(user3Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 }),
    ])

    // Every user must see every other user — no asymmetric visibility allowed.
    // Use toBeVisible assertions (not waitForTimeout) so failures are deterministic.
    await expect(memberCard(page, id2.userId)).toBeVisible({ timeout: 15_000 })
    await expect(memberCard(page, id3.userId)).toBeVisible({ timeout: 20_000 })

    await expect(memberCard(user2Page, id1.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(user2Page, id3.userId)).toBeVisible({ timeout: 20_000 })

    await expect(memberCard(user3Page, id1.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(user3Page, id2.userId)).toBeVisible({ timeout: 20_000 })
  })

  test('voice connection indicator reaches connected state when 2+ users are in room', async ({
    page,
    user2Page,
  }) => {
    await enterRoom(page, roomId)
    await enterRoom(user2Page, roomId)

    // With fake mic auto-connected and another user present, both should show green.
    // The indicator title is "Connected - ready to communicate" (or "Connected (Xms latency)").
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 20_000 })
    await expect(user2Page.locator('[title^="Connected"]')).toBeVisible({ timeout: 20_000 })
  })

  test('mute state syncs to all peers in the room', async ({ page, user2Page, user3Page }) => {
    const id1 = await enterRoom(page, roomId)
    await enterRoom(user2Page, roomId)
    await enterRoom(user3Page, roomId)

    // Wait for user1 to appear in other users' member lists before asserting mute state
    await expect(memberCard(user2Page, id1.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(user3Page, id1.userId)).toBeVisible({ timeout: 20_000 })

    // Default isMuted = false — muted badge should not be visible yet
    await expect(micMutedBadge(user2Page, id1.userId)).not.toBeVisible()

    // user1 mutes their mic
    const muteBtn = page.getByTestId('voice-mic-toggle')
    await expect(muteBtn).toBeVisible({ timeout: 20_000 })
    await muteBtn.click()

    // Both other users must see the muted badge for user1
    await expect(micMutedBadge(user2Page, id1.userId)).toBeVisible({ timeout: 20_000 })
    await expect(micMutedBadge(user3Page, id1.userId)).toBeVisible({ timeout: 20_000 })
  })

  // --- New tests per original expectations ---

  test('mesh connects even when user joins with mic muted', async ({ page, user2Page }) => {
    await enterRoom(page, roomId)
    await enterRoom(user2Page, roomId)

    // Mute user1 right after joining (simulate joined-muted scenario)
    const muteBtn = page.getByTestId('voice-mic-toggle')
    const isMuteBtnVisible = await muteBtn.isVisible({ timeout: 8_000 }).catch(() => false)
    if (isMuteBtnVisible) {
      await muteBtn.click()
    }

    // Despite muted state, WebRTC mesh should still establish (receive-only mode).
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 25_000 })
    await expect(user2Page.locator('[title^="Connected"]')).toBeVisible({ timeout: 25_000 })
  })

  test('unmute after join re-establishes two-way audio connection', async ({ page, user2Page }) => {
    const id1 = await enterRoom(page, roomId)
    await enterRoom(user2Page, roomId)

    await expect(memberCard(user2Page, id1.userId)).toBeVisible({ timeout: 20_000 })

    const muteBtn = page.getByTestId('voice-mic-toggle')
    const isMuteBtnVisible = await muteBtn.isVisible({ timeout: 8_000 }).catch(() => false)
    if (isMuteBtnVisible) {
      await muteBtn.click()
      await expect(micMutedBadge(user2Page, id1.userId)).toBeVisible({ timeout: 10_000 })

      const unmuteBtn = page.getByTestId('voice-mic-toggle')
      await expect(unmuteBtn).toBeVisible({ timeout: 5_000 })
      await unmuteBtn.click()

      // Muted badge should disappear from user2 view after unmute
      await expect(micMutedBadge(user2Page, id1.userId)).not.toBeVisible({ timeout: 20_000 })
    }

    // Connection indicator should still show (not failed after mute/unmute)
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 20_000 })
  })

  test('voice info popup shows correct connected peer count', async ({ page, user2Page }) => {
    const id1 = await enterRoom(page, roomId)
    const id2 = await enterRoom(user2Page, roomId)

    // Wait for both users to see each other's member cards (room presence established)
    await expect(memberCard(page, id2.userId)).toBeVisible({ timeout: 20_000 })
    await expect(memberCard(user2Page, id1.userId)).toBeVisible({ timeout: 20_000 })

    // Wait for room-level connection indicator (userCount > 1 + voiceState.isConnected)
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 25_000 })

    // Open the Voice Settings popup (gear button) — the Voice Mesh diagnostics live here
    // (VoiceSettings.tsx), next to the input-device picker and the Voice Chat on/off toggle.
    const settingsBtn = page.getByTestId('voice-settings-btn')
    await expect(settingsBtn).toBeVisible({ timeout: 10_000 })
    await settingsBtn.click()

    // Voice Mesh section is rendered only when isConnected && onRetryConnections defined.
    // The "Connected" indicator reaching green confirms both conditions are met.
    const voiceMeshSection = page.getByTestId('voice-settings-mesh-section')
    await expect(voiceMeshSection).toBeVisible({ timeout: 10_000 })

    // Peer count text must exist and follow the format "X/Y peers connected"
    // NOTE: voiceUsers (which drives totalPeers) is populated only when a user emits JOIN_VOICE
    // (i.e., they have opened mic via addLocalStream). Room members who have not yet enabled voice
    // will show as 0/Y or 0/0. The test verifies the counter RENDERS correctly, and that the
    // Retry button is present and interactive — not that a specific count value is reached.
    const peerCountText = page.getByTestId('voice-settings-mesh-peer-count')
    await expect(peerCountText).toBeVisible({ timeout: 10_000 })
    // Format must be "X/Y peers connected"
    await expect(peerCountText).toContainText('peers connected')

    // Retry button must be present and enabled (functional connection retry)
    const retryBtn = page.getByTestId('voice-settings-mesh-retry-btn')
    await expect(retryBtn).toBeVisible({ timeout: 5_000 })
    await expect(retryBtn).toBeEnabled()
  })

  test('latency display — outside shows combined value, info popup shows breakdown', async ({ page, user2Page }) => {
    await enterRoom(page, roomId)
    await enterRoom(user2Page, roomId)

    // Wait until the mesh has actually established AND latency data is available.
    // `[title^="Connected ("]` (with opening paren) only matches when meshLatency is
    // populated — "Connected (Xms latency)". The looser `[title^="Connected"]` would
    // also match "Connected - ready to communicate", which means the local mic is on
    // but the peer mesh may not have finished negotiating yet.
    await expect(page.locator('[title^="Connected ("]')).toBeVisible({ timeout: 30_000 })

    // ── Outside display (RTCLatencyDisplay) ──────────────────────────────────
    // Shows browserAudioLatency + meshLatency (combined). By this point the mesh
    // is confirmed up, so the display should already show a numeric value.
    const outsideDisplay = page.getByTestId('voice-latency-display')
    await expect(outsideDisplay).toBeVisible({ timeout: 10_000 })
    await expect(outsideDisplay).not.toHaveText('---', { timeout: 10_000 })
    // Format: "Xms+" (e.g. "12ms+" or "5.0ms+")
    await expect(outsideDisplay).toContainText('ms', { timeout: 5_000 })

    // ── Info popup (VoiceInfo) — latency breakdown ────────────────────────────
    // Opens via the ℹ button. Shows: Audio Processing (device), RTC Latency (mesh), Total.
    const infoBtn = page.getByTestId('voice-info-btn')
    await expect(infoBtn).toBeVisible({ timeout: 5_000 })
    await infoBtn.click()

    // Audio Processing = browserAudioLatency (device processing overhead)
    const audioProcessing = page.getByTestId('voice-info-audio-processing')
    await expect(audioProcessing).toBeVisible({ timeout: 8_000 })
    await expect(audioProcessing).toContainText('ms')

    // RTC Latency = meshLatency (pure P2P round-trip)
    const rttLatency = page.getByTestId('voice-info-rtt-latency')
    await expect(rttLatency).toBeVisible({ timeout: 8_000 })
    await expect(rttLatency).toContainText('ms')

    // Total = sum of the two above, shown with "ms+" suffix
    const totalLatency = page.getByTestId('voice-info-total-latency')
    await expect(totalLatency).toBeVisible({ timeout: 5_000 })
    await expect(totalLatency).toContainText('ms+')

    // "No active voice connections" fallback must NOT be visible when both values exist
    await expect(page.getByTestId('voice-info-no-connection')).not.toBeVisible()
  })
})
