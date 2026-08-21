import { v4 as uuidv4 } from 'uuid'
import { test, expect } from '../fixtures/e2e-test'
import { createRoomViaAPI } from '../helpers/api'

/**
 * Aux-input substrate runtime guard (DEV-287/288, FAILURE_PATTERNS Pattern 11).
 *
 * The bug this guards against: the aux reconciler (`initAuxInputIntegration`) was gated on an
 * async `isInitialized` flag and, in the Arrange room, frequently never subscribed — so a
 * Vocoder-ext's carrier tap was never connected and its "mute carrier in mix" never applied.
 * Every unit test mocks `effectsIntegration`, so the wiring that ACTIVATES the reconciler was
 * outside the tested surface: 240+ green tests shipped a feature that never worked in a real room.
 *
 * A UI-level E2E can't catch this — the DOM shows the carrier selected and the badge fine, and
 * Playwright can't "hear" the (missing) vocoded audio. So this test asserts the reconciler's
 * observable RUNTIME side-effects on the live audio graph directly (the exact technique that found
 * the bug): given a Vocoder-ext with a carrier link + mute, after the reconciler runs
 *   - the carrier channel's `masterSendGain` must be 0 (carrier muted in the mix), and
 *   - injecting a tone into the carrier channel must open the vocoder's presence gate
 *     (carrier → vocoder tap connected).
 * With the bug both are inert (masterSendGain stays 1, presence stays 0).
 *
 * Runs against the Vite dev server (webServer = `bun run dev`), so `import('/src/…')` resolves the
 * app's live singleton modules (mixer + effects store) inside `page.evaluate`.
 */

test.describe.configure({ mode: 'serial' })
// Web Audio graph + Tone.js behave reliably only on Chromium in headless Playwright.
test.skip(({ browserName }) => browserName !== 'chromium', 'Audio-graph runtime assertions run on chromium only')

interface AuxProbeResult {
  error?: string
  mixerReady: boolean
  vocoderRegistered: boolean
  /** Carrier channel master send after reconcile — 0 means "muted in mix" (mute reconciliation ran). */
  carrierMasterSend: number | undefined
  /** Vocoder presence gate with a tone injected into the carrier — 1 means the carrier tap connected. */
  presenceWithCarrierTone: number | undefined
}

// Minimal structural types for the app's live graph objects, reached via dynamic import inside the
// page context. Only the members this probe touches are declared (the runtime objects have more).
interface ProbeVocoder {
  type: string
  getCarrierPresenceForTest?: () => number
}
interface ProbeChannel {
  masterSendGain?: { gain: { value: number } }
  inputGain: AudioNode
  effectChain?: ProbeVocoder[]
}
interface ProbeMixer {
  getAudioContext: () => AudioContext
  createUserChannel: (id: string, username: string) => void
  getChannel: (id: string) => ProbeChannel | undefined
}
interface MixerArchModule {
  getGlobalMixer: () => ProbeMixer | null
}
interface EffectsStoreModule {
  useEffectsStore: { getState: () => { setChainsFromState: (chains: Record<string, unknown>) => void } }
}

