/**
 * E2E Tests: AI Band Companion & Room Settings Sync (BIZ-11 / DEV-96 - DEV-100)
 *
 * Scope: Perform Room
 * Verifies:
 *   1. Room Owner / Band Member can add, configure, mute, play/stop, and remove AI Companions.
 *   2. Audience role restriction (Read-Only access to Companion controls, cannot add).
 *   3. Real-time sync of Companion additions, updates (instrument, style, play/stop, mute), and removals.
 *   4. Instrument role auto-derivation and ChordDisplay visibility.
 *   5. Time Signature Control in Room Settings (only for room owner, synced in real-time).
 *
 * References: BIZ-11, DEV-96, DEV-97, DEV-98, DEV-99, DEV-100
 */
import { v4 as uuidv4 } from 'uuid'
import { DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'
import { selectRadixOption, expectRadixValue } from '../helpers/ui'
import type { Page } from '@playwright/test'

const visibleTestId = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true }).first()

// Helper to check if companion panel is rendered
async function isCompanionPanelVisible(page: Page): Promise<boolean> {
  return visibleTestId(page, 'companion-panel').isVisible().catch(() => false)
}

async function openCompanionControls(page: Page): Promise<void> {
  const panel = visibleTestId(page, 'companion-panel')
  await expect(panel).toBeVisible({ timeout: 15_000 })

  const chordLength = visibleTestId(page, 'companion-chord-length')
  if (
    await chordLength.isVisible().catch(() => false) ||
    await visibleTestId(page, 'companion-empty-state').isVisible().catch(() => false)
  ) {
    return
  }

  await panel.click()
  await expect.poll(async () => (
    await visibleTestId(page, 'companion-add-button').isVisible().catch(() => false) ||
    await chordLength.isVisible().catch(() => false) ||
    await visibleTestId(page, 'companion-empty-state').isVisible().catch(() => false)
  ), { timeout: 5_000 }).toBe(true)
}

async function clearRoomSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.removeItem('collab-room-session')
    sessionStorage.removeItem('pendingInvite')
  })
}

/** Open the settings popup for a companion and return the button locator */
async function openCompanionSettings(page: Page, companionId: string) {
  const btn = page.getByTestId(`companion-settings-button-${companionId}`)
  await expect(btn).toBeVisible()
  const styleSelect = page.getByTestId(`companion-settings-style-${companionId}`)
  if (!(await styleSelect.isVisible().catch(() => false))) {
    const advancedToggle = page.getByTestId(`companion-settings-advanced-toggle-${companionId}`)
    // "Is the popover open?" — read the trigger's Radix `data-state`, not the content's
    // visibility: the Popover's content lingers (still `isVisible()`) through its ~120ms pop-out
    // close animation, so a visibility check landing in that window would wrongly skip re-opening.
    if ((await btn.getAttribute('data-state')) !== 'open') {
      await btn.click({ force: true })
      await expect(advancedToggle).toBeVisible({ timeout: 5_000 })
    }
    await advancedToggle.click()
    await expect(styleSelect).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(500) // Wait for transition animation of settings panel
  }
}

async function closeCompanionSettings(page: Page, companionId: string) {
  const styleSelect = page.getByTestId(`companion-settings-style-${companionId}`)
  if (!(await styleSelect.isVisible().catch(() => false))) return

  // A just-closed Radix Select (e.g. from selectRadixOption right before this call) keeps its
  // own dismissable layer mounted through its ~120ms pop-out close animation. If that layer is
  // still on the stack when Escape fires, it — not the outer companion-settings Popover —
  // consumes the keypress, leaving the popover open. Retry once after a beat for the animation
  // to finish and the layer to actually unmount.
  await page.keyboard.press('Escape')
  try {
    await expect(styleSelect).not.toBeVisible({ timeout: 2_000 })
  } catch {
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    await expect(styleSelect).not.toBeVisible({ timeout: 5_000 })
  }
  await page.waitForTimeout(500) // Wait for collapse transition animation
}

/** Click "+" then choose a role from the picker to spawn the mapped instrument. */
async function addCompanionViaPicker(page: Page, presetId = 'piano'): Promise<void> {
  const addButton = visibleTestId(page, 'companion-add-button')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  // The picker is a Radix DropdownMenu — its trigger opens on pointerdown, which
  // a synthetic dispatchEvent('click') does not produce; use a real pointer click.
  await addButton.click()
  const preset = page.getByTestId(`companion-add-preset-${presetId}`)
  await expect(preset).toBeVisible({ timeout: 5_000 })
  await preset.click()
}

