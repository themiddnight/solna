<!-- doc-sync: codebase-reference -->
# Auth Domain

The auth domain intentionally has a pragmatic infrastructure-heavy shape because it owns Express middleware, Passport strategies, token handling, OAuth callbacks, and HTTP controller behavior.

These pieces are framework integration boundaries rather than pure domain logic, so the domain does not mirror the standard application/domain/infrastructure layering as strictly as room-management.

> Related global contract: [`docs/AUTHENTICATION_FLOW.md`](../../../../../docs/AUTHENTICATION_FLOW.md) (token lifecycle, OAuth, guest identity).

## Code map

| File | Responsibility |
|---|---|
| `domain/services/AuthService.ts` | Core auth logic — credential verification, registration, guest handling. |
| `domain/services/TokenService.ts` | Access/refresh token issue, verify, rotate. |
| `domain/models/User.ts` · `EmailVerification.ts` · `PasswordReset.ts` | Domain models for the auth entities. |
| `infrastructure/controllers/AuthController.ts` | HTTP controller for the `/auth` routes. |
| `infrastructure/middleware/authMiddleware.ts` | `authenticateToken`/`authenticateTokenAllowGuest`/`optionalAuth`/`optionalAuthAllowGuest` — attach `req.user` from the verified token; each enforces the OTP hard gate via `isUnverifiedRegistered`. |
| `infrastructure/middleware/guestLimitations.ts` | Enforces guest-tier restrictions per request. |
| `infrastructure/refreshTokenCookie.ts` | Refresh-token cookie set/clear helpers. |
| `infrastructure/repositories/UserRepository.ts` | Prisma-backed user persistence. |
| `infrastructure/services/EmailService.ts` | Transactional email (Resend) — verification, reset. |
| `infrastructure/services/OAuthExchangeService.ts` | OAuth code→token exchange for the popup flow. |
| `infrastructure/strategies/googleStrategy.ts` · `localStrategy.ts` | Passport strategies (Google OAuth, local password). |

## Invariants & gotchas

1. **Acting identity comes from the verified token, never the client payload** (TR-33) — `authMiddleware` derives `req.user`; controllers/services must not trust `req.body.userId`. Codified by the middleware being the only writer of `req.user`.
2. **Framework-boundary layering is deliberate** — strategies/middleware/controllers live in `infrastructure/`; do not "purify" them into `domain/`. New pure logic still goes in `domain/services`.
3. **Guest vs registered gating** is enforced at the boundary via `guestLimitations` + `requireRegistered`; keep tier checks there, not scattered in services.
4. **OTP hard gate — tokens are only ever minted for a verified account.** `AuthService.register()` returns an OTP challenge (`verificationSessionToken`/`otpExpiresAt`/`resendAvailableAt`), never tokens; `login()` returns the same challenge shape (`verificationRequired: true`, no cookie) instead of tokens when `emailVerified` is `false`; `refreshAccessToken()` throws if the token's account is unverified. Only `verifyEmailByCode()` (auto-login after a correct code) and a verified `login()`/OAuth call ever call the private `issueTokenPair()`. There is **no** dedicated `requireVerifiedUser` middleware anymore — it was deleted; the check now lives inside `authenticateToken`/`authenticateTokenAllowGuest`/`optionalAuth`/`optionalAuthAllowGuest` themselves via the exported `isUnverifiedRegistered(user)` helper (strict variants → `401`, optional variants silently degrade to anonymous). The Socket.IO equivalent — the choke point for every namespace connection — is `resolveSocketUser` in `app/backend/src/config/socket.ts`, which returns `null` (rejecting the connection) for an unverified registered identity so `socket.data.user` can never be populated with one.
5. **Resend is a single unauthenticated endpoint, cooldown-gated.** `POST /auth/resend-verification-code` (`AuthService.resendVerificationCode`) takes the `verificationSessionToken`, not an access token — there is no separate authenticated resend endpoint. Within the 60s cooldown (`findPendingChallenge`) it throws `OtpCooldownError` (mapped to `429 { error, resendAvailableAt }` in `AuthController`) and **reuses** the still-pending code instead of minting a new one; past the cooldown it mints and emails a fresh code via `issueEmailVerificationCode`.
6. **OAuth linking verifies and conditionally clears the password.** `resolveOAuthUser()` sets `emailVerified: true` when linking an existing account by email (the provider proved ownership), and nulls the account's password hash **only if it was previously unverified** — closing a pre-hijack window (attacker registers the victim's email with a known password, never verifies, waits for the victim's first Google sign-in to bless the account) without touching passwords on accounts that were already legitimately verified. It also revokes all pre-existing refresh tokens on link, mirroring `verifyEmailByCode`.
