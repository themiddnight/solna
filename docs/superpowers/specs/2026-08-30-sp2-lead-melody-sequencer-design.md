# Lead Melody Step Sequencer (SP2) — Design

## Goal

Add an absolute-note, multi-note-per-step piano-roll step sequencer for the lead — an additional note source for the synth alongside the keyboard — whose loop length divides the chord-progression length, and make the lead a first-class transport player.

## Terminology

"Lead" is the melodic player role this feature introduces (`leadPlayer`, `PlayerModule` `'lead'`, `useLeadPlayback`, the lead melody grid). The underlying voice and its parameters keep the existing "synth" naming (`synthParams`, control target `'synth'`) — the lead *player* drives the synth *voice*.

## Context

- The lead synth ("synth") is currently driven by the arpeggiator over keyboard-held notes (`audio/arpeggiator.ts`, `audio/arpSchedule.ts`, `audio/playback/arpPlayback.ts`), with arp fields on `SynthParams` (`arpActive`, `arpMode`, `arpRate`, `arpOctaves`). The lead is **not** a transport player today — the arp runs continuously whenever `arpActive` is set and notes are held, independent of play/stop.
- DEV-366: an absolute-note melody step sequencer. Notes are fixed pitches (not chord-relative) played over changing chords; `loopLength` (bars) must divide the total progression length; short loops repeat (ostinato).
- SP1 (branch `feat/DEV-365-steprow-chord-bass`) built `StepRow<T>` and custom chord/bass grids. SP2 follows the same store → engine → component layering, but note input is a piano-roll (multi-note per step), not a single-value `StepRow`.

## Scope

**In scope (SP2):**

- Piano-roll grid (X = step, Y = pitch) storing absolute note sets per step.
- `loopLength` (bars) constrained to divisors of the progression bar count.
- Two pitch view modes: `scale-locked` (default) / `chromatic`, with out-of-scale stored notes surfaced in scale-locked view.
- Octave window (2–3 octaves) + shift control (view-only).
- Lead becomes a transport player; melody plays in lockstep with play/stop.
- Playback: the melody grid becomes an additional note source for the synth, alongside the keyboard; the arp stays a synth feature and `arpActive` gates arpeggiation (on = arp, off = block), not whether the melody runs.
- DOM rendering (no canvas/konva); playhead as a separate overlay so grid cells do not re-render per clock tick.

**Out of scope (tracked as follow-ups):**

- Drag-to-paint note entry — DEV-368.
- Per-note gate / velocity — DEV-369 (SP2 ships a single fixed gate constant).
- Step-record (keyboard capture into the grid) — DEV-370.
- Region / arrange model and dual play mode — DEV-367 (SP3).

## Architecture

Three layers, same boundaries as everywhere else:

- `audio/` — pure DSP: the melody→trigger resolution (note sets per step → note-on/off events; arp reuse). Never imports `store/` or `components/`.
- `store/` — a new `leadSlice.ts` holds the melody state and the lead player state; the store→engine bridge (`engineSync.ts`) wires lead fields to the engine.
- `components/` — `SynthView` renders the piano-roll; a new `useLeadPlayback` hook drives playback through the audio-layer bridge, following `useChordPlayback` as the template.

## Data model

New slice `leadSlice.ts`, interface `LeadSlice` (extends the composed `AppStore`):

| Field | Type | Persisted | Notes |
|---|---|---|---|
| `leadMelodySteps` | `string[][]` | yes | Stored non-destructively at `MAX_STEPS_PER_BAR` (24) per bar → length `leadLoopLength × 24`. Each element is an array of absolute note names (e.g. `['C4','E4','G4']`); empty array = rest. |
| `leadLoopLength` | `number` (bars) | yes | Must divide `Σ ChordItem.bars`. Default `1`. |
| `leadMelodyView` | `'scale-locked' \| 'chromatic'` | no (transient) | Default `'scale-locked'`. |
| `leadMelodyOctave` | `number` | no (transient) | Lowest octave of the visible window; view-only. |
Setters: `setLeadMelodySteps`, `setLeadLoopLength`, `setLeadMelodyView`, `setLeadMelodyOctave`, `toggleLeadNote(stepIndex, note)`.

`leadPlayer` (transient) is added to `TransportSlice`, not `LeadSlice` — see Transport integration.

**Storage principle (mirrors SP1):** the melody is stored at the fixed `MAX_STEPS_PER_BAR` width per bar and *windowed* to the active `stepsPerBar` at playback/UI time, so a meter switch re-windows without losing data. A `loopLength` change resizes by whole bars (trim trailing bars / pad empty bars).

## Transport integration

Add the lead as a third player module:

- Extend `PlayerModule` to include `'lead'`.
- Add `leadPlayer: PlayerState` to `TransportSlice`; add the field to the `FIELD` map in `transportSlice.ts`.
- Make `aggregatePlayerState` and `isHardStopEnabled` three-way (they currently take exactly two `PlayerState` args).
- `playAll` / `softStopAll` / `hardStopAll` already iterate `Object.keys(FIELD)`, so they pick the new field up once it is in the map.
- `engineSync.ts` transport subscription and the `TransportBar` UI must account for the third player.

