import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcrypt'

// Find paths
const scriptDir = dirname(fileURLToPath(import.meta.url))
const backendEnvPath = resolve(scriptDir, '../.env')
const frontendEnvPath = resolve(scriptDir, '../../frontend/.env')

// Helper function to read and load env variables manually into process.env
function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    if (!existsSync(filePath)) {
      console.warn(`[seed-users] Warning: file does not exist at ${filePath}`)
      return env
    }
    const content = readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const rawVal = trimmed.slice(eqIdx + 1).trim()
      const val = rawVal.replace(/^(['"])(.*)\1$/, '$2').replace(/\s#.*$/, '').trim()
      if (key) {
        env[key] = val
        process.env[key] = val // Force update
      }
    }
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.warn(`[seed-users] Warning: Could not read env file ${filePath}: ${error.message ?? String(err)}`)
  }
  return env
}

// Load backend env (needed for DATABASE_URL for Prisma)
loadEnvFile(backendEnvPath)

// Load frontend env (needed for E2E_USER credentials)
const frontendEnv = loadEnvFile(frontendEnvPath)

async function main() {
  // Use dynamic import to prevent ESM hoisting, ensuring DATABASE_URL is in process.env first
  const { prisma } = await import('../src/config/prisma')
  const { UserType, UserRole } = await import('@prisma/client')

  try {
    const userCountRaw = frontendEnv['E2E_USER_COUNT']
    if (!userCountRaw) {
      console.error('[seed-users] E2E_USER_COUNT not set in frontend .env')
      process.exit(1)
    }

    const userCount = parseInt(userCountRaw, 10)
    if (isNaN(userCount) || userCount < 1) {
      console.error(`[seed-users] Invalid E2E_USER_COUNT: ${userCountRaw}`)
      process.exit(1)
    }

    console.log(`[seed-users] Seeding ${userCount} users...`)

    for (let i = 1; i <= userCount; i++) {
      const email = frontendEnv[`E2E_USER${i}_EMAIL`]
      const password = frontendEnv[`E2E_USER${i}_PASSWORD`]
      if (!email || !password) {
        console.warn(`[seed-users] Credentials for E2E_USER${i} not found in .env, skipping`)
        continue
      }

      const username = email.split('@')[0] || `e2e_user${i}`

      // User 1 owns the project fixtures seeded by `seed-e2e-projects.ts`, which needs 5
      // arrange projects — more than the REGISTERED cap of 3 (BR-5, shared/constants/
      // ProjectLimits.ts). ARTIST (10) covers the fixtures while still being a *finite*
      // limit, so the at-limit code paths stay reachable; PRO would make them dead.
      // Every other E2E user stays REGISTERED so the default tier remains the one under test.
      const userType = i === 1 ? UserType.ARTIST : UserType.REGISTERED

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      })

      if (existingUser) {
        console.log(`[seed-users] User ${email} already exists (id: ${existingUser.id})`)
        
        // Always update password to match current .env — users may have been
        // created with a different password in a previous session.
        const passwordHash = await bcrypt.hash(password, 10)
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            emailVerified: true,
            passwordHash,
            // Also converge the tier — this branch used to leave `userType` untouched, so a
            // user created by an earlier run kept its old tier forever and re-seeding could
            // never repair it.
            userType,
          },
        })
        console.log(`[seed-users] Updated ${email} password + emailVerified + userType=${userType}`)
        continue
      }

      // Create user
      console.log(`[seed-users] Creating user ${email}...`)
      const passwordHash = await bcrypt.hash(password, 10)
      const user = await prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          emailVerified: true,
          userType,
          role: UserRole.USER,
        },
      })
      console.log(`[seed-users] Created user ${email} (id: ${user.id})`)
    }

    console.log('[seed-users] Seeding completed.')
  } finally {
    await prisma.$disconnect()
  }
}

// Importing `../src/config/prisma` (line 48) pulls in backend singletons that hold the event
// loop open, so `$disconnect()` alone is not enough — the process prints "Seeding completed."
// and then hangs forever. That matters beyond the annoyance: `e2e:seed` chains this script
// with `&&`, so the hang meant the project-fixture seed after it never ran at all. Force a
// clean exit on each path, exactly as `reset-e2e-onboarding-tour.ts` does.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
