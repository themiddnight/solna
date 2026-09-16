# Solna React Performance Audit — Synthesized Findings

## Executive Summary

Five area audits converged on one dominant pattern: **components subscribe to whole Zustand objects/arrays when they only need one field or a derived primitive**, and because every tab/segment/track in Solna stays mounted simultaneously for audio continuity, an over-broad subscription doesn't just cost one re-render — it fires on every hidden pane, every unfocused channel, and every unrelated edit. The clearest case is `useSynthChannel`, flagged independently by two audits from different angles (store-subscription breadth and render-fanout), with a working fix pattern already present elsewhere in the same file tree. A second real pattern is **knob-drag writes bypassing the local draft/commit machine that Beat already implements** (`useBeatParamDraft`/`beatPreview.ts`): the Synth Pro Panel and the Effects Rack write to the store — triggering React re-render fanout, an engine-reinstall push, and an unrelated persist-middleware tick — on every `pointermove`, not just on release, and MIDI CC input has the same gap with no throttling at all. A third pattern is **playhead/step subscriptions not gated on segment visibility**, mirroring a gate (`IntersectionObserver`) the project already built for meters but never extended to step markers. The bundle-splitting audit found the codebase's code-splitting largely sound and mostly intentional (data-layer purity, always-mounted views, correctly-lazy vibe/preset drawers) — those items are noted as tradeoffs, not bugs, and several audit items were confirmed clean and are dropped below rather than listed as findings. Net: roughly 10 actionable items remain after merging duplicates and removing false positives/confirmed-clean/architecture-intentional items, front-loaded with three high-impact/low-effort fixes that share one proven pattern already living in this codebase.

---

## Prioritized Findings

### 1. `useSynthChannel` subscribes to all 5 channels' full patches instead of the focused one
**Impact: High · Effort: Low**
`src/components/loop/synth/useSynthChannel.ts:53-76`

**Problem:** The hook unconditionally subscribes to all 5 tracks' `ActiveSynth` patches and all 5 `ArpSettings` objects (20 selectors total) even though `synthChannelForFocus` only ever returns one. Its sole caller, `SoundSynthSection.tsx:641`, re-renders on *any* write to *any* of the 5 patches — an Instant Vibes reroll, or a preset applied to a different track — whether or not Sound is even the visible tab.

**Evidence:** `SynthPresetLibrary.tsx:514` and `synthPresetBrowser.ts:61` already use the fix pattern in this same codebase: `useAppStore((s) => s[SYNTH_PARAM_FIELD[target]])`, a single computed-property selector, contradicting the hook's own docblock claim that indexing by focus violates rules-of-hooks.

**Fix:** Replace the 10 whole-object selectors with `useAppStore((s) => s[SYNTH_PARAM_FIELD[synthTargetForFocus(focus) ?? 'synth']])` (and same for Arp), following the existing prior-art pattern exactly.

---

### 2. `useLeadGridModel` subscribes to the whole `chords` array just to read a bar count
**Impact: High · Effort: Low**
`src/components/loop/lead/useLeadGridModel.ts:49,61`

**Problem:** `const chords = useAppStore((s) => s.chords)` exists only to compute `totalBars = loopBars(chords)`. The hook runs once per melody track (`lead` and `fx`, both always mounted per `PatternView.tsx:53-70`), so any chord edit that changes root/quality/bassNote but not bar count still replaces the array reference and forces both melody grids to recompute all downstream derived structures while possibly hidden.

**Fix:** `const totalBars = useAppStore((s) => loopBars(s.chords));` — select the derived number directly so `Object.is` equality suppresses re-renders when bar count is unchanged.

---

### 3. Beat voice-card grid and `Knob` have no memoization, so one knob drag re-renders all 11 voice cards
**Impact: High · Effort: Low**
`src/components/loop/beat/BeatVoiceGrid.tsx:55-67` · `src/components/ui/Knob.tsx:527`

**Problem:** `BeatVoiceGrid` builds fresh per-row closures (`onPreview`, `onDraft`, `onReset`) inside `.map()` on every render, and `BeatVoiceCard` is a plain function component with no `React.memo`. `useBeatParamDraft.update()` correctly avoids store/engine cost on preview (confirmed clean), but its `forceRender()` still re-renders all 11 `PanelCard`s and 60+ `<svg>` Knobs on every drag frame — the store-write problem is solved, the render-cascade problem is not.

