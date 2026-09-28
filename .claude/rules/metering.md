---
paths:
  - "src/utils/meter*.ts"
  - "src/utils/gainUnits.ts"
  - "src/utils/gainReduction.ts"
  - "src/components/AudioVisualizer.tsx"
  - "src/components/visualizerDraw.ts"
  - "src/components/ui/*Meter*.tsx"
  - "src/components/ui/useMeterLevel.ts"
  - "src/audio/masterRack.ts"
---

# Metering

How meters read level, where the analysers tap, and the analyser-consumer exemption from the layer ban.

## Analyser exemption

- Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx` (read-only analyser consumers) and test files are exempt from the `components/` → `audio/engine` ban. <!-- R041 -->
- That `eslint.config.js` block turns `no-restricted-imports` off entirely, lifting the tonal and taper bans too; reviewers keep these four files free of such imports by hand. <!-- R042 -->

([ADR-0028](../../docs/decisions/0028-sample-based-metering.md))

- `eslint.config.js` is the binding list; this file is the only doc copy — change the analyser allowlist in both. <!-- R043 -->

([ADR-0002](../../docs/decisions/0002-four-layer-import-architecture.md))

## Level and taps

- Meters compute peak and windowed RMS in dBFS from `getFloatTimeDomainData`; never `getByteFrequencyData` (it measures brightness, not loudness). <!-- R238 -->
- Master analysers are observe-only sends off `masterGain`: post-fader, ahead of the compressor, the limiter and the output ceiling. <!-- R239 -->
- The compressor defaults off; the limiter defaults on at -3 dB; the -6 dB source-bus default keeps the `over` zone reachable. <!-- R240 -->
- The last master stage is the output ceiling: a `WaveShaperNode` with the two-point curve `[-1, 1]` and `oversample = 'none'`, always wired whichever dynamics stages are on, so the master output never exceeds 0 dBFS. It has no toggle, and `rewireMasterDynamics` only re-points the stage feeding it. <!-- R359 -->
- The limiter is followed by `limiterMakeupTrim`, a gain of `fullRangeGain^0.6` (the inverse of the spec's automatic makeup gain, closed-form for the hard knee), re-derived from threshold and ratio in `updateEffects` and wired only while the limiter is. Below threshold the limiter is unity. <!-- R360 -->
- Every meter ticks through `utils/meterScheduler.ts` (one rAF loop, a tier per registration, a per-element `IntersectionObserver` visibility gate — every view stays mounted). <!-- R241 -->
- No meter value enters a zustand slice. <!-- R242 -->
- Meter constants (`-24`/`-6`/`-1` zones, the `0/5/30/100` scale, 14 dB/s decay, −60 dBFS floor) are the murva interop contract in `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`; never re-derive them. <!-- R243 -->

([ADR-0028](../../docs/decisions/0028-sample-based-metering.md))

## Prohibited

- Adding a file to the analyser exemption without editing both lists <!-- R041 --> <!-- R043 -->
- Tonal or taper imports in the four exempt analyser files <!-- R042 -->
- `getByteFrequencyData` for a level meter <!-- R238 -->
- Tapping a master analyser after the compressor, the limiter or the output ceiling <!-- R239 -->
- An oversampled or soft-curved output ceiling, a toggle for it, or any master stage after it <!-- R359 -->
- A wired limiter without its makeup trim, or a trim that is not re-derived when threshold or ratio change <!-- R360 -->
- A meter with its own rAF loop or no visibility gate <!-- R241 -->
- A meter value in a zustand slice <!-- R242 -->
- Re-deriving the murva meter constants <!-- R243 -->
