# Findings Ledger — feat/DEV-333-user-preferences-persistence

| id | round found | severity | finding (file:line) | status | notes |
|----|-------------|----------|---------------------|--------|-------|
| W1 | 1 | WARNING | userPreferencesSync.ts — hydrate/subscribe TOCTOU race | verified (r2) | R1 partial fix. R2: revision counter + isHydrating flag + mock write fix + C1a test |
| C1a | 2 | CRITICAL | userPreferencesSync.ts — residual TOCTOU when flush clears pending before GET resolves | verified | Fixed: monotonic revision counter survives flush() |
| C1b | 2 | CRITICAL | userPreferencesSync.ts — echo-commit on every boot from subscribe-before-fetch | verified | Fixed: isHydrating flag suppresses scheduleCommit during hydrate |
| C1c | 2 | CRITICAL | userPreferencesSync.test.ts — mock write doesn't fire listener, suite greenlights bugs | verified | Fixed: mock write fires listener, isHydrating makes "server overwrites" test real |
| W2 | 1 | WARNING | instrumentSettings.ts — melodyOctave 4 vs ticket AC 3 | deferred | Owner: keep 4, updated DEV-333 ticket |
| W3 | 1 | WARNING | userPreferencesSchema.ts — patch schema not .strict() | verified | Fixed: .strict() + tests |
| W4 | 1 | WARNING | userPreferencesSchema.ts — padOrder regex too loose | verified | Fixed: z.enum(PAD_IDS) closed set |
| W5 | 1 | WARNING | 4x instrument stores — mode casts w/o validation | verified | Fixed: validated in getMode, no casts |
| W6 | 1 | WARNING | AuthController.ts — comment overclaims atomicity | verified | Fixed: softened comment |
| W7 | 1 | WARNING | themeStore.ts — stale comment | verified | Fixed: updated |
| S1-S5 | 1 | MINOR | various | verified | All fixed by worker |
| S6 | 1 | MINOR | i18n.ts — browser-language detection | disputed | Intentional design, no fix needed |
