# ADR-0028: Meters read samples before the dynamics

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). Gain-staging
contract: DEV-383.

## Context

The old `getAudioLevel()` averaged `getByteFrequencyData` bins. That measures a patch's brightness,
not its loudness, and yields a 0..1 with no dB meaning, which is why the segments it drove
corresponded to nothing.

Meters also run per animation frame. Every tab view AND every Pattern segment stays mounted (see
[ADR-0001](0001-always-mounted-views.md)), so a per-frame value in a store slice would re-render
every mounted view on every frame, and a meter with no visibility gate would read its analyser
forever on a surface nobody is looking at.

## Decision

### A meter reads samples, not a spectrum, and it reads them before the dynamics

- Level is peak and windowed RMS computed from `getFloatTimeDomainData` and reported in dBFS
  (`src/utils/`: `gainUnits.ts`, `meterZones.ts`, `meterScale.ts`, `meterLevel.ts`; a zone's colour
  comes from `meterColor.ts`'s `zoneFillClass`, which is `vuMeter.ts` renamed when the ten-segment
  bar became a continuous fill — there is no `vuMeter.ts` any more).
- The master analysers are **observe-only sends off `masterGain`**, post-fader and ahead of *both*
  dynamics stages — the compressor and the limiter sit downstream of the tap, so a reading is never
  capped by either regardless of which is engaged. The output ceiling (below) is downstream of the
  tap too.
- The last master stage is a hard 0 dBFS **output ceiling** (UX F-08): a `WaveShaperNode` with the
  two-point curve `[-1, 1]` (a clamp outside full scale; inside it the identity to within ~6e-8
  absolute float32 error, from computing `x + 1` — not bit-transparent, so it moves a rendered
  file's bytes by at most 1 int16 LSB on a few samples) and
  `oversample = 'none'`, wired in every dynamics topology and never toggled. The limiter is not a
  ceiling: a `DynamicsCompressorNode` has no lookahead, so a hard transient passes its 3 ms attack
  nearly unreduced, and the spec's automatic makeup gain (+1.71 dB at the −3 dB / 20:1 seed) lifts
  its settled output above its threshold. Measured offline before the ceiling existed, a +18 dB
  sine switched on hard peaked at 1.51 and settled at 1.046 with the factory limiter on.
  `oversample = 'none'` is deliberate: '2x'/'4x' low-pass the clipped signal before decimating and
  that filter rings back above ±1 (measured 1.011 at '4x', 1.012 at '2x'), and a soft curve would
  colour the mix below full scale. The cost is aliasing of the clip's harmonics, only while a sample
  is actually over.
- The limiter's automatic makeup gain is cancelled by a post-limiter trim, `limiterMakeupTrim`, of
  `fullRangeGain^0.6`. With the limiter's knee fixed at 0 the spec's curve is closed-form:
  `fullRangeGain` is the output at 0 dBFS input, `threshold + (0 − threshold) / ratio` dB, so the
  trim is `0.6 · threshold · (1 − 1/ratio)` dB (−1.71 dB at the seed). It is re-derived in
  `updateEffects` on the same 0.05 s glide as threshold and ratio, and it is in the path only while
  the limiter is. Without it the makeup applied to every sample: 0.3 in came out at 0.365 far below
  threshold, the "Ceiling" knob was not the settled level, and — because the WAV encoder clamps
  anyway — the ceiling alone left the exported file's clipping unchanged (the +18 dB case had 9392
  full-scale int16 samples with or without it). With the trim that case settles at 0.86 and has
  180 full-scale samples, all in the onset transient the ceiling now exists to catch. The
  compressor's makeup gain is left as the spec defines it (not in scope of this fix). Calibration renders force both
  stages off, so the trim table and `check:levels` are unaffected.
- The compressor defaults off; the limiter defaults on (DEV-383) but only catches occasional peaks at
  its -3 dB threshold given the -6 dB source-bus default, so the `over` zone stays reachable in the
  common case.
- Every meter ticks through `utils/meterScheduler.ts` — one rAF loop, a tier per registration, and
  an `IntersectionObserver` per element. That last part is not an optimisation here: every tab view
  AND every Pattern segment stays mounted, so a meter with no visibility gate reads its analyser
  forever on a surface nobody is looking at.
- **No meter value may enter a zustand slice** — a write per tick re-renders every mounted view.
- The numbers (`-24`/`-6`/`-1` zones, the `0/5/30/100` piecewise scale, 14 dB/s decay, a −60 dBFS
  display floor) are an interop contract with murva recorded in
  `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`, not values to re-derive.

### Analyser consumers are exempt from the components→engine ban

`src/components/` must not import `audio/engine` (see
[ADR-0002](0002-four-layer-import-architecture.md)). Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`,
`ui/GainReductionMeter.tsx` and `ui/SourceMeter.tsx` (read-only analyser consumers) and test files
are exempt — routing their per-frame analyser reads through the store would mean a store write on
every animation frame and a re-render of every subscriber.

The `eslint.config.js` block for those four files turns `no-restricted-imports` **off entirely**, so
it also lifts the tonal and taper bans for them — including the Tonal confinement axis of
[ADR-0005](0005-music-core-and-tonal-confinement.md), which is therefore not enforced there either.
A reviewer keeps them free of such imports by hand. `eslint.config.js` is the list that binds (see
[ADR-0002](0002-four-layer-import-architecture.md), R043).

## Consequences

- Meter readings are true dBFS peak/RMS and show clipping even when the limiter is engaged.
- Off-screen meters cost nothing.
- Meter constants change only together with murva, via the DEV-383 contract document.
- The four analyser files are a hole in the import gates, closed only by review.

## Rules this implies

- **R041** — Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/GainReductionMeter.tsx`,
  `ui/SourceMeter.tsx` (read-only analyser consumers) and tests are exempt from the
  components→engine ban.
- **R042** — That exemption block turns `no-restricted-imports` off entirely (tonal + taper bans
  lifted); reviewers keep those four files free of such imports by hand.
- **R238** — Meters compute peak + windowed RMS in dBFS from `getFloatTimeDomainData`; never
  `getByteFrequencyData`.
- **R239** — Master analysers are observe-only sends off `masterGain`, post-fader, ahead of
  compressor, limiter and output ceiling.
- **R240** — Compressor defaults off; limiter defaults on at -3 dB; source-bus default -6 dB keeps
  `over` reachable.
- **R359** — The last master stage is the output ceiling: a `WaveShaperNode`, curve `[-1, 1]`,
  `oversample = 'none'`, always wired and never toggled, so the master output never exceeds 0 dBFS.
- **R360** — The limiter is followed by `limiterMakeupTrim` = `fullRangeGain^0.6`, re-derived from
  threshold and ratio in `updateEffects` and wired only while the limiter is.
- **R241** — Every meter ticks through `utils/meterScheduler.ts` (one rAF loop, tiers, per-element
  `IntersectionObserver` visibility gate).
- **R242** — No meter value enters a zustand slice.
- **R243** — Meter constants (`-24`/`-6`/`-1` zones, `0/5/30/100` scale, 14 dB/s decay, −60 dBFS
  floor) are the murva interop contract in
  `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`; never re-derive.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 119-125 and 159-161 (analyser exemption; the two
passages duplicated each other and are merged here) and 831-850.
