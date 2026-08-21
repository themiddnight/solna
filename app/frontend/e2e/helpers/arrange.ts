import { expect, type Page } from '@playwright/test'

/**
 * Wait until Arrange room UI is interactive.
 * This handles variable project-load durations without fixed sleeps.
 */
export async function waitForArrangeRoomReady(page: Page, timeout = 60_000): Promise<void> {
  await expect(page).toHaveURL(/\/arrange\//, { timeout })

  const loadingHeading = page.getByRole('heading', { name: /^Loading Project$/i })

  await expect
    .poll(async () => {
      return loadingHeading.isVisible().catch(() => false)
    }, { timeout })
    .toBe(false)

  const saveAction = page.getByRole('button', { name: /New Save|Save/ }).first()
  await expect(saveAction).toBeVisible({ timeout })
}

/**
 * Wait until an existing project is fully loaded in Arrange room.
 * Existing projects should eventually show only the `Save` action.
 */
export async function waitForExistingProjectReady(page: Page, timeout = 60_000): Promise<void> {
  await waitForArrangeRoomReady(page, timeout)

  const saveButton = page.getByRole('button', { name: /^Save$/ }).first()
  await expect(saveButton).toBeVisible({ timeout })
  await expect(page.getByRole('button', { name: /^New Save$/ })).not.toBeVisible({ timeout: 5_000 })
}
