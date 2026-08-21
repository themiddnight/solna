/**
 * E2E Seed Script — arrange project fixtures for E2E test users
 *
 * Run this once after a DB or storage reset, before running E2E tests.
 * It is idempotent: if a fixture already exists it exits early.
 *
 * Usage:
 *   bun run e2e:seed          (from app/frontend/)
 *   bun e2e/scripts/seed-e2e-projects.ts  (direct)
 *
 * Required env vars:
 *   VITE_API_URL        — backend base URL, defaults to http://localhost:3001
 *   E2E_USER1_EMAIL / E2E_USER1_PASSWORD  — primary test user
 *   E2E_USER2_EMAIL / E2E_USER2_PASSWORD  — second test user
 *
 * BUCKET_* env vars must match the running backend so project.json is written to B2.
 */

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared'

// ── Constants ────────────────────────────────────────────────────────────────

const FIXTURE_PROJECT_NAME = '[E2E] Arrange Base'

// Projects for BR-6 (visibility)
const BR6_PUBLIC_NAME = '[E2E] BR-6 Public'
const BR6_BAND_NAME   = '[E2E] BR-6 Band'

// Band for BR-6 / BR-9
const FIXTURE_BAND_NAME = '[E2E] Band'

// Project for BR-13 (contributor)
const BR13_CONTRIBUTOR_NAME = '[E2E] BR-13 Contributor'

// Minimal valid ProjectData — empty room, BPM 120.
const MINIMAL_PROJECT_DATA = {
  version: PROJECT_SCHEMA_VERSION,
  metadata: {
    name: FIXTURE_PROJECT_NAME,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  },
  project: {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    gridDivision: 16,
    loop: { enabled: false, start: 0, end: 8 },
    isMetronomeEnabled: false,
    snapToGrid: true,
  },
  tracks: [],
  regions: [],
  effectChains: {},
  synthStates: {},
  markers: [],
}

// ── Env loading ──────────────────────────────────────────────────────────────

async function loadEnv(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(scriptDir, '../../.env')
  try {
    const content = await readFile(envPath, 'utf-8')
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
    // .env not found — rely on process.env set by caller
  }
}

function readOptionalEnv(name: string): string | undefined {
  const val = process.env[name]
  return val && val.trim() ? val : undefined
}

function requireEnv(name: string): string {
  const val = readOptionalEnv(name)
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

// ── API helpers ──────────────────────────────────────────────────────────────

/**
 * Build the auth header, asserting the value actually looks like a JWT.
 *
 * The seed helpers take `(token, label, name)` — three `string`s, so TypeScript cannot catch a
 * caller that passes them in the wrong order. When that happened the label was sent as the
 * bearer token and the API answered `401 Invalid or expired token`, which reads as "the
 * credentials are stale" and sends you looking at auth, seeding, and the DB — when in fact no
 * token was ever sent. Failing here instead names the real mistake at the call site.
 */
function authHeader(token: string): Record<string, string> {
  if (token.split('.').length !== 3) {
    throw new Error(
      `Expected a JWT but received ${JSON.stringify(token.slice(0, 32))} — ` +
        'check the argument order: helpers take (token, label, name).'
    )
  }
  return { Authorization: `Bearer ${token}` }
}

function apiBase(): string {
  return process.env.VITE_API_URL ?? 'http://localhost:3001'
}

let globalUser1Token: string | undefined
let globalUser2Token: string | undefined

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${apiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Login failed (${res.status}): ${body}`)
  }
  const data = await res.json() as Record<string, unknown>
  const accessToken = (data.accessToken ?? data.token ?? '') as string
  if (!accessToken) {
    console.warn('[seed] No token in login response:', JSON.stringify(data).slice(0, 200))
    throw new Error('Login response missing accessToken')
  }
  // JWT prefix hint for debugging
  const preview = accessToken.length > 30 ? accessToken.slice(0, 30) + '...' : accessToken
  console.warn(`[seed] Got token: ${preview} (len=${accessToken.length})`)
  return accessToken
}

async function ensureLoggedInUser1(): Promise<string> {
  if (!globalUser1Token) globalUser1Token = await login(requireEnv('E2E_USER1_EMAIL'), requireEnv('E2E_USER1_PASSWORD'))
  return globalUser1Token
}

async function ensureLoggedInUser2(): Promise<string> {
  if (!globalUser2Token) globalUser2Token = await login(requireEnv('E2E_USER2_EMAIL'), requireEnv('E2E_USER2_PASSWORD'))
  return globalUser2Token
}

async function listProjects(token: string): Promise<Array<{ id: string; name: string; roomType: string; visibility: string }>> {
  const res = await fetch(`${apiBase()}/api/projects`, {
    headers: authHeader(token),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GET /api/projects failed (${res.status}): ${body}`)
  }
  const data = await res.json() as { owned?: Array<{ id: string; name: string; roomType: string; visibility: string }> }
  return data.owned ?? []
}