/** Select an instrument via the popup. Clicks the instrument button, searches, and clicks the match. */
async function selectCompanionInstrument(
  page: Page,
  companionId: string,
  label: string,
  categoryLabel?: string,
) {
  await openCompanionSettings(page, companionId)
  const instrBtn = page.getByTestId(`companion-instrument-${companionId}`)
  await instrBtn.click()
  if (categoryLabel) {
    await page.getByRole('tab', { name: categoryLabel }).click()
  }
  const searchInput = page.locator('input[placeholder="Search instruments..."]').first()
  await expect(searchInput).toBeVisible({ timeout: 5_000 })
  await searchInput.fill(label)
  await page.locator(`button:has-text("${label}")`).first().click()
  // Popup should close
  await expect(searchInput).not.toBeVisible({ timeout: 5_000 })
}

test.describe('BIZ-11: AI Band Companion & Room Settings Sync (Perform Room)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user companion E2E runs on chromium only')

  test('integrated E2E flow for AI Companions and Room Settings', async ({ page, user2Page, user3Page }) => {
    // Increase test timeout to 180 seconds due to multi-user setup & latency to US Redis
    test.setTimeout(180_000)

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 0: Console Capturing and Environment Setup
    // ─────────────────────────────────────────────────────────────────────────
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.warn(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      console.error(`[PAGE EXCEPTION] ${err.message}`);
    });
    user2Page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.warn(`[USER2 ${msg.type().toUpperCase()}] ${msg.text()}`);
      }
    });
    user2Page.on('pageerror', err => {
      console.error(`[USER2 EXCEPTION] ${err.message}`);
    });
    user3Page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.warn(`[USER3 ${msg.type().toUpperCase()}] ${msg.text()}`);
      }
    });
    user3Page.on('pageerror', err => {
      console.error(`[USER3 EXCEPTION] ${err.message}`);
    });

    // Clear session state to prevent role leaking
    for (const p of [page, user2Page, user3Page]) {
      await p.goto('/')
      await p.waitForLoadState('load')
      await clearRoomSession(p)
    }

    // Short settle wait
    await page.waitForTimeout(1_000)

    // User 1 (room owner) creates perform room
    const room = await createRoomViaAPI(page, {
      name: `E2E Companion Room ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    const roomId = room.id

    // User 1 navigates to room
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Wait for the UI to settle
    await expect.poll(() => isCompanionPanelVisible(page), { timeout: 15_000 }).toBe(true)
    await openCompanionControls(page)
    await page.waitForTimeout(3_000)

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Room Owner adds a Companion & Verifies Defaults
    // ─────────────────────────────────────────────────────────────────────────
    // Companion panel must be visible
    await expect(visibleTestId(page, 'companion-panel')).toBeVisible()

    // Default: List must be empty, showing the empty-state message
    await expect(visibleTestId(page, 'companion-empty-state')).toBeVisible()

    // Add Companion via the role picker (Piano → acoustic_grand_piano)
    await addCompanionViaPicker(page, 'piano')

    // Verify companion card is added
    const companionList = page.getByTestId('companion-list')
    await expect(companionList).toBeVisible({ timeout: 10_000 })

    // Find the companion card
    const companionCard = companionList.locator('[data-testid^="companion-card-"]').first()
    await expect(companionCard).toBeVisible({ timeout: 10_000 })

    // Retrieve the dynamic companion ID from data-testid
    const testId = await companionCard.getAttribute('data-testid')
    expect(testId).not.toBeNull()
    const companionId = testId!.replace('companion-card-', '')

    // Verify default parameters:
    // 1. Instrument: Acoustic Grand Piano (check via data attribute)
    await expect(companionCard).toHaveAttribute('data-companion-instrument', 'acoustic_grand_piano')

    // 2. Play state: Verify default is not playing (first companion no longer auto-plays on add)
    const playAllToggle = visibleTestId(page, 'companion-play-all-toggle')
    await expect(playAllToggle).toBeVisible()
    await expect(playAllToggle).toHaveText('Play') // Means it is not playing and action is 'Play'

    // 3. Mute state: Unmuted (isMuted = false)
    const muteToggle = page.getByTestId(`companion-mute-toggle-${companionId}`)
    await expect(muteToggle).toBeVisible()
    await expect(muteToggle).toHaveAttribute('title', 'Mute') // Means it is unmuted and action is 'Mute'

    // Expand the stage controls panel so the room-level ChordDisplay (and chord
    // length) render. The panel now stays open while interacting elsewhere
    // (closeOnOutsideClick=false), so opening the settings popup won't collapse it.
    await openCompanionControls(page)

    // 4. Open settings popup and verify block chord defaults
    await openCompanionSettings(page, companionId)
    const instrumentBtn = page.getByTestId(`companion-instrument-${companionId}`)
    await expect(instrumentBtn).toBeVisible()
    const styleSelect = page.getByTestId(`companion-settings-style-${companionId}`)
    await expectRadixValue(styleSelect, 'block')
    await expectRadixValue(page.getByTestId(`companion-settings-interval-${companionId}`), '1')
    await selectRadixOption(page, page.getByTestId(`companion-settings-interval-${companionId}`), '2')
    await expectRadixValue(page.getByTestId(`companion-settings-interval-${companionId}`), '2')
    await expectRadixValue(page.getByTestId(`companion-settings-gate-${companionId}`), '100')
    await selectRadixOption(page, page.getByTestId(`companion-settings-gate-${companionId}`), '70')
    await expectRadixValue(page.getByTestId(`companion-settings-gate-${companionId}`), '70')
    await page.getByTestId(`companion-settings-sustain-${companionId}`).dispatchEvent('click')
    await expect(page.getByTestId(`companion-settings-sustain-${companionId}`)).toBeChecked({ timeout: 8_000 })

    // 5. Room-level ChordDisplay must be visible and show progression
    // Start playing to enable chord display since current-chord only renders when isAnyPlaying is true
    await visibleTestId(page, 'companion-play-all-toggle').click()

    // ChordDisplay renders in a Popover portal (document root), not inside
    // companion-panel — locate it at page level.
    const chordDisplay = visibleTestId(page, 'chord-display')
    await expect(chordDisplay).toBeVisible()
    await expect(chordDisplay.locator('[data-testid="current-chord"]')).toBeVisible({ timeout: 10_000 })

    // Switch to the Broken playing style and verify arpeggiator controls appear.
    // Arpeggiation is now a "broken" chord style whose default pattern is 'arpeggio'
    // (a cyclic pattern that exposes Rate/Direction), not a top-level 'arp' style.
    await openCompanionSettings(page, companionId)
    await selectRadixOption(page, styleSelect, 'broken')
    await page.waitForTimeout(500) // Wait for transition animation of newly expanded controls
    // Broken mode reveals the pattern picker. The seeded genre preset may pick any
    // cyclic pattern, so select 'arpeggio' explicitly to exercise the arp controls.
    const brokenPatternSelect = page.getByTestId(`companion-settings-broken-pattern-${companionId}`)
    await expect(brokenPatternSelect).toBeVisible()
    await selectRadixOption(page, brokenPatternSelect, 'arpeggio')
    await expectRadixValue(brokenPatternSelect, 'arpeggio')
    await expectRadixValue(page.getByTestId(`companion-settings-arp-rate-${companionId}`), '1/8')
    await selectRadixOption(page, page.getByTestId(`companion-settings-arp-rate-${companionId}`), '1/16')
    await expectRadixValue(page.getByTestId(`companion-settings-arp-rate-${companionId}`), '1/16')
    await expectRadixValue(page.getByTestId(`companion-settings-gate-${companionId}`), '100')
    await expect(page.getByTestId(`companion-settings-octave-${companionId}`)).toHaveText('3')
    await page.getByTestId(`companion-settings-octave-up-${companionId}`).dispatchEvent('click')
    await expect(page.getByTestId(`companion-settings-octave-${companionId}`)).toHaveText('4')
    await page.getByTestId(`companion-settings-sustain-${companionId}`).dispatchEvent('click')
    await expect(page.getByTestId(`companion-settings-sustain-${companionId}`)).toBeChecked({ timeout: 8_000 })
    await page.getByTestId(`companion-settings-root-note-${companionId}`).dispatchEvent('click')
    await expect(page.getByTestId(`companion-settings-root-note-${companionId}`)).toBeChecked({ timeout: 8_000 })

    // Global chord length: 2 bars in 4/4 should render 8 countdown dots
    await selectRadixOption(page, visibleTestId(page, 'companion-chord-length'), '2')
    await expect(chordDisplay.locator('[data-testid="chord-countdown-dots"] span')).toHaveCount(8, { timeout: 10_000 })
    await closeCompanionSettings(page, companionId)

    // Stop playing to restore default stopped state before subsequent phases (Phase 2 & 3)
    await visibleTestId(page, 'companion-play-all-toggle').click()

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Role Restrictions (Audience is Read-Only)
    // ─────────────────────────────────────────────────────────────────────────
    // User 2 joins as audience
    await user2Page.goto(`/perform/${roomId}?role=audience`)
    await user2Page.waitForLoadState('load')
    // Audience members are routed to the dedicated AudienceRoom page (HLS stream view);
    // the companion panel is part of the performer interface and is not shown there
    await expect(user2Page).toHaveURL(new RegExp(`/perform/${roomId}/audience`), { timeout: 20_000 })
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Allow Socket.IO connections to establish and settle
    await Promise.all([page.waitForTimeout(3_000), user2Page.waitForTimeout(3_000)])

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Real-time Sync & Interactive State Changes
    // ─────────────────────────────────────────────────────────────────────────
    await user3Page.goto(`/perform/${roomId}?role=band_member`)
    await user3Page.waitForLoadState('load')
    await expect(user3Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    await expect(visibleTestId(user3Page, 'companion-panel')).toBeVisible({ timeout: 15_000 })
    await openCompanionControls(user3Page)

    // Allow Socket.IO connections to establish and settle
    await Promise.all([page.waitForTimeout(3_000), user3Page.waitForTimeout(3_000)])

    // Verify the companion card is visible for User 3 as band_member
    const user3Card = user3Page.getByTestId(`companion-card-${companionId}`)
    await expect(user3Card).toBeVisible({ timeout: 10_000 })
    await closeCompanionSettings(page, companionId)

    // --- 1. Toggle Play / Stop sync ---
    const ownerPlayAllToggle = visibleTestId(page, 'companion-play-all-toggle')
    await ownerPlayAllToggle.click()
    await expect(ownerPlayAllToggle).toHaveText('Stop', { timeout: 10_000 })
    await expect(visibleTestId(user3Page, 'companion-play-all-toggle')).toHaveText('Stop', { timeout: 15_000 })

    // The room-level ChordDisplay's "current-chord" is populated only by per-beat
    // companion note events, which the backend (CompanionScheduler) emits *only*
    // while a companion is playing AND unmuted. Capture the chord now — while the
    // companion is unmuted and beats are guaranteed flowing — because currentChord
    // then persists in the store through the mute + instrument/style changes below.
    // Asserting it only after the mute step would race the first beat against the
    // mute toggle (which stops all further beats), and could deadlock if no beat
    // landed first.
    // ChordDisplay renders in a Popover portal (document root) — locate at page level.
    const user3ChordDisplay = visibleTestId(user3Page, 'chord-display')
    await expect(user3ChordDisplay).toBeVisible()
    await expect(user3ChordDisplay.locator('[data-testid="current-chord"]')).toBeVisible({ timeout: 15_000 })

    // --- 2. Toggle Mute sync ---
    await page.getByTestId(`companion-mute-toggle-${companionId}`).click()
    await expect(user3Page.getByTestId(`companion-mute-toggle-${companionId}`)).toHaveAttribute('title', 'Unmute', { timeout: 8_000 })

    // --- 3. Instrument change & Role Auto-Derivation sync ---
    // User 1 selects Fretless Bass via the instrument popup
    await selectCompanionInstrument(page, companionId, 'Fretless Bass')

    // User 3 sees instrument change via data attribute
    await expect(user3Card).toHaveAttribute('data-companion-instrument', 'fretless_bass', { timeout: 10_000 })

    // Since 'fretless_bass' derives to 'bass' role, style should update to bass default ('root-fifth')
    await expect(user3Card).toHaveAttribute('data-companion-style', 'root-fifth', { timeout: 8_000 })

    // User 1 opens settings and changes style to 'walking'
    await openCompanionSettings(page, companionId)
    await selectRadixOption(page, page.getByTestId(`companion-settings-style-${companionId}`), 'walking')
    await closeCompanionSettings(page, companionId)
    // User 3 sees style change via data attribute
    await expect(user3Card).toHaveAttribute('data-companion-style', 'walking', { timeout: 8_000 })

    // Room-level ChordDisplay must still show the chord captured above — currentChord
    // persists in the store even though the companion is now muted (no new beats).
    await expect(user3ChordDisplay).toBeVisible()
    await expect(user3ChordDisplay.locator('[data-testid="current-chord"]')).toBeVisible({ timeout: 10_000 })

    // --- 4. Switch to Beat instrument ---
    // Close settings popup first, then select new instrument
    await closeCompanionSettings(page, companionId)
    await selectCompanionInstrument(page, companionId, 'Roland TR-808', 'Drum/Beat')

    // User 3 sees instrument and style change (beat role defaults to 'basic')
    await expect(user3Card).toHaveAttribute('data-companion-instrument', 'TR-808', { timeout: 10_000 })
    await expect(user3Card).toHaveAttribute('data-companion-style', 'basic', { timeout: 8_000 })
    await expect(user3Card).toHaveAttribute('data-companion-timing', 'normal', { timeout: 8_000 })

    // ChordDisplay is room-level and remains visible even when companion is beat role
    await expect(user3ChordDisplay).toBeVisible({ timeout: 8_000 })

    // --- 5. Companion Volume Sync ---
    // The Fader uses a piecewise dB→slider-position taper (0 dB = 75% travel).
    // Its internal <input> holds a 0..1 position, not the dB value — assert on
    // data-db-value for the actual dB, and use the position value for fill().
    const dbToPos = (db: number) => {
      const minDb = -60, maxDb = 12, unityPos = 0.75
      if (db <= minDb) return 0
      if (db >= maxDb) return 1
      if (db <= 0) return ((db - minDb) / (0 - minDb)) * unityPos
      return unityPos + (db / maxDb) * (1 - unityPos)
    }
    const volumeSlider = page.getByTestId(`companion-volume-slider-${companionId}`)
    await expect(volumeSlider).toBeVisible()
    await expect(volumeSlider).toHaveAttribute('data-db-value', String(DEFAULT_COMPANION_VOLUME_DB))

    // Adjust volume (User 1)
    await volumeSlider.fill(String(dbToPos(-10)))
    await page.waitForTimeout(500) // allow debounce/ephemeral propagation

    // User 3 sees updated volume value
    const user3VolumeSlider = user3Page.getByTestId(`companion-volume-slider-${companionId}`)
    await expect(user3VolumeSlider).toHaveAttribute('data-db-value', '-10', { timeout: 10_000 })

    // --- 6. Remove Companion sync ---
    // The Remove button lives inside the settings menu (a Radix Popover), which
    // closes on outside interaction — e.g. the volume slider adjusted above. Make
    // sure the menu is open before clicking Remove.
    const removeBtn = page.getByTestId(`companion-remove-${companionId}`)
    const settingsBtn = page.getByTestId(`companion-settings-button-${companionId}`)
    // Gate the re-open on the trigger's Radix `data-state`, not `removeBtn.isVisible()`: the
    // Popover's content stays visible through its pop-out close animation, so a visibility check
    // right after the outside-click close could skip re-opening and then click a detaching button.
    if ((await settingsBtn.getAttribute('data-state')) !== 'open') {
      await settingsBtn.click({ force: true })
      await expect(removeBtn).toBeVisible({ timeout: 5_000 })
    }
    await removeBtn.click()
    await expect(visibleTestId(user3Page, 'companion-empty-state')).toBeVisible({ timeout: 10_000 })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Time Signature Control in Room Header (Room Owner only)
    // Time signature is a live control in the header — no modal or Save button needed
    // ─────────────────────────────────────────────────────────────────────────
    await expect(user3Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Allow Socket.IO connections to establish and settle
    await Promise.all([page.waitForTimeout(3_000), user3Page.waitForTimeout(3_000)])

    // Find Time Signature numerator dropdown in the room header
    const tsSelect = page.getByRole('combobox', { name: 'Time signature numerator' })
    await expect(tsSelect).toBeVisible()
    await expectRadixValue(tsSelect, '4') // Default numerator is 4

    // Change to '3' (representing 3/4 time signature) — live control, applies immediately
    await selectRadixOption(page, tsSelect, '3')

    // Verify Room Owner's local state updates immediately (no save required)
    await expectRadixValue(tsSelect, '3')

    // Verification of read-only access for other roles (User 3 as band_member)
    // User 3 should NOT see the "Room Settings" button
    const user3SettingsButton = user3Page.getByTitle('Room Settings').first()
    await expect(user3SettingsButton).not.toBeVisible()
  })

  // NOTE: the former "companion settings lock is visible to other users when a control is
  // focused" e2e was removed (DEV-225). The server broadcast (focus → companion_settings_lock,
  // blur → companion_settings_unlock, incl. sender) is covered by
  // PerformCompanionHandler.test.ts (handleCompanionSettingsLock / handleCompanionSettingsUnlock);
  // the FE lock rendering by performCompanionSettingsLockStore.test.ts + CompanionSettingsPopup.test.tsx.

  test('manual chord progression: switch mode, load preset, ChordDisplay reflects it', async ({ page }) => {
    // DEV-102: Manual chord progression mode — single-user (room owner) flow
    test.setTimeout(120_000)

    // Navigate to root and clear session state
    await page.goto('/')
    await page.waitForLoadState('load')
    await clearRoomSession(page)

    // Short settle wait
    await page.waitForTimeout(1_000)

    // Room owner creates a perform room
    const room = await createRoomViaAPI(page, {
      name: `E2E Manual Progression ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })
    const roomId = room.id

    // Navigate into the room
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    // Wait for companion panel to appear and open controls
    await expect.poll(() => isCompanionPanelVisible(page), { timeout: 15_000 }).toBe(true)
    await openCompanionControls(page)
    await page.waitForTimeout(2_000)

    // ── Step 1: Verify default mode is Auto (chord-length select is visible) ──
    await expect(visibleTestId(page, 'companion-chord-length')).toBeVisible()

    // ── Step 2: Switch to Manual mode ──
    await page.getByRole('button', { name: 'Manual' }).click()

    // Manual mode swaps the chord-length selector for a "Manual Setup" button (DEV-102 modal UX).
    await expect(visibleTestId(page, 'companion-manual-setup')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('companion-chord-length')).toHaveCount(0)

    // ── Step 3: Open the Manual Setup modal and load the "classic-cadence" preset ──
    // The editor (and its preset dropdown) live inside the ManualProgressionEditorModal.
    await visibleTestId(page, 'companion-manual-setup').click()
    await expect(page.getByTestId('manual-progression-editor')).toBeVisible({ timeout: 5_000 })
    await selectRadixOption(page, page.getByLabel('load-progression-preset'), 'classic-cadence', { verify: false })

    // Apply the loaded preset: the draft → Apply UX (DEV-102) commits the progression
    // and closes the modal so it no longer overlays the companion panel for the next steps.
    await page.getByRole('button', { name: 'apply-progression' }).click()
    await expect(page.getByTestId('manual-progression-editor')).toHaveCount(0)

    // ── Step 4: Add a companion and start playing so ChordDisplay populates ──
    // ChordDisplay only shows current-chord while isAnyPlaying is true (per existing spec behaviour)
    await addCompanionViaPicker(page, 'piano')
    await expect(visibleTestId(page, 'companion-list')).toBeVisible({ timeout: 10_000 })

    // Start playing via the Play All toggle
    await visibleTestId(page, 'companion-play-all-toggle').click()
    await expect(visibleTestId(page, 'companion-play-all-toggle')).toHaveText('Stop', { timeout: 10_000 })

    // ── Step 5: ChordDisplay (portal, rendered at page root) shows "C" from classic-cadence ──
    const chordDisplay = visibleTestId(page, 'chord-display')
    await expect(chordDisplay).toBeVisible({ timeout: 10_000 })
    await expect(chordDisplay.locator('[data-testid="current-chord"]')).toBeVisible({ timeout: 15_000 })
    await expect(chordDisplay).toContainText('C', { timeout: 15_000 })

    // Stop playing to clean up
    await visibleTestId(page, 'companion-play-all-toggle').click()
  })
})
