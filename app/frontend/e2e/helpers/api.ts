import type { Page } from '@playwright/test'
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared'
import { makeAuthHeaders } from './auth'

// Force IPv4 — Node.js resolves `localhost` to ::1 on macOS but the backend only binds 127.0.0.1
const DEFAULT_API_BASE = (process.env.VITE_API_URL ?? 'http://localhost:3001').replace('localhost', '127.0.0.1')

type ProjectSummary = {
  [key: string]: unknown
  id: string
  name: string
  roomType?: string
  visibility?: string
  isLocked?: boolean
}

export type LobbyRoom = {
  [key: string]: unknown
  id: string
  name: string
  roomType: 'perform' | 'arrange'
  isPrivate: boolean
  isHidden: boolean
  userCount?: number
}

/**
 * GET /api/rooms — returns lobby room list for the authenticated user.
 */
export async function listRooms(
  page: Page,
  apiBase = DEFAULT_API_BASE,
): Promise<LobbyRoom[]> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.get(`${apiBase}/api/rooms`, { headers })
  if (!res.ok()) return []
  const data = (await res.json()) as LobbyRoom[] | { rooms: LobbyRoom[] }
  return Array.isArray(data) ? data : data.rooms
}

/**
 * GET /api/rooms/:id/exists — check if a room has active socket connections.
 */
export async function checkRoomExists(
  page: Page,
  roomId: string,
  apiBase = DEFAULT_API_BASE,
): Promise<{ exists: boolean; userCount: number }> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.get(`${apiBase}/api/rooms/${roomId}/exists`, { headers })
  if (!res.ok()) return { exists: false, userCount: 0 }
  return res.json() as Promise<{ exists: boolean; userCount: number }>
}

/**
 * Read { username, userId } from the Zustand user-store. Registered users persist it to
 * localStorage; guests persist it to sessionStorage (2026-07-04, session-scoped guests).
 * Mirror the app's read routing (identityAwareStorage in shared/stores/userStore.ts):
 * prefer localStorage, then sessionStorage.
 * Uses page.waitForFunction to handle cases where the store isn't populated immediately after navigation.
 */
async function readUserStoreFromPage(page: Page): Promise<{ username: string; userId: string } | null> {
  const result = await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('user-store') ?? sessionStorage.getItem('user-store')
      if (!raw) return null
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const state = (parsed.state ?? parsed) as Record<string, unknown> | undefined
      const username = state?.username as string | undefined
      const userId = state?.userId as string | undefined
      if (!username || !userId) return null
      // Return atomically — avoids race between check and separate evaluate call.
      return { username: String(username), userId: String(userId) }
    } catch {
      return null
    }
  }, { timeout: 15_000 }).catch(() => null)

  if (!result) return null
  return result.jsonValue()
}

async function getUserIdentity(page: Page): Promise<{ username: string; userId: string }> {
  let identity = await readUserStoreFromPage(page)
  if (identity) return identity

  // Fallback: app may have cleared user-store due to a transient /api/auth/me failure under
  // parallel load. Reload once to let the app re-authenticate from the stored tokens.
  await page.reload({ waitUntil: 'load' }).catch(() => {})
  await page.waitForTimeout(2_000)

  identity = await readUserStoreFromPage(page)
  if (identity) return identity

  const raw = await page.evaluate(() => localStorage.getItem('user-store') ?? sessionStorage.getItem('user-store')).catch(() => null)
  throw new Error(`Timeout waiting for user-store identity after reload. user-store (local||session): ${raw}`)
}

/**
 * GET /api/projects — returns the authenticated user's owned + contributed projects.
 */
export async function listUserProjects(
  page: Page,
  apiBase = DEFAULT_API_BASE,
): Promise<{ owned: ProjectSummary[]; contributed: ProjectSummary[] }> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.get(`${apiBase}/api/projects`, { headers })
  if (!res.ok()) return { owned: [], contributed: [] }
  const data = (await res.json()) as { owned: ProjectSummary[]; contributed: ProjectSummary[] }
  return { owned: data.owned, contributed: data.contributed }
}