test.describe('Aux-input substrate — Vocoder-ext carrier wiring (runtime graph guard)', () => {
  test('reconciler connects the carrier tap and applies the master-mute in an Arrange room', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')

    const room = await createRoomViaAPI(page, {
      name: `E2E Aux ${uuidv4().slice(0, 8)}`,
      roomType: 'arrange',
    })

    await page.goto(`/arrange/${room.id}`)
    await page.waitForLoadState('load')
    // Room shell is up (effects integration + mixer bootstrap begin once the controller mounts).
    await expect(page.getByTestId('room-leave-button')).toBeVisible({ timeout: 20_000 })

    const result: AuxProbeResult = await page.evaluate(async () => {
      const waitFor = async <T>(fn: () => T, ms = 8000): Promise<T> => {
        const started = Date.now()
        while (Date.now() - started < ms) {
          const v = fn()
          if (v) return v
          await new Promise((r) => setTimeout(r, 100))
        }
        return fn()
      }

      // Load the app's live singleton modules (dev server serves the real source). Going through a
      // string-typed loader keeps the specifier out of static module resolution; the result is cast
      // once from `unknown` to the minimal shapes above (no `any`).
      const load = (p: string): Promise<unknown> => import(p)
      const arch = (await load('/src/engine/effects/runtime/effectsArchitecture.ts')) as MixerArchModule
      const storeMod = (await load('/src/features/effects/stores/effectsStore.ts')) as EffectsStoreModule

      const mixer = await waitFor(() => arch.getGlobalMixer())
      if (!mixer) {
        return {
          error: 'global mixer never initialized',
          mixerReady: false,
          vocoderRegistered: false,
          carrierMasterSend: undefined,
          presenceWithCarrierTone: undefined,
        }
      }
      const ctx = mixer.getAudioContext()
      try {
        await ctx.resume()
      } catch {
        /* autoplay already unlocked or not required */
      }

      // Two throwaway channels standing in for a carrier (instrument) track and the voice track.
      const CARRIER = 'e2e-aux-carrier'
      const VOICE = 'e2e-aux-voice'
      const EFFECT_ID = 'e2e-aux-vocoderext'
      mixer.createUserChannel(CARRIER, 'E2E Carrier')
      mixer.createUserChannel(VOICE, 'E2E Voice')

      // Add a Vocoder-ext on the voice track's chain, carrier = the carrier channel, mute on.
      // The app's own effectsIntegration registers the runtime effect and the (subscribed)
      // reconciler wires the aux edge — none of that is mocked here.
      storeMod.useEffectsStore.getState().setChainsFromState({
        [`track:${VOICE}`]: {
          type: `track:${VOICE}`,
          effects: [
            {
              id: EFFECT_ID,
              type: 'vocoderext',
              bypassed: false,
              order: 0,
              parameters: [],
              auxInput: { kind: 'track', id: CARRIER, sourceKind: 'instrument' },
              muteCarrierInMix: true,
            },
          ],
        },
      })

      const carrierChannel = (): ProbeChannel | undefined => mixer.getChannel(CARRIER)
      const vocoder = (): ProbeVocoder | undefined =>
        mixer.getChannel(VOICE)?.effectChain?.find((e) => e.type === 'vocoderext')

      // Wait for the effect to register + the reconciler to apply the master-mute.
      await waitFor(() => (carrierChannel()?.masterSendGain?.gain.value === 0 ? true : null))
      const carrierMasterSend = carrierChannel()?.masterSendGain?.gain.value
      const hasVocoder = Boolean(vocoder())

      // Inject a tone into the carrier channel and check the vocoder's presence gate opens
      // (the carrier tap is connected). Presence is 0 until the carrier delivers signal.
      let presenceWithCarrierTone: number | undefined
      const carrierInput = carrierChannel()?.inputGain
      const vox = vocoder()
      if (carrierInput && vox) {
        const osc = ctx.createOscillator()
        osc.frequency.value = 220
        const g = ctx.createGain()
        g.gain.value = 0.4
        osc.connect(g)
        g.connect(carrierInput)
        osc.start()
        await waitFor(() => (vox.getCarrierPresenceForTest?.() === 1 ? true : null), 4000)
        presenceWithCarrierTone = vox.getCarrierPresenceForTest?.()
        osc.stop()
        try {
          g.disconnect()
        } catch {
          /* ignore */
        }
      }

      return { mixerReady: true, vocoderRegistered: hasVocoder, carrierMasterSend, presenceWithCarrierTone }
    })

    expect(result.error, result.error).toBeUndefined()
    expect(result.mixerReady).toBe(true)
    expect(result.vocoderRegistered).toBe(true)
    // Reconciler applied the carrier master-mute (was inert / stayed 1 with the bug).
    expect(result.carrierMasterSend).toBe(0)
    // Reconciler connected the carrier tap → vocoder receives it (was 0 with the bug).
    expect(result.presenceWithCarrierTone).toBe(1)
  })
})