async function createProject(token: string, name: string): Promise<string> {
  const form = new FormData()
  form.append('name', name)
  form.append('roomType', 'arrange')
  form.append('projectData', JSON.stringify({
    ...MINIMAL_PROJECT_DATA,
    metadata: { ...MINIMAL_PROJECT_DATA.metadata, name },
  }))
  form.append('allowFork', 'false')

  const res = await fetch(`${apiBase()}/api/projects`, {
    method: 'POST',
    headers: authHeader(token),
    body: form,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`POST /api/projects failed (${res.status}): ${body}`)
  }
  const data = await res.json() as { project?: { id: string } }
  if (!data.project?.id) throw new Error('Create project response missing project.id')
  return data.project.id
}

async function setProjectVisibility(
  token: string,
  projectId: string,
  visibility: 'PRIVATE' | 'BAND' | 'PUBLIC',
  bandIds: string[] = [],
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/projects/${projectId}/visibility`, {
    method: 'PATCH',
    headers: {
      ...authHeader(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ visibility, bandIds }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`PATCH /api/projects/${projectId}/visibility failed (${res.status}): ${body}`)
  }
}

async function createBand(token: string, name: string): Promise<{ id: string; inviteToken: string }> {
  const res = await fetch(`${apiBase()}/api/bands`, {
    method: 'POST',
    headers: {
      ...authHeader(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`POST /api/bands failed (${res.status}): ${body}`)
  }
  const data = await res.json() as { band?: { id: string; inviteToken: string } }
  if (!data.band?.id) throw new Error('Create band response missing band.id')
  return data.band
}

// NOTE: the list response deliberately omits `inviteToken` (see BandApplicationService
// `listBands` → `formattedBands`). Typing it as present here made `joinBand` request
// `/api/bands/join/undefined`, which the API answered with 404 "Invalid invite link" — a
// message that points at the token being wrong rather than absent. Fetch the token from
// the detail endpoint instead, which returns it to the band OWNER.
async function listBands(token: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${apiBase()}/api/bands`, {
    headers: authHeader(token),
  })
  if (!res.ok) throw new Error(`GET /api/bands failed (${res.status})`)
  const data = await res.json() as { bands?: Array<{ id: string; name: string }> }
  return data.bands ?? []
}

async function getBandInviteToken(token: string, bandId: string): Promise<string> {
  const res = await fetch(`${apiBase()}/api/bands/${bandId}`, {
    headers: authHeader(token),
  })
  if (!res.ok) throw new Error(`GET /api/bands/${bandId} failed (${res.status})`)
  const data = await res.json() as { band?: { inviteToken?: string } }
  const inviteToken = data.band?.inviteToken
  if (!inviteToken) {
    throw new Error(`Band ${bandId} returned no inviteToken — the caller must be its OWNER.`)
  }
  return inviteToken
}