export async function createArrangeProjectViaAPI(
  page: Page,
  name: string,
  apiBase = DEFAULT_API_BASE,
): Promise<ProjectSummary> {
  const authHeaders = await makeAuthHeaders(page)
  const headers = authHeaders.Authorization ? { Authorization: authHeaders.Authorization } : {}
  const now = new Date().toISOString()
  const projectData = {
    version: PROJECT_SCHEMA_VERSION,
    metadata: { name, createdAt: now, modifiedAt: now },
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
  const res = await page.request.post(`${apiBase}/api/projects`, {
    headers,
    multipart: {
      name,
      roomType: 'arrange',
      projectData: JSON.stringify(projectData),
      allowFork: 'false',
    },
  })
  if (!res.ok()) {
    throw new Error(`createArrangeProjectViaAPI failed: ${res.status()} ${await res.text()}`)
  }
  const data = (await res.json()) as { project: ProjectSummary }
  return data.project
}

export async function deleteProjectViaAPI(
  page: Page,
  projectId: string,
  apiBase = DEFAULT_API_BASE,
): Promise<void> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.delete(`${apiBase}/api/projects/${projectId}`, { headers })
  if (!res.ok() && res.status() !== 404) {
    throw new Error(`deleteProjectViaAPI failed: ${res.status()} ${await res.text()}`)
  }
}

export async function getProjectActiveRoomInfoViaAPI(
  page: Page,
  projectId: string,
  apiBase = DEFAULT_API_BASE,
): Promise<{
  activeRoomId: string | null
  activeUserCount: number
  isPrivate: boolean
  roomType: 'perform' | 'arrange'
}> {
  const res = await page.request.get(`${apiBase}/api/projects/${projectId}/active-room-info`)
  if (!res.ok()) {
    throw new Error(`getProjectActiveRoomInfoViaAPI failed: ${res.status()} ${await res.text()}`)
  }
  return res.json() as Promise<{
    activeRoomId: string | null
    activeUserCount: number
    isPrivate: boolean
    roomType: 'perform' | 'arrange'
  }>
}

function parseRetryAfterMs(headers: Record<string, string>, responseText: string): number {
  const retryAfterHeader = headers['retry-after']
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000
    }
  }

  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>
    const retryAfter = parsed.retryAfter
    if (typeof retryAfter === 'string') {
      const minutesMatch = retryAfter.match(/(\d+)\s*minute/i)
      if (minutesMatch) {
        return Number(minutesMatch[1]) * 60_000
      }

      const secondsMatch = retryAfter.match(/(\d+)\s*second/i)
      if (secondsMatch) {
        return Number(secondsMatch[1]) * 1000
      }
    }
  } catch {
    // ignore parse failures and fall back to default
  }

  // API currently returns "1 minute" for 429 responses.
  return 60_000
}

/**
 * POST /api/rooms — create a room directly via API (bypasses UI modal).
 * Returns the created room object with its `id`.
 * NOTE: the backend requires username + userId in the body; we read them from
 * the Zustand user-store (localStorage for registered, sessionStorage for guests) so callers
 * don't have to supply them.
 */