## Playback model

A new `useLeadPlayback` hook (component layer) drives the sequencer's melody notes into the lead voice, following `useChordPlayback`'s pattern (clock subscription, live store reads, `currentStep` for the playhead, reset on `'stopped'`):

- `stepsPerBar = getMeter(meterId).stepsPerBar`; `melodyLength = leadLoopLength × stepsPerBar`.
- On each clock step: `stepInLoop = step % melodyLength`; resolve the stored/windowed notes for that step (`notes = leadMelodySteps[stepInLoop]` mapped through the per-bar window; empty → rest).
- `arpActive` OFF → fire every note in `notes` together (block): `playbackNoteOn` at step start, `playbackNoteOff` at step start + `LEAD_GATE × stepDurSec`, target `'synth'`.
- `arpActive` ON → feed `notes` into `buildArpSequence` + `computeArpTriggers` (unchanged), exactly as the keyboard arp does today; `arpStepFor` bar-phase re-alignment stays correct because `melodyLength` is a whole number of bars.
- `LEAD_GATE` is a single named constant (`0.85`, mirroring the arp `holdFactor`). Per-note gate replaces it later (DEV-369).
- Step resolution is the 16th (same grid as drums/chords/bass).

**Note-source model:** the arp is a feature of the synth, not a note-playing mode — it applies uniformly to whatever note signal the synth receives, from the keyboard or the sequencer. The sequencer (the hook above) is an additional note source feeding the synth's note input alongside the keyboard; the keyboard keeps its existing behaviour (direct play, and arpeggiation when `arpActive` is on) unchanged. How the two sources compose at any instant (merged into one signal vs layered) is a plan detail to resolve against the current arp subscriber. `synthParams.octave` keeps its existing transpose meaning; the octave *window* below is view-only and does not transpose.

## Scale & pitch model

- Y-axis pitches derive from `scaleRoot`/`scaleType` (MusicContextSlice), reusing the existing scale-note logic (`utils/keyboard.ts` / `utils/musicTheory.ts`).
- `scale-locked` view: rows = the scale's notes across the octave window (7/octave). Stored notes outside the current scale are shown in a dedicated "out-of-scale" lane with a distinct colour (presence only; switch to `chromatic` to see/edit exact pitch).
- `chromatic` view: rows = all 12 semitones across the window.
- Octave window: 2–3 octaves visible (exact height is a plan detail, default 2); `leadMelodyOctave` shifts the window. View-only — it does not affect stored notes or playback.

## loopLength

- Valid values = positive divisors of `totalBars = Σ ChordItem.bars` (e.g. 4 bars → `{1, 2, 4}`).
- UI = a selector listing the valid divisors.
- When the progression changes so the current `leadLoopLength` no longer divides `totalBars`, clamp down to the largest divisor ≤ the current value. Resize `leadMelodySteps` by whole bars (trim trailing / pad empty), preserving already-programmed bars.

## UI model (SynthView)

- Piano-roll: X = steps of the loop (horizontal scroll with a sticky beat header for long loops), Y = pitch (octave window).
- Cell click toggles a note on/off; multiple cells lit in one column = a chord. (Drag-to-paint is DEV-368.)
- View-mode toggle (scale-locked / chromatic) and octave-window stepper.
- `loopLength` selector (divisors).
- **Playhead** = a separate overlay element (`transform: translateX`) subscribed directly to the current melody step, so grid cells are memoized and never re-render on the playhead move (the same pattern as the SP1 playhead-minor fix).
- All colours via daisyUI role classes (theme-token guard); no raw hex, no canvas colour path.

## Persistence

- `leadMelodySteps` and `leadLoopLength` join `PersistedState` / `partializeAppState` / `sanitizePersistedState`.
- New fields default gracefully (empty melody, `leadLoopLength = 1`), so no data transform is required — no persist-version bump expected (confirm in the plan).
- `leadMelodyView`, `leadMelodyOctave`, and `leadPlayer` are transient (excluded from partialize), consistent with `keyboardMode` and the existing player states.

## Testing

Pure-logic first (bun:test), no DOM/testing-library; components tested via `renderToString`:

- `loopLength` divisor computation + clamp (down to the largest divisor ≤ current).
- Note toggle / rest representation; per-bar windowing to `stepsPerBar` (non-destructive meter switch).
- Melody → trigger resolution: arp-off block notes; arp-on reuses `computeArpTriggers`.
- Scale-note row derivation across the octave window; out-of-scale detection (in-scale vs not).
- `stepInLoop` modulo mapping across multi-bar loops (ostinato repeat at short loops).
- Persist: `leadMelodySteps`/`leadLoopLength` round-trip; transient fields excluded.
- Transport: three-way `aggregatePlayerState` / `isHardStopEnabled`.

## Non-goals

Per-note velocity; per-note gate UI; marquee/multi-select; touch gestures; Web Worker timing; canvas/konva rendering; region/arrange. Deferred to DEV-368/369/370 (see Scope) and DEV-367 (SP3).
