import { chromium, type FullConfig } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env from jam-band-fe root — needed when Playwright is invoked from monorepo root
// (Playwright 1.x loads .env from CWD, not from config directory, so we handle it here)
async function loadEnvFile(): Promise<void> {
  const configDir = dirname(dirname(fileURLToPath(import.meta.url))) // e2e/ → jam-band-fe/
  const envPath = resolve(configDir, '.env')
  try {
    const content = await readFile(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      // Strip surrounding quotes and inline comments
      const rawVal = trimmed.slice(eqIdx + 1).trim()
      const val = rawVal.replace(/^(['"])(.*)\1$/, '$2').replace(/\s#.*$/, '').trim()
      if (key && !(key in process.env)) {
        process.env[key] = val
      }
    }
  } catch {
    // .env not found — caller will catch missing vars via requireEnv()
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `E2E setup: required environment variable "${name}" is not set.\n` +
        'Copy .env.example → .env.local and fill in E2E_USER* values.',
    )
  }
  return value
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value : undefined
}

function getConfiguredUserCount(): number {
  const explicitCount = readOptionalEnv('E2E_USER_COUNT')
  if (explicitCount) {
    const parsed = Number.parseInt(explicitCount, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`E2E_USER_COUNT must be a positive integer. Received: ${explicitCount}`)
    }
    return parsed
  }

  let count = 0
  for (let index = 1; ; index += 1) {
    const hasEmail = Boolean(readOptionalEnv(`E2E_USER${index}_EMAIL`))
    const hasPassword = Boolean(readOptionalEnv(`E2E_USER${index}_PASSWORD`))
    if (!hasEmail && !hasPassword) break
    count = index
  }

  return count
}

async function loginUser(
  baseURL: string,
  email: string,
  password: string,
  outputPath: string,
): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    ignoreHTTPSErrors: process.env.SSL_ENABLED === 'true',
  })
  const page = await context.newPage()
  try {
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(password)
    await page.getByRole('button', { name: /^Login$/ }).click()
    await page.waitForURL(`${baseURL}/`, { timeout: 30_000 })

    // Wait for user-store to be populated with authenticated state
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('user-store')
        if (!raw) return false
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const state = (parsed.state ?? parsed) as Record<string, unknown> | undefined
        return (state?.isAuthenticated as boolean) === true && !!(state?.userId as string) && !!(state?.username as string)
      } catch {
        return false
      }
    }, { timeout: 10_000 })

    await page.context().storageState({ path: outputPath })
  } finally {
    await browser.close()
  }
}

async function globalSetup(config: FullConfig): Promise<void> {
  await loadEnvFile()

  const project = config.projects[0]
  const baseURL = (project && (project as { use?: { baseURL?: string } }).use?.baseURL) as string | undefined
  if (!baseURL) throw new Error('Playwright baseURL is required for global setup.')

  await mkdir('e2e/.auth', { recursive: true })

  const userCount = getConfiguredUserCount()
  if (userCount < 3) {
    throw new Error('E2E setup requires at least 3 users for multi-user scenarios.')
  }

  const users = Array.from({ length: userCount }, (_, i) => {
    const index = i + 1
    return {
      email: requireEnv(`E2E_USER${index}_EMAIL`),
      password: requireEnv(`E2E_USER${index}_PASSWORD`),
      output: `e2e/.auth/user${index}.json`,
    }
  })

  // Login sequentially — avoid parallel browser instances in global setup
  for (const user of users) {
    await loginUser(baseURL, user.email, user.password, user.output)
  }
}

export default globalSetup
