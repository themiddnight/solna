/**
 * Preloaded by bunfig.toml [test].preload whenever someone runs `bun test`
 * inside app/backend. Backend tests run on Jest (ts-jest) — under Bun's
 * runner, jest.mock factories don't apply and produce FALSE FAILURES.
 * This guard fails fast instead of letting misleading results through.
 */
throw new Error(
  [
    "",
    "✗ app/backend tests run on Jest, not `bun test`.",
    "  Under Bun's runner, jest.mock factories don't apply → false failures.",
    "  Use instead:",
    "    bun run test:unit         (fast, no infra)",
    "    bun run test:integration  (needs Redis + Postgres)",
    "    bun run test              (jest, all)",
    "",
  ].join("\n"),
);
