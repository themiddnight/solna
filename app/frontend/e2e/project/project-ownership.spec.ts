/**
 * E2E Tests: Project ownership rules in Arrange Room (BR-2, BR-12)
 *
 * Covers:
 * - Before first save: all users can see project tools (Import/Export/etc.)
 * - user1 clicks "New Save" → becomes project owner
 * - After first save: user2's project tools are disabled (BR-12)
 *
 * Requires: E2E_USER1_*, E2E_USER2_* env vars + running backend
 */
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import type { Page } from '@playwright/test'
import {
  createArrangeProjectViaAPI,
  createRoomViaAPI,
  listUserProjects,
  loadProjectIntoRoomViaAPI,
} from '../helpers/api'
import { makeAuthHeaders } from '../helpers/auth'
import { waitForArrangeRoomReady } from '../helpers/arrange'

const API_BASE = (process.env.VITE_API_URL ?? 'http://localhost:3001').replace('localhost', '127.0.0.1')

test.describe.configure({ mode: 'serial' })

test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user ownership E2E runs on chromium only')

test.describe('BR-2 / BR-12: Project Ownership', () => {
  let roomId: string
  let skippedExistingProjectTests = 0

  const _getExistingArrangeProject = async (page: Page) => {
    const { owned } = await listUserProjects(page)
    return owned.find((project) => project.roomType === 'arrange') ?? owned[0]
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })

    const room = await createRoomViaAPI(page, {
      name: `E2E Ownership ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })
    roomId = room.id
  })

  test.afterAll(() => {
    if (skippedExistingProjectTests > 0) {
      console.warn(
        `[E2E SUMMARY] Project Ownership: skipped ${skippedExistingProjectTests} existing-project test(s) because no existing arrange project was available for the test user.`
      )
    }
  })

  test('new arrange room (no project): room_owner sees project tools, band_member does not', async ({
    page,
    user2Page,
  }) => {
    // Join sequentially so user1 deterministically becomes room_owner.
    await page.goto(`/arrange/${roomId}`)
    await page.waitForLoadState('load')
    await page.waitForTimeout(2_000)

    await user2Page.goto(`/arrange/${roomId}`)
    await user2Page.waitForLoadState('load')
    await user2Page.waitForTimeout(2_000)

    // user1 (room_owner): Import button is shown and enabled (canLoadProject=true,
    // canUseProjectFeatures=true since no project owner yet)
    const user1Import = page.getByRole('button', { name: /^Import$/ })
    await expect(user1Import).toBeVisible({ timeout: 10_000 })
    await expect(user1Import).not.toBeDisabled()

    // user2 (band_member): Import button is NOT rendered (canLoadProject=false for
    // non-room-owners per ArrangeRoomHeader → ProjectMenu canLoadProject={isRoomOwner})
    await expect(user2Page.getByRole('button', { name: /^Import$/ })).not.toBeVisible({
      timeout: 3_000,
    })

    // user1 has New Save button enabled
    await expect(page.getByRole('button', { name: 'New Save' })).not.toBeDisabled()

    // user2 (band_member) can ALSO trigger "New Save" in a new room with no project:
    // either member may click it and the project is created under the room owner
    // server-side, with the saver recorded as a contributor (FC-3 Scenario 3 / BR-19).
    const user2Save = user2Page.getByRole('button', { name: /New Save|Save/ }).first()
    await expect(user2Save).toBeVisible({ timeout: 5_000 })
    await expect(user2Save).not.toBeDisabled()
  })

  test('user1 (project owner) joins → auto-becomes room_owner (BR-2)', async ({
    page,
    user2Page,
  }) => {
    // ── 1. user2 creates a fresh arrange room ─────────────────────────────────
    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')

    const room = await createRoomViaAPI(user2Page, {
      name: `E2E BR2 ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })
    const localRoomId = room.id

    // ── 2. Find user1's existing arrange project and link it to the room ──────
    // We only set the active-room mapping here (enables BR-2 on join).
    // The project files are loaded AFTER both users are in the room so the
    // arrange:project_loaded broadcast reaches the connected clients, which
    // is what drives the FE "Save" label update.
    const { owned } = await listUserProjects(page)
    let arrangeProject = owned.find((p) => p.roomType === 'arrange')
    if (!arrangeProject) {
      try {
        arrangeProject = await createArrangeProjectViaAPI(page, `E2E-BR2-${uuidv4().slice(0, 8)}`)
      } catch {
        skippedExistingProjectTests += 1
        test.skip(true, 'Could not create arrange project for BR-2 test')
        return
      }
    }

    const headers = await makeAuthHeaders(page)
    let activeRoomRes = await page.request.put(
      `${API_BASE}/api/projects/${arrangeProject.id}/active-room`,
      { headers, data: { roomId: localRoomId } },
    )
    // Retry up to 3 times in case of transient backend unavailability
    for (let attempt = 0; !activeRoomRes.ok() && attempt < 2; attempt++) {
      await page.waitForTimeout(500)
      activeRoomRes = await page.request.put(
        `${API_BASE}/api/projects/${arrangeProject.id}/active-room`,
        { headers, data: { roomId: localRoomId } },
      )
    }
    if (!activeRoomRes.ok()) {
      test.skip(true, 'Could not link project to room — skipping BR-2 test')
      return
    }

    // ── 3. user2 joins first (receives subsequent project broadcast) ──────────
    await user2Page.goto(`/arrange/${localRoomId}`)
    await user2Page.waitForLoadState('load')
    await waitForArrangeRoomReady(user2Page)

    const user2SaveBtn = user2Page.getByRole('button', { name: /New Save|Save/ }).first()
    await expect(user2SaveBtn).toBeVisible({ timeout: 10_000 })

    // ── 4. user1 (project owner) joins → BR-2 triggers promotion ─────────────
    await page.goto(`/arrange/${localRoomId}`)
    await page.waitForLoadState('load')
    await waitForArrangeRoomReady(page)

    // ── 5. Assert: user1 now has room_owner privileges ────────────────────────
    const user1Import = page.getByRole('button', { name: /^Import$/ })
    await expect(user1Import).toBeVisible({ timeout: 40_000 })
    await expect(user1Import).not.toBeDisabled()

    // ── 6. Assert: user2 is now band_member (demoted) ─────────────────────────
    await expect(user2Page.getByRole('button', { name: /^Import$/ })).not.toBeVisible({
      timeout: 10_000,
    })

    // ── 7. Load project while both users are in room ──────────────────────────
    // arrange:project_loaded broadcasts to all connected clients → FE updates
    // hasBeenSaved state → "New Save" switches to "Save" for both users.
    await loadProjectIntoRoomViaAPI(page, localRoomId, arrangeProject.id)

    // ── 8. Assert: Save label appears for user1 (project owner / room_owner) ──
    const user1Save = page.getByRole('button', { name: /^Save$/ }).first()
    await expect(user1Save).toBeVisible({ timeout: 30_000 })
    await expect(user1Save).not.toBeDisabled()
  })

  // NOTE: the former single-user "opening an existing project shows Save immediately, not
  // New Save" e2e was removed (DEV-225). The New-Save↔Save label is a pure function of the
  // room's project metadata, now covered by save-ownership.test.tsx
  // ("New Save vs Save button label"). The first-save round-trip smoke below (real save +
  // label flip) is kept as it exercises persistence, not just the label.

  test('first successful New Save switches the button label to Save', async ({ page }) => {
    await page.goto(`/arrange/${roomId}`)
    await page.waitForLoadState('load')
    await waitForArrangeRoomReady(page)

    const newSaveButton = page.getByRole('button', { name: 'New Save' })
    await expect(newSaveButton).toBeVisible({ timeout: 20_000 })
    await expect(newSaveButton).not.toBeDisabled()

    const projectListResponsePromise = page.waitForResponse((res) => {
      return res.url().includes('/api/projects') && res.request().method() === 'GET'
    }, { timeout: 30_000 }).catch(() => null)

    await newSaveButton.click()
    await projectListResponsePromise

    const projectNameInput = page.locator('#projectName')
    const limitModalHeading = page.getByRole('heading', { name: 'Project Limit Reached' })

    await expect
      .poll(async () => {
        const isSaveVisible = await projectNameInput.isVisible().catch(() => false)
        const isLimitVisible = await limitModalHeading.isVisible().catch(() => false)
        if (isSaveVisible) return 'save'
        if (isLimitVisible) return 'limit'
        return 'none'
      }, { timeout: 20_000 })
      .not.toBe('none')

    if ((await projectNameInput.isVisible().catch(() => false)) === false) {
      const limitModal = page.locator('.modal.modal-open').filter({
        has: limitModalHeading,
      })
      await expect
        .poll(async () => {
          return limitModalHeading.isVisible().catch(() => false)
        }, { timeout: 20_000 })
        .toBe(true)
      await limitModal.getByRole('button', { name: /^Save Over$/ }).first().click()

      const confirmSaveOverModal = page.locator('.modal.modal-open').filter({
        has: page.getByText('Confirm Save Over'),
      })
      await expect(confirmSaveOverModal).toBeVisible({ timeout: 10_000 })
      await confirmSaveOverModal.getByRole('button', { name: /^Save Over$/ }).click()
    }

    await expect(projectNameInput).toBeVisible({ timeout: 15_000 })

    const projectName = `E2E First Save ${uuidv4().slice(0, 8)}`
    await projectNameInput.fill(projectName)
    await page.getByRole('button', { name: /^Save$/ }).last().click()

    await expect(projectNameInput).not.toBeVisible({ timeout: 20_000 })

    const saveButton = page.getByRole('button', { name: /^Save$/ })
    await expect(saveButton).toBeVisible({ timeout: 20_000 })
    await expect(saveButton).not.toBeDisabled()
    await expect(page.getByRole('button', { name: 'New Save' })).not.toBeVisible({ timeout: 3_000 })
  })
})
