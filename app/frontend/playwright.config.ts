import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return

  const content = readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const rawVal = trimmed.slice(eqIdx + 1).trim()
    const val = rawVal.replace(/^(['"])(.*)\1$/, '$2').replace(/\s#.*$/, '').trim()
    if (key !== '' && !(key in process.env)) {
      process.env[key] = val
    }
  }
}

// Load local environment variables dynamically
loadLocalEnv()

// Ensure VITE_LOCAL_PROJECT is 'true' during E2E tests so project import/export tools are rendered
process.env.VITE_LOCAL_PROJECT = 'true'

const isSslEnabled = process.env.SSL_ENABLED === 'true'

// Allow Playwright's local webServer url checker to bypass self-signed SSL errors
if (isSslEnabled) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const protocol = isSslEnabled ? 'https' : 'http'
const host = '127.0.0.1'
const port = '4173'
const baseURL = `${protocol}://${host}:${port}`

function configuredUserCount(): number {
  const explicitCount = process.env.E2E_USER_COUNT
  if (explicitCount) {
    const parsed = Number.parseInt(explicitCount, 10)
    return Number.isFinite(parsed) ? parsed : 3
  }

  let count = 0
  for (let index = 1; ; index += 1) {
    const hasEmail = Boolean(process.env[`E2E_USER${index}_EMAIL`])
    const hasPassword = Boolean(process.env[`E2E_USER${index}_PASSWORD`])
    if (!hasEmail && !hasPassword) break
    count = index
  }
  return Math.max(count, 3)
}

function workerCount(): number {
  if (process.env.CI) return 1

  const requested = Number(process.env.E2E_WORKERS ?? 1)
  const safeRequested = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1
  const maxDistinctMultiUserWorkers = Math.max(1, Math.floor(configuredUserCount() / 3))

  return Math.min(safeRequested, maxDistinctMultiUserWorkers)
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  testIgnore: process.env.E2E_RUN_WEBRTC === 'true' ? [] : ['**/webrtc/**'],
  fullyParallel: process.env.E2E_FULLY_PARALLEL === 'true',
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: workerCount(),
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 120_000, // 120 seconds to tolerate occasional API limiter backoff retries in E2E
  use: {
    baseURL,
    storageState: 'e2e/.auth/user1.json',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: isSslEnabled,
  },
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // firefoxUserPrefs is a LaunchOptions field — it must live under launchOptions.
        // Placed directly on `use` it is silently ignored, so fake media never activates
        // and getUserMedia hangs forever on a permission prompt that never appears in headless.
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
            'media.autoplay.default': 0, // Allow autoplay
            'media.volume_scale': '0.0', // Suppress noise
          },
        },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ]
})
