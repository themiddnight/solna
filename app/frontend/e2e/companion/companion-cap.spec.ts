/**
 * E2E: Companion cap regression — a verified REGISTERED user must be able to add
 * companions past the guest/unverified restricted cap (2) WITHOUT being kicked to
 * the lobby.
 *
 * Regression (fixed): the room join/create handlers reassigned `socket.data = session`,
 * which wiped the middleware-attached `socket.data.user`. Every room event handler then
 * read `socket.data.user == null` and treated even a verified user as restricted (cap 2),
 * so adding a 3rd companion emitted REGISTER_REQUIRED — which the client escalated into a
 * fatal room error and replaced the whole Perform UI with the "Return to Lobby" screen.
 * Fix: `setSocketSession` preserves the identity; `useRoomSocket` no longer escalates a
 * non-fatal permission error. This is the tier that catches the middleware→session→handler
 * integration (the unit tests all passed while the real flow broke — DEV-221 lesson).
 *
 * Requires: E2E_USER1_* (a verified REGISTERED account) + running backend.
 */
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

test.describe.configure({ mode: 'serial' })

test.skip(({ browserName }) => browserName !== 'chromium', 'Companion cap E2E runs on chromium only')

test.describe('Companion cap — verified user is not restricted (regression)', () => {
  test('registered user adds a 3rd companion without being kicked to the lobby', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')

    const room = await createRoomViaAPI(page, {
      name: `E2E CompanionCap ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    await page.goto(`/perform/${room.id}`)
    await page.waitForLoadState('load')
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('companion-add-button')).toBeVisible({ timeout: 20_000 })

    const cards = page.locator('[data-testid^="companion-card-"]')
    // Three distinct adds crosses the restricted cap of 2; the 3rd is the one that used to
    // trigger REGISTER_REQUIRED → lobby kick for a wrongly-restricted verified user.
    const presets = ['piano', 'guitar', 'bass'] as const

    const addButton = page.getByTestId('companion-add-button')

    for (let i = 0; i < presets.length; i++) {
      const preset = page.getByTestId(`companion-add-preset-${presets[i]}`)

      // `companion-add-button` is a Radix dropdown trigger whose menu plays a ~120ms pop-out
      // animation on pick. During that close the just-selected item is still `isVisible()` (it's
      // fading out but present in the DOM), so visibility is NOT a reliable "is the menu open?"
      // signal — a check that lands in the pop-out window would skip re-opening and then click an
      // item that detaches as the animation completes, hanging the whole timeout. Instead:
      //   1. Drive off the trigger's `aria-expanded` (the controlled open state, unaffected by the
      //      close animation) to decide whether to (re)open the menu.
      //   2. Fold the pick + count assertion into the retry so a click that races the animation and
      //      detaches simply re-opens and retries.
      //   3. Short-circuit once the card exists so a slow `toHaveCount` can't double-add (idempotent).
      await expect(async () => {
        if ((await cards.count()) === i + 1) return
        if ((await addButton.getAttribute('aria-expanded')) !== 'true') {
          await addButton.click()
        }
        await expect(preset).toBeVisible({ timeout: 1_000 })
        await preset.click({ timeout: 1_000 })
        await expect(cards).toHaveCount(i + 1, { timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
    }

    // Regression: the 3rd add must NOT have escalated to the fatal "Return to Lobby" error.
    await expect(cards).toHaveCount(3)
    await expect(page.getByTestId('room-error-state')).toBeHidden()
    await expect(page.getByTestId('room-leave-button')).toBeVisible()
  })
})
