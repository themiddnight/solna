/**
 * E2E Tests: TR-15 responsive runtime continuity
 *
 * Verifies that crossing desktop/mobile breakpoints does not tear down the
 * local voice media track. The test instruments browser media APIs instead of
 * asserting real audio output, which keeps the signal stable in CI.
 */
import { type Page } from '@playwright/test'
import { expect, test } from '../fixtures/e2e-test'
import { v4 as uuidv4 } from 'uuid'
import { createRoomViaAPI, leaveRoomViaAPI } from '../helpers/api'
import { getE2EUserCredentials, getWorkerUserIndex } from '../fixtures/auth-pool'

test.skip(({ browserName }) => browserName !== 'chromium', 'Responsive runtime continuity E2E runs on chromium only')

interface VoiceRuntimeStats {
  getUserMediaCalls: number
  voiceStopCalls: number
  streamIds: string[]
  stoppedTrackIds: string[]
}

const voiceRuntimeStatsByPage = new WeakMap<Page, VoiceRuntimeStats>()

async function mockHealthCheck(page: Page): Promise<void> {
  await page.context().route('**/api/health*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }),
  )
}

async function gotoStable(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'load' })
      await page.waitForLoadState('load')
      return
    } catch (error) {
      if (attempt === 2) throw error
      await page.waitForTimeout(500)
    }
  }
}

async function ensureAuthenticatedIdentity(page: Page, workerIndex: number): Promise<void> {
  const hasIdentity = await page.evaluate(() => {
    const raw = localStorage.getItem('user-store')
    if (!raw) return false
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const state = (parsed.state ?? parsed) as Record<string, unknown>
    return Boolean(state.userId && state.username)
  })

  if (hasIdentity) return

  const userIndex = getWorkerUserIndex(workerIndex)
  const { email, password } = getE2EUserCredentials(userIndex)

  await page.goto('/login', { waitUntil: 'load' })
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: /^Login$/ }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })

  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('user-store')
      if (!raw) return false
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const state = (parsed.state ?? parsed) as Record<string, unknown>
      return state.isAuthenticated === true && !!state.userId && !!state.username
    } catch {
      return false
    }
  }, { timeout: 10_000 })
}