export async function createRoomViaAPI(
  page: Page,
  data: {
    name: string
    roomType: 'perform' | 'arrange'
    isPrivate?: boolean
    isHidden?: boolean
    description?: string
    /** DEV-221: request a solo, isolated onboarding-tour room (server forces isHidden+isIsolated). */
    isTourRoom?: boolean
  },
  apiBase = DEFAULT_API_BASE,
): Promise<LobbyRoom> {
  const headers = await makeAuthHeaders(page)
  const { username, userId } = await getUserIdentity(page)
  const body = {
    name: data.name,
    roomType: data.roomType,
    isPrivate: data.isPrivate ?? false,
    isHidden: data.isHidden ?? false,
    description: data.description,
    username,
    userId,
    ...(data.isTourRoom === true ? { isTourRoom: true } : {}),
  }

  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await page.request.post(`${apiBase}/api/rooms`, { headers, data: body })
      if (res.ok()) {
        const resp = (await res.json()) as { success?: boolean; room?: LobbyRoom }
        // API returns { success, room, user } — unwrap room
        return (resp.room ?? resp) as LobbyRoom
      }

      const responseText = await res.text()
      if (res.status() === 429 && attempt < maxAttempts) {
        const waitMs = parseRetryAfterMs(res.headers(), responseText)
        await page.waitForTimeout(waitMs)
        continue
      }

      throw new Error(`createRoomViaAPI failed: ${res.status()} ${responseText}`)
    } catch (error) {
      if (attempt < maxAttempts) {
        // Exponential backoff: 2s, 4s — handles transient ETIMEDOUT under parallel load
        await page.waitForTimeout(2_000 * attempt)
        continue
      }
      throw error
    }
  }

  throw new Error('createRoomViaAPI failed after retries')
}

/**
 * PUT /api/projects/:id/active-room — associate a project with a room.
 * Pass `roomId = null` to clear the active room.
 */
export async function setProjectActiveRoom(
  page: Page,
  projectId: string,
  roomId: string | null,
  apiBase = DEFAULT_API_BASE,
): Promise<void> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.put(`${apiBase}/api/projects/${projectId}/active-room`, {
    headers,
    data: { roomId },
  })
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`setProjectActiveRoom failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * POST /api/rooms/:roomId/projects/load — load an existing project into an arrange room.
 */
export async function loadProjectIntoRoomViaAPI(
  page: Page,
  roomId: string,
  projectId: string,
  apiBase = DEFAULT_API_BASE,
): Promise<void> {
  const headers = await makeAuthHeaders(page)
  const { username, userId } = await getUserIdentity(page)
  const res = await page.request.post(`${apiBase}/api/rooms/${roomId}/projects/load`, {
    headers,
    data: { projectId, userId, username },
  })
  if (!res.ok()) {
    throw new Error(`loadProjectIntoRoomViaAPI failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * POST /api/rooms/:roomId/leave — remove the authenticated user from a room via HTTP.
 */
export async function leaveRoomViaAPI(
  page: Page,
  roomId: string,
  apiBase = DEFAULT_API_BASE,
): Promise<void> {
  const headers = await makeAuthHeaders(page)
  const { userId } = await getUserIdentity(page)
  const res = await page.request.post(`${apiBase}/api/rooms/${roomId}/leave`, {
    headers,
    data: { userId },
  })
  if (!res.ok()) {
    throw new Error(`leaveRoomViaAPI failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * PATCH /api/projects/:id/lock — set the isLocked flag on a project.
 */
export async function lockProjectViaAPI(
  page: Page,
  projectId: string,
  isLocked: boolean,
  apiBase = DEFAULT_API_BASE,
): Promise<void> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.patch(`${apiBase}/api/projects/${projectId}/lock`, {
    headers,
    data: { isLocked },
  })
  if (!res.ok()) {
    throw new Error(`lockProjectViaAPI failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * PATCH /api/projects/:id/visibility — set project visibility.
 */
export async function setProjectVisibilityViaAPI(
  page: Page,
  projectId: string,
  visibility: 'PRIVATE' | 'BAND' | 'PUBLIC',
  bandIds: string[] = [],
  apiBase = DEFAULT_API_BASE,
): Promise<void> {
  const headers = await makeAuthHeaders(page)
  const res = await page.request.patch(`${apiBase}/api/projects/${projectId}/visibility`, {
    headers,
    data: { visibility, bandIds },
  })
  if (!res.ok()) {
    throw new Error(`setProjectVisibilityViaAPI failed: ${res.status()} ${await res.text()}`)
  }
}
