/**
 * E2E Tests: WebRTC voice mesh — cross-browser compatibility.
 *
 * Covers Firefox and WebKit separately because each has different fake-media
 * support. Chromium coverage lives in webrtc-voice-mesh.spec.ts.
 *
 * Only engine-specific real-media behavior lives here — socket-driven behavior
 * (member visibility, mute-state broadcast) is engine-agnostic and covered once
 * on Chromium in webrtc-voice-mesh.spec.ts + voiceStateStore.test.ts.
 *
 * Firefox:
 *   - Fake media via firefoxUserPrefs in playwright.config.ts
 *   - Tests: voice "Connected" indicator, retry reconnection
 *
 * WebKit:
 *   - No native fake-media flag; getUserMedia mocked via addInitScript
 *   - Tests: voice settings UI structure
 *
 * Latency display/breakdown formatting is unit-covered by RTCLatencyDisplay.test.tsx
 * and VoiceInfo.test.tsx — not re-asserted here; "do stats flow" is proven by the
 * kept Firefox "Connected" test.
 *
 * All tests use the same helpers as the Chromium spec.
 */

import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'
import { enterRoom, injectFakeGetUserMedia } from './webrtc-interop-helpers'

// ─── Firefox Tests ────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' })

test.describe('Firefox Voice Mesh — peer visibility & voice state', () => {
  test.skip(({ browserName }) => browserName !== 'firefox', 'Firefox cross-browser tests run on Firefox only')

  let roomId: string

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const room = await createRoomViaAPI(page, {
      name: `E2E Firefox WebRTC ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    roomId = room.id
  })

  test('voice connection indicator reaches connected state when 2+ users are in room (Firefox)', async ({
    page,
    user2Page,
  }) => {
    await enterRoom(page, roomId)
    await enterRoom(user2Page, roomId)

    // Firefox fake media (media.navigator.streams.fake=true) provides a real audio track,
    // allowing the full WebRTC offer/answer/ICE flow to complete.
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 25_000 })
    await expect(user2Page.locator('[title^="Connected"]')).toBeVisible({ timeout: 25_000 })
  })

  test('retry button reconnects peers (Firefox)', async ({ page, user2Page }) => {
    const id1 = await enterRoom(page, roomId)
    const id2 = await enterRoom(user2Page, roomId)

    await expect(page.getByTestId(`room-member-${id2.userId}`)).toBeVisible({ timeout: 12_000 })
    await expect(user2Page.getByTestId(`room-member-${id1.userId}`)).toBeVisible({ timeout: 12_000 })

    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 25_000 })

    // Open voice info popup (ℹ button) and trigger retry — Voice Mesh
    // diagnostics moved here from the old Voice Settings popover.
    const infoBtn = page.getByTestId('voice-info-btn')
    await expect(infoBtn).toBeVisible({ timeout: 10_000 })
    await infoBtn.click()

    const retryBtn = page.getByTestId('voice-info-mesh-retry-btn')
    await expect(retryBtn).toBeVisible({ timeout: 8_000 })
    await expect(retryBtn).toBeEnabled()
    await retryBtn.click()

    // After retry the mesh should re-establish — indicator must remain (or return to) Connected.
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 20_000 })
  })
})

// ─── WebKit Tests ─────────────────────────────────────────────────────────────

test.describe('WebKit Voice Mesh — getUserMedia mock & structural checks', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'WebKit structural tests run on WebKit only')

  let roomId: string

  test.beforeEach(async ({ page, user2Page }) => {
    // Inject getUserMedia mock before any page navigation so it's ready on first load.
    await Promise.all([
      injectFakeGetUserMedia(page),
      injectFakeGetUserMedia(user2Page),
    ])

    await page.goto('/')
    const room = await createRoomViaAPI(page, {
      name: `E2E WebKit WebRTC ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    roomId = room.id
  })

  test('voice settings popup renders correctly with data-testids (WebKit)', async ({ page, user2Page }) => {
    const id1 = await enterRoom(page, roomId)
    const id2 = await enterRoom(user2Page, roomId)

    await expect(page.getByTestId(`room-member-${id2.userId}`)).toBeVisible({ timeout: 15_000 })
    await expect(user2Page.getByTestId(`room-member-${id1.userId}`)).toBeVisible({ timeout: 15_000 })

    // Voice must reach "Connected" before the info section appears.
    // With a mocked getUserMedia the mesh should establish on localhost ICE.
    await expect(page.locator('[title^="Connected"]')).toBeVisible({ timeout: 30_000 })

    // Open the Voice Info popup (ℹ button) — Voice Mesh diagnostics were moved
    // here from the old Voice Settings popover.
    const infoBtn = page.getByTestId('voice-info-btn')
    await expect(infoBtn).toBeVisible({ timeout: 10_000 })
    await infoBtn.click()

    // Voice Mesh section is conditionally rendered when isVoiceConnected && onRetryConnections are both true
    const voiceMeshSection = page.getByTestId('voice-info-mesh-section')
    await expect(voiceMeshSection).toBeVisible({ timeout: 10_000 })

    // Peer count must follow "X/Y peers connected" format
    const peerCountText = page.getByTestId('voice-info-mesh-peer-count')
    await expect(peerCountText).toBeVisible({ timeout: 10_000 })
    await expect(peerCountText).toContainText('peers connected')

    // Retry button must be present and enabled
    const retryBtn = page.getByTestId('voice-info-mesh-retry-btn')
    await expect(retryBtn).toBeVisible({ timeout: 5_000 })
    await expect(retryBtn).toBeEnabled()
  })
})