async function installVoiceRuntimeInstrumentation(page: Page): Promise<void> {
  const nodeStats: VoiceRuntimeStats = {
    getUserMediaCalls: 0,
    voiceStopCalls: 0,
    streamIds: [],
    stoppedTrackIds: [],
  }
  voiceRuntimeStatsByPage.set(page, nodeStats)

  await page.exposeFunction('__recordVoiceRuntimeE2E', (event: string, value?: string) => {
    if (event === 'getUserMedia') {
      nodeStats.getUserMediaCalls += 1
    } else if (event === 'stream' && value) {
      nodeStats.streamIds.push(value)
    } else if (event === 'stop' && value) {
      nodeStats.voiceStopCalls += 1
      nodeStats.stoppedTrackIds.push(value)
    }
  })

  await page.addInitScript(() => {
    /* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unnecessary-condition */
    const win = window as typeof window & {
      __voiceRuntimeE2E?: {
        getUserMediaCalls: number
        voiceStopCalls: number
        streamIds: string[]
        stoppedTrackIds: string[]
      }
      __recordVoiceRuntimeE2E?: (event: string, value?: string) => void
      webkitAudioContext?: typeof AudioContext
    }

    win.__voiceRuntimeE2E = {
      getUserMediaCalls: 0,
      voiceStopCalls: 0,
      streamIds: [],
      stoppedTrackIds: [],
    }

    const trackPrototype = win.MediaStreamTrack?.prototype as
      | (MediaStreamTrack & { __voiceRuntimeStopPatched?: boolean })
      | undefined

    if (trackPrototype && !trackPrototype.__voiceRuntimeStopPatched) {
      const originalStop = trackPrototype.stop
      trackPrototype.stop = function patchedStop(this: MediaStreamTrack) {
        if ((this as MediaStreamTrack & { __voiceRuntimeTracked?: boolean }).__voiceRuntimeTracked) {
          win.__voiceRuntimeE2E!.voiceStopCalls += 1
          win.__voiceRuntimeE2E!.stoppedTrackIds.push(this.id)
          win.__recordVoiceRuntimeE2E?.('stop', this.id)
        }
        return originalStop.call(this)
      }
      trackPrototype.__voiceRuntimeStopPatched = true
    }

    const markVoiceStream = (stream: MediaStream) => {
      win.__voiceRuntimeE2E!.streamIds.push(stream.id)
      win.__recordVoiceRuntimeE2E?.('stream', stream.id)
      stream.getAudioTracks().forEach((track) => {
        ;(track as MediaStreamTrack & { __voiceRuntimeTracked?: boolean }).__voiceRuntimeTracked = true
      })
      return stream
    }

    const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext
    if (AudioContextCtor) {
      const audioContextPrototype = AudioContextCtor.prototype as AudioContext & {
        __voiceRuntimeDestinationPatched?: boolean
      }

      if (!audioContextPrototype.__voiceRuntimeDestinationPatched) {
        const originalCreateDestination = audioContextPrototype.createMediaStreamDestination
        audioContextPrototype.createMediaStreamDestination = function patchedCreateDestination(this: AudioContext) {
          const destination = originalCreateDestination.call(this)
          markVoiceStream(destination.stream)
          return destination
        }
        audioContextPrototype.__voiceRuntimeDestinationPatched = true
      }
    }

    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices)
    // Preserve the prototype chain AND delegate EventTarget methods to the
    // original mediaDevices object so they keep the correct `this` binding.
    const mediaDevicesProto = Object.getPrototypeOf(mediaDevices) as object | null
    const addEventListener = (...args: unknown[]) =>
      (mediaDevices.addEventListener as (...a: unknown[]) => void)(...args)
    const removeEventListener = (...args: unknown[]) =>
      (mediaDevices.removeEventListener as (...a: unknown[]) => void)(...args)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: Object.assign(
        Object.create(mediaDevicesProto ?? Object.prototype) as Record<string, unknown>,
        mediaDevices as unknown as Record<string, unknown>,
        {
          addEventListener,
          removeEventListener,
          getSupportedConstraints: () => ({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: true,
            latency: true,
          }),
          getUserMedia: async () => {
            const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext
            if (!AudioContextCtor) {
              throw new Error('AudioContext is unavailable for E2E synthetic microphone')
            }

            const context = new AudioContextCtor()
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            const destination = context.createMediaStreamDestination()

            gain.gain.value = 0.001
            oscillator.connect(gain)
            gain.connect(destination)
            oscillator.start()

            win.__voiceRuntimeE2E!.getUserMediaCalls += 1
            win.__recordVoiceRuntimeE2E?.('getUserMedia')

            return markVoiceStream(destination.stream)
          },
        },
      ),
    })
  })
}

async function getVoiceRuntimeStats(page: Page): Promise<{
  getUserMediaCalls: number
  voiceStopCalls: number
  streamIds: string[]
  stoppedTrackIds: string[]
}> {
  const nodeStats = voiceRuntimeStatsByPage.get(page) ?? {
    getUserMediaCalls: 0,
    voiceStopCalls: 0,
    streamIds: [],
    stoppedTrackIds: [],
  }

  try {
    const browserStats = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>
      const stats = win.__voiceRuntimeE2E as Record<string, unknown> | undefined
      return {
        getUserMediaCalls: (stats?.getUserMediaCalls as number) ?? 0,
        voiceStopCalls: (stats?.voiceStopCalls as number) ?? 0,
        streamIds: (stats?.streamIds as string[]) ?? [],
        stoppedTrackIds: (stats?.stoppedTrackIds as string[]) ?? [],
      }
    })

    return {
      getUserMediaCalls: Math.max(nodeStats.getUserMediaCalls, browserStats.getUserMediaCalls),
      voiceStopCalls: Math.max(nodeStats.voiceStopCalls, browserStats.voiceStopCalls),
      streamIds: [...new Set([...nodeStats.streamIds, ...browserStats.streamIds])],
      stoppedTrackIds: [...new Set([...nodeStats.stoppedTrackIds, ...browserStats.stoppedTrackIds])],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Execution context was destroyed')) {
      return nodeStats
    }
    throw error
  }
}

