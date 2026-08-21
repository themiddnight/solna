import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Select an option in a `Select.Simple` (Radix) dropdown by its value.
 *
 * Radix renders a button trigger (no native `value`) plus a portaled listbox,
 * so Playwright's `selectOption()` — which only drives native `<select>` — does
 * not work. The kit mirrors each option's value onto `[role=option][data-value]`
 * and the current value onto the trigger's `data-value`; this helper clicks the
 * trigger, picks the option by value, and waits for the trigger to reflect it.
 */
export async function selectRadixOption(
  page: Page,
  trigger: Locator,
  value: string,
  options?: { verify?: boolean },
): Promise<void> {
  await trigger.click()
  const option = page
    .locator(`[role="option"][data-value="${value}"]`)
    .filter({ visible: true })
    .first()
  await option.click()
  // Action-style pickers (e.g. "load preset") keep value="" after a choice, so
  // callers can opt out of the reflected-value assertion.
  if (options?.verify !== false) {
    await expect(trigger).toHaveAttribute('data-value', value)
  }
}

/** Assert a `Select.Simple` trigger currently holds `value` (replaces the native
 *  `toHaveValue` assertion, which a Radix trigger button cannot satisfy). */
export async function expectRadixValue(
  trigger: Locator,
  value: string,
  options?: { timeout?: number },
): Promise<void> {
  await expect(trigger).toHaveAttribute('data-value', value, options)
}