async function joinBand(token: string, inviteToken: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/bands/join/${inviteToken}`, {
    method: 'POST',
    headers: authHeader(token),
  })
  if (!res.ok && res.status !== 409) {
    const body = await res.text()
    throw new Error(`POST /api/bands/join failed (${res.status}): ${body}`)
  }
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function ensureProject(token: string, label: string, name: string): Promise<string> {
  const projects = await listProjects(token)
  const existing = projects.find((p) => p.name === name && p.roomType === 'arrange')
  if (existing) {
    console.warn(`[seed:${label}] ✓ Fixture "${name}" exists (id: ${existing.id})`)
    return existing.id
  }
  const projectId = await createProject(token, name)
  console.warn(`[seed:${label}] ✓ Created "${name}" (id: ${projectId})`)
  return projectId
}

async function ensureBand(token: string, label: string, name: string): Promise<{ id: string; inviteToken: string }> {
  const bands = await listBands(token)
  const existing = bands.find((b) => b.name === name)
  if (existing) {
    const inviteToken = await getBandInviteToken(token, existing.id)
    console.warn(`[seed:${label}] ✓ Band "${name}" exists (id: ${existing.id}, token: ${inviteToken})`)
    return { id: existing.id, inviteToken }
  }
  const band = await createBand(token, name)
  console.warn(`[seed:${label}] ✓ Created band "${name}" (id: ${band.id}, token: ${band.inviteToken})`)
  return band
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadEnv()

  // ── User 1: base arrange project ────────────────────────────────────
  const user1Token = await ensureLoggedInUser1()
  await ensureProject(user1Token, 'user1', FIXTURE_PROJECT_NAME)

  // ── User 1: BR-6 projects ───────────────────────────────────────────
  // PRIVATE project (default — already private)
  await ensureProject(user1Token, 'user1', 'BR-6 Private')

  // PUBLIC project
  const publicId = await ensureProject(user1Token, 'user1', BR6_PUBLIC_NAME)
  await setProjectVisibility(user1Token, publicId, 'PUBLIC')
  console.warn(`[seed:user1] ✓ Set "${BR6_PUBLIC_NAME}" visibility → PUBLIC`)

  // BAND project — create band first, then share
  const e2eBand = await ensureBand(user1Token, 'user1', FIXTURE_BAND_NAME)
  const bandId = e2eBand.id
  const bandProjectId = await ensureProject(user1Token, 'user1', BR6_BAND_NAME)
  await setProjectVisibility(user1Token, bandProjectId, 'BAND', [bandId])
  console.warn(`[seed:user1] ✓ Set "${BR6_BAND_NAME}" visibility → BAND (band: ${bandId})`)

  // ── User 1: BR-13 contributor project ───────────────────────────────
  const contributorId = await ensureProject(user1Token, 'user1', BR13_CONTRIBUTOR_NAME)
  await setProjectVisibility(user1Token, contributorId, 'PUBLIC')
  console.warn(`[seed:user1] ✓ Set "${BR13_CONTRIBUTOR_NAME}" visibility → PUBLIC`)

  // ── User 2: join band + verify ──────────────────────────────────────
  const user2Email = readOptionalEnv('E2E_USER2_EMAIL')
  const user2Password = readOptionalEnv('E2E_USER2_PASSWORD')
  if (user2Email && user2Password) {
    const user2Token = await ensureLoggedInUser2()
    // Join the E2E band using the token from ensureBand above — re-listing the bands here
    // would lose it, since the list response omits inviteToken.
    await joinBand(user2Token, e2eBand.inviteToken)
    console.warn(`[seed:user2] ✓ Joined band "${FIXTURE_BAND_NAME}"`)
  } else {
    console.warn('[seed] E2E_USER2 credentials not set — skipping user2 seed.')
  }

  console.warn('[seed] Done. All E2E fixtures ready.')
}

main().catch((err) => {
  console.error('[seed] ✗', err instanceof Error ? err.message : err)
  process.exit(1)
})