async function expectVoiceRuntimeStarted(page: Page): Promise<void> {
  await expect
    .poll(async () => (await getVoiceRuntimeStats(page)).getUserMediaCalls, {
      timeout: 20_000,
      message: 'VoiceInput should request a local microphone stream',
    })
    .toBeGreaterThan(0)
  await expect
    .poll(async () => new Set((await getVoiceRuntimeStats(page)).streamIds).size, {
      timeout: 20_000,
      message: 'VoiceInput should finish building the processed local voice stream',
    })
    .toBeGreaterThanOrEqual(2)
}

async function expectStopCallsToStay(page: Page, expectedStopCalls: number): Promise<void> {
  await expect
    .poll(async () => (await getVoiceRuntimeStats(page)).voiceStopCalls, {
      timeout: 5_000,
      message: 'Breakpoint-only layout switches must not stop local voice tracks',
    })
    .toBe(expectedStopCalls)
}

async function enterRoomAndAssertReady(page: Page, path: string): Promise<void> {
  await gotoStable(page, path)
  await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })
  await expectVoiceRuntimeStarted(page)
}

async function assertBreakpointFlipPreservesVoiceRuntime(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  // Must be installed before navigating into the room: addInitScript applies to
  // the next document load, and VoiceInput requests getUserMedia during room boot.
  await installVoiceRuntimeInstrumentation(page)
  await enterRoomAndAssertReady(page, path)

  const beforeMobile = await getVoiceRuntimeStats(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  await page.waitForTimeout(2_500)
  await expectStopCallsToStay(page, beforeMobile.voiceStopCalls)

  await page.setViewportSize({ width: 1180, height: 820 })
  await page.waitForTimeout(2_500)
  await expectStopCallsToStay(page, beforeMobile.voiceStopCalls)
}

async function assertIntentionalLeaveStopsVoiceRuntime(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await installVoiceRuntimeInstrumentation(page)
  await enterRoomAndAssertReady(page, path)

  const beforeLeave = await getVoiceRuntimeStats(page)
  await page.getByTestId('room-leave-button').first().click()
  await expect(page.getByText(/Are you sure you want to leave the room/i)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Leave Room' }).last().click()

  await expect
    .poll(async () => {
      try {
        return (await getVoiceRuntimeStats(page)).voiceStopCalls
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('Execution context was destroyed')) {
          return beforeLeave.voiceStopCalls
        }
        throw error
      }
    }, {
      timeout: 10_000,
      message: 'Intentional leave should stop local voice tracks',
    })
    .toBeGreaterThan(beforeLeave.voiceStopCalls)
}

test.describe('TR-15: Responsive runtime continuity', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await mockHealthCheck(page)
    await gotoStable(page, '/')
    await page.evaluate(() => {
      sessionStorage.removeItem('collab-room-session')
      sessionStorage.removeItem('pendingInvite')
    })
    await ensureAuthenticatedIdentity(page, testInfo.workerIndex)
  })

  test('Perform Room keeps voice stream alive across breakpoint flips', async ({ page }) => {
    const room = await createRoomViaAPI(page, {
      name: `E2E TR15 Perform ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    try {
      await assertBreakpointFlipPreservesVoiceRuntime(page, `/perform/${room.id}`)
    } finally {
      await leaveRoomViaAPI(page, room.id).catch(() => undefined)
    }
  })

  test.fixme('Arrange Room keeps voice stream alive across breakpoint flips', async ({ page }) => {
    const room = await createRoomViaAPI(page, {
      name: `E2E TR15 Arrange ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })

    try {
      await assertBreakpointFlipPreservesVoiceRuntime(page, `/arrange/${room.id}`)
    } finally {
      await leaveRoomViaAPI(page, room.id).catch(() => undefined)
    }
  })

  test('intentional Perform Room leave tears down the voice stream', async ({ page }) => {
    const room = await createRoomViaAPI(page, {
      name: `E2E TR15 Leave ${uuidv4().slice(0, 8)}`,
      roomType: 'perform',
    })

    try {
      await assertIntentionalLeaveStopsVoiceRuntime(page, `/perform/${room.id}`)
    } finally {
      await leaveRoomViaAPI(page, room.id).catch(() => undefined)
    }
  })
})
