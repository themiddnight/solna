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
  capped by either regardless of which is engaged.
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
  compressor and limiter.
- **R240** — Compressor defaults off; limiter defaults on at -3 dB; source-bus default -6 dB keeps
  `over` reachable.
- **R241** — Every meter ticks through `utils/meterScheduler.ts` (one rAF loop, tiers, per-element
  `IntersectionObserver` visibility gate).
- **R242** — No meter value enters a zustand slice.
- **R243** — Meter constants (`-24`/`-6`/`-1` zones, `0/5/30/100` scale, 14 dB/s decay, −60 dBFS
  floor) are the murva interop contract in
  `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`; never re-derive.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 119-125 and 159-161 (analyser exemption; the two
passages duplicated each other and are merged here) and 831-850.
