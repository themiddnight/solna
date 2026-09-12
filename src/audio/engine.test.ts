import { describe, expect, test } from 'bun:test';
import { makeEngine } from './testFakes';

/**
 * The engine surface — what `AudioEngine` itself still owns.
 *
 * `engine.ts` is a composition root: the DSP lives in `masterRack.ts`,
 * `clock.ts`, `drumSynth.ts` and `synthVoices.ts`, and each one's tests live
 * beside it. The describes that used to sit here were split out by subsystem,
 * because a file's counted lines must stay under 750 and the drum and voice
 * suites alone are larger than that:
 *
 *   - master chain, effect knobs, source buses, analysers, dynamics
 *       -> `masterRack.test.ts`
 *   - voice lifecycle, release, stop, dedup, caps, provenance
 *       -> `synthVoices.test.ts`
 *   - envelope shape, LFO, noise, equal-power scaling
 *       -> `synthEnvelope.test.ts`
 *   - drum voices, kits, aliases, sends, choke groups
 *       -> `drumSynth.test.ts`
 *   - the metallic oscillator bank (hats, ride, bell, crash)
 *       -> `drumMetal.test.ts`
 *   - clock subscription and idle suspend
 *       -> `clock.test.ts`
 *
 * The shared harness those files import — `masterChainCtx`, `recordNodes`,
 * `fxWith`, `trimTestParams`, `SYNTH` — lives in `engineTestHelpers.ts`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('getAudioLevel removal', () => {
  test('getAudioLevel is gone — a spectrum average was never a level', () => {
    const engine = makeEngine();
    expect((engine as any).getAudioLevel).toBeUndefined();
  });
});
