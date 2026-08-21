import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import { createRoomViaAPI } from '../helpers/api'

// Multi-user tests must be serial and chromium only
test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user tests run on chromium only')

/**
 * Perform Room joiners must receive a metronome anchor without any BPM change.
 * The anchor is what starts the client-side beat scheduler — without it the
 * metronome is silent until someone nudges the BPM or the page is reloaded.
 */
test.describe('Perform metronome: joiner receives anchor on join', () => {
  let roomId: string

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    const room = await createRoomViaAPI(page, { name: `E2E Metronome ${uuidv4().slice(0, 8)}`, roomType: 'perform' })
    roomId = room.id
  })

  test('both owner and late joiner get an anchor with no BPM change', async ({ page, user2Page }) => {
    await page.goto(`/perform/${roomId}`)
    await page.waitForLoadState('load')
    // 30s, not 15s: joining is the SETUP here, not the assertion, and a loaded group run
    // has been observed sitting at "Connecting to Room" past 15s. The anchor wait below is
    // what this spec actually measures, and it stays tight.
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 30_000 })

    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')
    await user2Page.evaluate((id) => {
      sessionStorage.setItem(
        'collab-room-session',
        JSON.stringify({ roomId: id, role: 'band_member', userId: 'e2e', username: 'e2e', timestamp: Date.now() }),
      )
    }, roomId)
    await user2Page.goto(`/perform/${roomId}`)
    await user2Page.waitForLoadState('load')
    await expect(user2Page.getByTestId('room-leave-button')).toBeVisible({ timeout: 30_000 })

    // `__metronomeAnchor` is the DEV-only instrumentation set by useMetronome on
    // every anchor received from the server.
    const readAnchor = (target: typeof page) =>
      target.waitForFunction(
        () => Reflect.get(window, '__metronomeAnchor') !== undefined,
        undefined,
        { timeout: 10_000 },
      )

    await expect(readAnchor(page)).resolves.toBeTruthy()
    await expect(readAnchor(user2Page)).resolves.toBeTruthy()

  })
})
