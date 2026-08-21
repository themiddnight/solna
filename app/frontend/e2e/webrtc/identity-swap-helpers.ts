/**
 * Drives the in-room InRoomAuthPromptModal login path: guest -> log into a pre-seeded pool
 * account (a real registered identity), which triggers the DEV-208/217 identity swap + the
 * voice mesh re-sync. Login is used instead of Register to avoid OTP/email verification and
 * DB pollution -- the swap machinery is identical for both.
 */

import type { Page } from '@playwright/test'
import type { UserIdentity } from './webrtc-interop-helpers'

/**
 * Precondition: the modal is open in its default register mode (RegisterForm rendered by
 * InRoomAuthPromptModal). Switches to LoginForm via its "Already have an account? Login"
 * control, fills the pool credentials, and submits. Returns once the form is submitted --
 * the identity swap then proceeds asynchronously; the caller asserts the result on the OTHER
 * client.
 */
export async function loginInModal(page: Page, creds: { email: string; password: string }): Promise<void> {
  // RegisterForm's onSwitchToLogin control: `<button type="button">Login</button>` inside
  // "Already have an account? Login". It's the only "Login"-named button on screen while the
  // modal is still in register mode, so an exact-name match is unambiguous.
  await page.getByRole('button', { name: 'Login', exact: true }).click()

  // LoginForm's email/password inputs have a sibling (non-`for`-associated) <label> and no
  // `id`, so they aren't reachable via getByLabel -- match on their placeholder text instead
  // (`t\`Email\`` / `t\`Password\`` from LoginForm.tsx).
  await page.getByPlaceholder('Email', { exact: true }).fill(creds.email)
  await page.getByPlaceholder('Password', { exact: true }).fill(creds.password)

  // LoginForm unmounts RegisterForm on mode switch, so this is now the only "Login" button
  // (the submit button renders "Login" when idle, "Logging in..." while submitting).
  await page.getByRole('button', { name: 'Login', exact: true }).click()
}

/**
 * Waits for the client's own `user-store` to re-key away from `previousUserId` after
 * `loginInModal` submits. The submit click only resolves once the form's network request is
 * sent -- the actual identity swap (prepareForIdentitySwapFn -> swapIdentityFn's
 * PREPARE_IDENTITY_SWAP round trip -> socket reconnect -> useUserStore.login()) finishes
 * asynchronously afterward. A plain "any valid identity" read (like `readUserIdentity`) resolves
 * immediately against the guest's own still-valid, not-yet-overwritten storage entry, so it
 * always reports the stale guest id -- this instead polls until the id actually changes.
 */
export async function waitForIdentitySwap(page: Page, previousUserId: string): Promise<UserIdentity> {
  const handle = await page.waitForFunction<UserIdentity | null, { previousUserId: string }>(
    ({ previousUserId }): UserIdentity | null => {
      try {
        const raw = localStorage.getItem('user-store') ?? sessionStorage.getItem('user-store')
        if (!raw) return null
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const state = (parsed.state ?? {}) as Record<string, unknown>
        const userId = state.userId
        const username = state.username
        if (!userId || !username || userId === previousUserId) return null
        return { userId: String(userId), username: String(username) }
      } catch {
        return null
      }
    },
    { previousUserId },
    { timeout: 25_000 },
  )
  const result = await handle.jsonValue()
  if (!result) {
    throw new Error(`waitForIdentitySwap: user-store never moved off "${previousUserId}" within timeout`)
  }
  return result
}
