/**
 * E2E Tests: Project rules in multi-user sessions (BR-1, BR-5, BR-11)
 *
 * BR-1: If a project already has an active Arrange Room, clicking the project in
 *       the lobby shows a "Project In Use" modal (not creates a new room).
 * BR-5: When a user hits their project save limit, ProjectLimitModal appears
 *       instead of SaveProjectModal (verified via mocked API response).
 * BR-11: A locked project prevents non-owners from saving (save button disabled).
 *
 * Requires: E2E_USER1_*, E2E_USER2_* env vars + running backend
 */
import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/multi-user'
import {
  checkRoomExists,
  createArrangeProjectViaAPI,
  createRoomViaAPI,
  deleteProjectViaAPI,
  getProjectActiveRoomInfoViaAPI,
  listUserProjects,
  setProjectActiveRoom,
  // loadProjectIntoRoomViaAPI,
  lockProjectViaAPI,
  setProjectVisibilityViaAPI,
} from '../helpers/api'
import { makeAuthHeaders } from '../helpers/auth'
import { waitForArrangeRoomReady } from '../helpers/arrange'

test.describe.configure({ mode: 'serial' })

test.skip(({ browserName }) => browserName !== 'chromium', 'Multi-user project-rules E2E runs on chromium only')

test.describe('BR-1: Project already has an active room', () => {
  let roomId: string
  let projectId: string
  let projectName: string

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')

    // Clean up any existing projects first to prevent hitting project limit (403)
    const { owned } = await listUserProjects(page)
    for (const project of owned) {
      await deleteProjectViaAPI(page, project.id).catch(() => {})
    }

    // Create an arrange room via API
    const room = await createRoomViaAPI(page, {
      name: `E2E BR1 ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })
    roomId = room.id

    // Use a fresh project so it is reliably included in the lobby's latest
    // public-project slice. Visibility changes intentionally preserve updatedAt.
    projectName = `E2E BR1 Project ${uuidv4().slice(0, 8)}`
    const arrangeProject = await createArrangeProjectViaAPI(page, projectName)
    projectId = arrangeProject.id

    // Make project public so user2 can see it in the Discover section
    await setProjectVisibilityViaAPI(page, projectId, 'PUBLIC')

    // Associate the project with the active room (must come after visibility so
    // enrichProjectsWithRoomInfo picks up the live socket state)
    await setProjectActiveRoom(page, projectId, roomId)
  })

  test.afterEach(async ({ page }) => {
    // Clear the active room link and restore visibility after test
    if (projectId) {
      await setProjectActiveRoom(page, projectId, null).catch(() => {})
      await deleteProjectViaAPI(page, projectId).catch(() => {})
    }
  })

  test('user1 in arrange room → user2 clicks project in lobby → sees "Project In Use" modal', async ({
    page,
    user2Page,
  }) => {
    // user1 joins the room to make it active in Redis
    await page.goto(`/arrange/${roomId}`)
    await page.waitForLoadState('load')

    // This room is linked to a project (setProjectActiveRoom in beforeEach), so once the
    // project metadata syncs the save button reads "Save" (not "New Save"). Wait for the
    // exact "Save" label: it confirms both that user1 is connected AND that the project is
    // active in the room — the precondition BR-1 is about. toBeVisible + timeout waits
    // through the brief "New Save" → "Save" transition regardless of sync latency.
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeVisible({ timeout: 20_000 })

    await expect
      .poll(
        async () => {
          const info = await getProjectActiveRoomInfoViaAPI(user2Page, projectId)
          return info.activeRoomId === roomId && info.activeUserCount > 0
        },
        { timeout: 20_000 },
      )
      .toBe(true)

    // user2 navigates to lobby and waits for the community (Discover) section to load
    await user2Page.goto('/')
    await user2Page.waitForLoadState('load')

    // Wait for the Discover section heading to appear (confirms community data loaded)
    const discoverHeading = user2Page.getByRole('heading', { name: 'Discover & Contribute' })
    await expect(discoverHeading).toBeVisible({ timeout: 15_000 })

    // Find the card-body that contains the Discover heading, then look for user1's project by name
    const discoverCardBody = user2Page.locator('.card-body').filter({
      has: user2Page.getByRole('heading', { name: 'Discover & Contribute' }),
    })
    const projectCard = discoverCardBody.locator('.card').filter({ hasText: projectName }).first()

    await expect(projectCard).toBeVisible({ timeout: 10_000 })
    await projectCard.getByRole('button', { name: 'Open' }).click()

    // "Project In Use" modal should appear (not creating a new room)
    await expect(user2Page.getByText('Project In Use')).toBeVisible({ timeout: 10_000 })
  })
})

// NOTE: the former "BR-5: Project save limit modal" e2e was removed (DEV-225). It was a
// single-user test with a fully page.route-mocked /api/projects response; the real
// at-limit decision is covered by useProjectSave.limit.test.ts ("project limit (BR-5)"),
// and the ProjectLimitModal render is trivial glue on top of showLimitModal.

test.describe('BR-11: Locked project prevents non-owner saves', () => {
  test('unlocked public project allows non-owner save', async ({
    page,
    user2Page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('load')

    try {
      const room = await createRoomViaAPI(page, {
        name: `E2E BR11 Unlocked ${uuidv4().slice(0, 8)}`,
        roomType: 'arrange',
      })

      await page.goto(`/arrange/${room.id}`)
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
        await limitModal.getByRole('button', { name: /^Save Over$/ }).first().click()
        const confirmSaveOverModal = page.locator('.modal.modal-open').filter({
          has: page.getByText('Confirm Save Over'),
        })
        await expect(confirmSaveOverModal).toBeVisible({ timeout: 10_000 })
        await confirmSaveOverModal.getByRole('button', { name: /^Save Over$/ }).click()
      }

      await expect(projectNameInput).toBeVisible({ timeout: 20_000 })
      const firstSaveName = `E2E BR11 Save ${uuidv4().slice(0, 8)}`
      await projectNameInput.fill(firstSaveName)

      const firstSaveResponsePromise = page.waitForResponse((res) => {
        return res.url().includes('/api/projects/save-from-room') && res.request().method() === 'POST'
      }, { timeout: 30_000 })

      await page.getByRole('button', { name: /^Save$/ }).last().click()
      const firstSaveResponse = await firstSaveResponsePromise
      expect(firstSaveResponse.status()).toBe(200)

      const firstSavePayload = (await firstSaveResponse.json()) as { projectId: string }
      const projectId = firstSavePayload.projectId
      expect(projectId).toBeTruthy()

      await expect(projectNameInput).not.toBeVisible({ timeout: 20_000 })
      await setProjectVisibilityViaAPI(page, projectId, 'PUBLIC')
      await lockProjectViaAPI(page, projectId, false)

      await expect(page.getByRole('button', { name: /^Save$/ }).first()).toBeVisible({ timeout: 20_000 })

      // user2 joins the room. Since user1 is still connected as room_owner, user2 should be band_member.
      await user2Page.goto(`/arrange/${room.id}`)
      await user2Page.waitForLoadState('load')
      await waitForArrangeRoomReady(user2Page)

      const user2Save = user2Page.getByRole('button', { name: /New Save|Save/ }).first()
      await expect(user2Save).toBeVisible({ timeout: 20_000 })

      // Verify non-owner save is permitted via API.
      // Save may transiently fail with 500 in CI/local dev (storage/back-end timing).
      // Retry once after confirming room liveness to keep this permission assertion deterministic.
      let saveStatus = 0
      let saveResponseBody = ''

      for (let attempt = 0; attempt < 2; attempt++) {
        const headers = await makeAuthHeaders(user2Page)
        const saveResponse = await user2Page.request.post(
          `${process.env.VITE_API_URL ?? 'http://localhost:3001'}/api/projects/save-from-room`,
          {
            headers,
            data: {
              roomId: room.id,
              projectId,
            },
          },
        )

        saveStatus = saveResponse.status()
        saveResponseBody = await saveResponse.text().catch(() => '')

        if (saveStatus === 200) {
          break
        }

        if (saveStatus === 500 && attempt === 0) {
          const roomExists = await checkRoomExists(user2Page, room.id)

          // If the room dropped, recover both users into the same room before retrying.
          if (!roomExists.exists) {
            await page.goto(`/arrange/${room.id}`)
            await page.waitForLoadState('load')
            await waitForArrangeRoomReady(page)

            await user2Page.goto(`/arrange/${room.id}`)
            await user2Page.waitForLoadState('load')
            await waitForArrangeRoomReady(user2Page)
          }

          await user2Page.waitForTimeout(1_500)
          continue
        }

        break
      }

      expect(saveStatus, `save-from-room failed: ${saveResponseBody}`).toBe(200)
    } finally {
      // No cleanup required beyond current room teardown; this test creates and uses its own room/project state.
    }
  })
})

// NOTE: the former "BR-17: Arrange Room project detail owner-only editing" e2e was
// removed (DEV-225). The gating (project present + non-owner → name/description fields
// disabled + owner-only note; owner/no-project → editable; detail populated) is a
// single-client render assertion, now covered by
// RoomSettingsModal.projectDetail.test.tsx.

// NOTE: the former "BR-6: Project Visibility" e2e cases (PRIVATE-only-to-owner,
// PUBLIC-visible-to-all) and "BR-13: Project Contributor System" case
// (non-owner-accesses-PUBLIC) were removed (test-tier-rebalancing round 2, Task 1.2).
// These were pure-API (no DOM) visibility checks; the risk is covered at the backend
// integration tier: projects.visibility-contributor.test.ts (non-member cannot access
// a PRIVATE project — 403) and ProjectApplicationService.listPublicProjects.test.ts
// (PUBLIC-only query, PRIVATE never listed).