**Fix:** Wrap `BeatVoiceCard` in `React.memo`; stop constructing closures per row (pass `row.id` down, let the card call `onPreview(voice)` etc., or cache per-id callbacks). Add `React.memo` to `Knob` once callers pass stable prop identities — doing it first would be dead weight.

---

### 4. Synth Pro Panel and Effects Rack knobs write to the store on every `pointermove`, with no draft/commit split
**Impact: High · Effort: Medium**
`src/components/loop/synth/proControls.tsx:284-317` · `src/components/song/EffectsRackView.tsx:212-593`

**Problem:** Unlike Beat (which has `useBeatParamDraft` + `beatPreview.ts`, confirmed clean and explicitly built to avoid this), every Pro-synth knob (Oscillator/Filter/Envelope/LFO/Voice/Utility/mod-route) and every Effects Rack knob (reverb/delay/distortion/EQ) wires only `onChange`, never `onCommit`. **Corrected cost model:** `synthParams`/`effects` are NOT in `localStorage` — `partializeAppState()` only persists 7 small session/library keys (see `phase3-crosscutting-synthesis.md` finding #1). The real costs a knob drag pays on every pixel of pointer movement are: (a) React re-render fanout from the wide store write, (b) `engineSync.ts`'s engine-reinstall push, and (c) zustand's `persist` middleware still running an unconditional `partialize`+`JSON.stringify` tick on its unrelated 7-field object, because that middleware wraps every `set()` call in the app regardless of which key changed.

**Fix:** Build a `useSynthParamDraft`/effects-equivalent modeled directly on `useBeatParamDraft`: preview straight to the engine on `onChange`, commit to the store exactly once via `Knob`'s `onCommit` on pointerup/keyup. Wire `onCommit` through `KnobGrid` the way `BeatVoiceCard` already does.

---

### 5. Chord/Bass custom-pattern grid rebuilds all cells on every 16th-note tick, even while hidden
**Impact: High · Effort: Medium**
`src/components/loop/chord/CustomPatternTimeline.tsx:330,374-386,425-427`

**Problem:** `CustomPatternTimeline` calls `useCurrentStep('chords')` and feeds it into a non-memoized view where `customPatternCells(...)` (up to ~128 cells) and a fresh context object with ~10 closures are rebuilt unmemoized on every render — 8-16x/sec whenever chord/bass custom-pattern mode plays, including while the Accompaniment segment is CSS-hidden behind Lead/FX/Beat. The codebase already solved this exact problem for Lead (`LeadMarker`/`LeadMarkerView` isolates the per-step subscriber to a single `<div>`) but the split was never carried over here.

**Fix:** Mirror the `LeadMarker` split — a memoized grid component (cells built via `useMemo` keyed on values/holds/loopLength/stepsPerBar/boundaries, stable context via `useMemo`/`useCallback`) with zero `currentStep` reads, plus a tiny separate subscriber component that owns only the playhead overlay.

---

### 6. `useChordView` subscribes to the Lead synth patch solely to keep a closed drawer's prop fresh
**Impact: Medium · Effort: Low**
`src/components/loop/chord/useChordView.ts:66,138` · `ChordView.tsx:201`

**Problem:** The always-mounted `ChordView` reads `s.synthParams` (Lead's whole patch) only to forward it to `ChordPresetLibrary`, a lazily-loaded, `<Suspense>`-gated drawer that's almost always closed. A Lead-synth knob edit or vibe reroll re-renders `ChordView` and its non-memoized children (`ProgressionCard`, `SortableProgression`) to refresh a prop for UI that isn't on screen.

**Fix:** Read `s.synthParams` inside `ChordPresetLibrary` itself (subscription exists only while mounted/open), or read via `useAppStore.getState().synthParams` at the moment the drawer opens instead of subscribing in the parent.

---

### 7. Step-marker subscriptions aren't gated on Pattern-segment visibility (unlike meters)
**Impact: Medium · Effort: Medium**
`src/components/loop/sequencer/SequencerGrid.tsx:44` · `src/components/loop/lead/useLeadMarker.ts:34-40`

**Problem:** Three of the four Pattern segments' playhead-owning components (`SequencerGrid` for Beat, `LeadMarker` for Lead/FX, `CustomPatternTimeline` for Chord/Bass) keep re-rendering at 8-16Hz during playback even when `segmentForFocus(focusTrack)` shows a different segment. The project already solved the equivalent problem for meters with a real `IntersectionObserver` gate (`utils/meterScheduler.ts`, confirmed clean) but never extended it to step markers.

**Fix:** Add a segment-aware variant of `useCurrentStep` that also takes the owning segment id and short-circuits/suppresses re-render when `segmentForFocus(focusTrack)` doesn't match — visual-only; `useLeadPlayback`/`useSequencerPlayback`/chord-bass playback (actual scheduling) must keep running unconditionally and are unaffected.

---

### 8. MIDI CC input writes to the store on every message with no throttling
**Impact: Medium · Effort: Medium**
`src/store/midiInput.ts:122,180,225`

**Problem:** `applyCcMapping` calls `s.setMasterVolume(...)` or `s.setSynthParams(...)` synchronously inside `onmidimessage` for every 0xB0 CC byte-pair, inheriting the same full loops-array-rebuild cost as item 4, but with no draft/preview stage at all — a hardware fader sweep transmits at a rate comparable to or higher than a mouse drag. **Corrected cost model (same correction as item 4):** neither setter's target is written to disk on every call — `masterVolume` and `synthParams` are NOT in `localStorage`; `partializeAppState()` persists only 7 small session/library keys (see item 4's correction above).

**Fix:** Route continuous CC targets (filterCutoff, filterResonance, attack, release, masterVolume) through the same preview/commit machine proposed in item 4.

---

### 9. `TransportBar` subscribes to the entire `loops` array for a name/count label
**Impact: Low · Effort: Low**
`src/components/TransportBar.tsx:242,254,268`

**Problem:** Used only to find the active loop's name and build a "Loop X of Y" label; a per-loop mix/mute edit or reorder that doesn't change name/count still re-renders this always-visible chrome component.

**Fix:** `useAppStore((s) => s.loops.find(l => l.id === s.activeLoopId)?.name)` and a similarly narrowed selector for the song label.

---

### 10. `PresetLibrary`'s `groups` computed unmemoized on every render
**Impact: Low · Effort: Low**
`src/components/ui/PresetLibrary.tsx:730` · `ChordPresetLibrary.tsx:691`

**Problem:** `filtered` is correctly `useMemo`'d but `groups = buildGroups(...)` isn't, and callers (e.g. `ChordPresetLibrary`) pass a fresh `groupEntries` closure each render anyway, so memoizing alone won't hold. Low priority — the drawer is opened on demand, not a hot path.

**Fix:** Memoize `groups` keyed on `[groupEntries, filtered, query, category]`; wrap caller-supplied `groupEntries` in `useCallback` with real deps (`tonic`).

---

## Tradeoffs / No Action (architecture-intentional or confirmed clean)

- **Eager bundle load of `data/synthPresets.ts` and friends** (`vite.config.ts`, `store/initialState.ts`) — largely a consequence of the deliberate `src/data/` purity rule and always-mounted-views architecture, not a bug. One optional lever if initial-paint weight ever matters: `resolveFactorySynth` only needs 5 named presets at boot, not the full 1783-line table — worth a boot-only defaults table if revisited, but not urgent.
- **`tonal` eagerly modulepreloaded** — architecturally forced: `sanitize.ts` runs inside `create()` at store boot and the DEV-394 rule confines `tonal` to `tonalAdapter.ts`, which boot-path modules import. No action.
- **`InstantVibesBar`'s vibe-resolution path** — confirmed genuinely lazy at the bundler level (not just intent-lazy). No action; re-verify after future edits by checking `dist/index.html`'s modulepreload list.
- **`playbackStep.ts`, `useBeatParamDraft.ts`, `utils/meterScheduler.ts`** — all confirmed clean; `useBeatParamDraft` is the template item 4 should follow, not a defect.
- **No dev-code leakage, no duplicate library versions** — confirmed clean, no action.