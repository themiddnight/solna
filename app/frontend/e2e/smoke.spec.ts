import { expect, test } from './fixtures/e2e-test'

test('landing page is reachable', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/127\.0\.0\.1:4173/)
  await expect(page.locator('body')).toBeVisible()
})
