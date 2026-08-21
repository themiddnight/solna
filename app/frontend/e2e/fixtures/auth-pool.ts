import type { BrowserContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_USER_COUNT = 3
let isEnvLoaded = false

function loadEnvFileOnce(): void {
  if (isEnvLoaded) return
  isEnvLoaded = true

  const frontendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
  const envPath = resolve(frontendDir, '.env')

  try {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const rawVal = trimmed.slice(eqIdx + 1).trim()
      const val = rawVal.replace(/^(['"])(.*)\1$/, '$2').replace(/\s#.*$/, '').trim()
      if (key && !(key in process.env)) {
        process.env[key] = val
      }
    }
  } catch {
    // global-setup.ts performs the required env validation.
  }
}

export function getE2EUserCount(): number {
  loadEnvFileOnce()

  const raw = process.env.E2E_USER_COUNT
  if (!raw) return DEFAULT_USER_COUNT

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < DEFAULT_USER_COUNT) {
    throw new Error(`E2E_USER_COUNT must be at least ${DEFAULT_USER_COUNT}. Received: ${raw}`)
  }

  return parsed
}

export function getWorkerUserIndex(workerIndex: number, offset = 0): number {
  const userCount = getE2EUserCount()
  return ((workerIndex * DEFAULT_USER_COUNT + offset) % userCount) + 1
}

export function getStorageStatePathForUser(userIndex: number): string {
  return `e2e/.auth/user${userIndex}.json`
}

export function getE2EUserCredentials(userIndex: number): { email: string; password: string } {
  loadEnvFileOnce()
  const email = process.env[`E2E_USER${userIndex}_EMAIL`]
  const password = process.env[`E2E_USER${userIndex}_PASSWORD`]
  if (!email || !password) {
    throw new Error(`Missing E2E_USER${userIndex}_EMAIL or E2E_USER${userIndex}_PASSWORD in .env`)
  }
  return { email, password }
}

/** Mock the health check on a context so the app never redirects to /offline during tests. */
export async function mockHealthCheck(context: BrowserContext): Promise<void> {
  await context.route('**/api/health*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }),
  )
}
