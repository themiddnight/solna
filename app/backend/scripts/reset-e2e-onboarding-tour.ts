/**
 * E2E test-support: reset the onboarding-tour prompt flag for E2E users.
 *
 * DEV-220 (Phase 2) persists the onboarding-tour offer per-account
 * (`User.onboardingTourPromptedAt`): a verified user is offered the tour toast
 * at most once, ever. That makes `onboarding-tour.spec.ts` (which logs in as a
 * seeded verified user and expects the "Start Tour" toast) a one-shot — it
 * passes the first time, then the persisted flag suppresses the toast forever.
 *
 * This script nulls the flag for the seeded E2E users so the toast is offered
 * again. The tour spec runs it in `beforeEach` (retry-safe) before loading the
 * page; `checkAuth()` → `GET /auth/me` then re-hydrates the client with the
 * fresh `onboardingTourPromptedAt: null`, so the offer fires.
 *
 * Idempotent. Run:  bun run scripts/reset-e2e-onboarding-tour.ts   (from app/backend)
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendEnvPath = resolve(scriptDir, '../.env');
const frontendEnvPath = resolve(scriptDir, '../../frontend/.env');

// Load env vars manually into process.env (DATABASE_URL from backend .env) so the
// prisma singleton picks them up on its dynamic import below.
function loadEnvFile(filePath: string): void {
  try {
    if (!existsSync(filePath)) {
      console.warn(`[reset-e2e-tour] Warning: file does not exist at ${filePath}`);
      return;
    }
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const rawVal = trimmed.slice(eqIdx + 1).trim();
      const val = rawVal.replace(/^(['"])(.*)\1$/, '$2').replace(/\s#.*$/, '').trim();
      if (key) process.env[key] = val;
    }
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.warn(`[reset-e2e-tour] Warning: could not read env file ${filePath}: ${error.message ?? String(err)}`);
  }
}

// Backend env carries DATABASE_URL for Prisma; frontend env is loaded only for parity
// with seed-e2e-users (E2E_* live there) — not required for this reset.
loadEnvFile(backendEnvPath);
loadEnvFile(frontendEnvPath);

async function main(): Promise<void> {
  // Dynamic import after env is loaded (mirrors seed-e2e-users) so the prisma
  // singleton constructs with DATABASE_URL in process.env.
  const { prisma } = await import('../src/config/prisma');
  try {
    const result = await prisma.user.updateMany({
      where: { email: { startsWith: 'e2e.parallel.' } },
      data: { onboardingTourPromptedAt: null },
    });
    console.log(`[reset-e2e-tour] Reset onboardingTourPromptedAt for ${result.count} E2E user(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

// Importing `../src/config/prisma` pulls in backend singletons that hold the event
// loop open (so the process would otherwise never exit — the E2E `beforeEach` calls
// this synchronously via execFileSync and would hang). Force a clean exit on each path.
main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[reset-e2e-tour] Failed:', err);
    process.exit(1);
  });
