/**
 * E2E Test: Onboarding tour — happy path (DEV-206)
 *
 * Covers the Phase-1 onboarding tour end to end: the one-time toast in the
 * Lobby -> "Start Tour" -> `welcome` card -> `create-room` spotlight ->
 * creating a room -> the orchestrator auto-advancing into Perform
 * (`stage-overview`) -> Next through the first ungated Perform steps ->
 * the `companion` advance gate (Next disabled + gate hint) in a real browser.
 *
 * Stops at the first gate on purpose: the deeper gated walk requires satisfying
 * audio-dependent preconditions (e.g. the sequencer must actually be playing),
 * which is flaky headless and is covered instead by usePerformTourChoreography's
 * unit tests. This spec's unique value is the real-browser wiring: the
 * session-gated toast, navigation-driven phase advance, spotlight DOM, and that
 * a gate genuinely blocks Next.
 *
 * Selectors follow docs/E2E_SELECTOR_POLICY.md: tour anchors via
 * `[data-tour-id="..."]` (the tour's designated contract), tooltip buttons by
 * accessible role/name, and the existing `lobby-create-perform-card` /
 * `tour-spotlight-*` test ids already shipped in product code.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from './fixtures/e2e-test'

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend')

test.describe('Onboarding Tour: happy path', () => {
  // DEV-229: for a verified user the tour offer is gated by the server-persisted
  // `User.onboardingTourPromptedAt` (DEV-220) — offered at most once, ever. Reset it
  // for the seeded E2E users before each attempt (beforeEach is retry-safe; beforeAll
  // is not) so the "Start Tour" toast is re-offered every run. On page load,
  // checkAuth() -> GET /auth/me re-hydrates the client with the fresh null value.
  test.beforeEach(() => {
    execFileSync('bun', ['run', 'reset:e2e-tour'], { cwd: BACKEND_DIR, stdio: 'pipe' })
  })

  test('toast -> welcome -> create room -> perform stage -> companion advance gate', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    await expect(page.getByTestId('lobby-create-perform-card')).toBeVisible({ timeout: 15_000 })

    // 1. One-time tour toast appears. For this verified user the offer is gated by
    // the server-persisted `onboardingTourPromptedAt` (DEV-220), reset to null in
    // beforeEach (DEV-229) so it fires every run.
    const startTourButton = page.getByRole('button', { name: 'Start Tour' })
    await expect(startTourButton).toBeVisible({ timeout: 10_000 })
    await startTourButton.click()

    // 2. `welcome` tooltip shows — no anchor, so a centered dim overlay (no
    // spotlight hole) and no Back button (first step).
    await expect(page.getByRole('heading', { name: 'Welcome to the Perform room' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('tour-spotlight-dim')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)

    // 3. Advance (Next) to the `create-room` spotlight over the Perform card.
    // advanceOn: 'navigation' -> no Next button here; only a real room
    // navigation advances the tour.
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Open your jam room' })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('tour-spotlight-hole')).toBeVisible()
    await expect(page.locator('[data-tour-id="lobby-create-room"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0)

    // 4. Create the room via the spotlighted Perform card.
    await page.getByTestId('lobby-create-perform-card').click()
    await expect(
      page.getByRole('figure').getByRole('heading', { name: 'Create Perform Room' }),
    ).toBeVisible({ timeout: 8_000 })

    const roomName = `E2E Tour ${uuidv4().slice(0, 8)}`
    await page.getByPlaceholder('Enter room name').fill(roomName)
    await page.getByRole('button', { name: 'Create Room' }).click()

    await expect(page).toHaveURL(/\/perform\//, { timeout: 20_000 })
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 15_000 })

    // 5. Tour auto-advances into Perform: the `stage-overview` step spotlights
    // the virtual stage (the orchestrator jumps straight to the first step of
    // the reached phase on real navigation).
    await expect(page.getByRole('heading', { name: "Your band's stage" })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-tour-id="perform-virtual-stage"]')).toBeVisible()
    await expect(page.getByTestId('tour-spotlight-hole')).toBeVisible()

    // 6. Advance through the first ungated Perform steps: stage-overview ->
    // input-types -> companion. (These carry no advance gate.)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'This is you' })).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Meet your first bandmate' })).toBeVisible({ timeout: 5_000 })

    // 7. The `companion` step is gated: a drum companion is auto-added, but Next
    // stays blocked until the user adds a *chord* companion (Piano/Guitar). In a
    // real browser the gate must render Next disabled and show its hint. The
    // deeper gated walk (needs a live sequencer etc.) is unit-tested, not here.
    const nextButton = page.getByRole('button', { name: 'Next', exact: true })
    await expect(nextButton).toBeDisabled({ timeout: 5_000 })
    await expect(page.getByText('Add a Piano or Guitar Companion to keep going.')).toBeVisible()
    await expect(page.locator('[data-tour-id="perform-companion-controls"]')).toBeVisible()
  })
})
