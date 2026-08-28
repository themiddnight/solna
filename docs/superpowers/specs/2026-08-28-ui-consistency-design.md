# UI Consistency Across the Four Tabs — Design

**Status:** approved, ready for implementation planning
**Date:** 2026-08-28

## 1. Problem

Solna's four views (Synth, Beat Step, Chords, Master FX) grew independently. A
visual audit of the running app plus a read of the four view files found the
same UI job solved three or four different ways, which forces the user to
re-learn each tab instead of transferring what they already know.

Concretely:

1. **Three views open with a titled header card; `SynthView` has none.** The
   markup for that header was copy-pasted into `SequencerView.tsx:125`,
   `ChordView.tsx:555` and `EffectsRackView.tsx:20` — same card classes, same
   `p-1.5 rounded-selector bg-*/20 border border-*/30` icon chip — and drifted.
2. **`Synth` and `Master FX` share the `Sliders` icon** (`Header.tsx:32-35`).
   Tab text is `hidden xl:inline`, so below 1280px the two tabs are visually
   identical.
3. **On/off is expressed three ways:** `btn-error btn-outline` + Volume icons
   with "Chord Off" text (Chords), `btn-accent btn-active` + Power icon with
   "ON/BYPASS" text (Master FX), and bare Volume icons (Sequencer tracks).
4. **Preset entry points disagree** in both name and location: Synth says
   "Presets" from inside a content card, Chords says "Library" from its view
   header, Sequencer offers an inline `<select>`, Master FX offers nothing.
5. **Section titles mix casing.** `KEYBOARD` / `DRUM FILTER` /
   `ACTIVE CHORD PROGRESSION LOOP` are uppercase-tracked; `Bass Module`,
   `Master Effects Rack`, `Chord Studio & Harmony` are Title Case.
6. **`PlayheadReadout` renders on one tab only** (`SynthView.tsx:483`), so
   three of four tabs have no "where am I in the bar" indicator even though
   the store already carries the data.
7. **The transport exposes internal vocabulary** — `Soft Stop` / `Hard Stop`
   (`ui/PlayerTransport.tsx:27,113`) — which does not tell a user what differs.
8. **Master FX is ~75% empty:** four narrow cards in one row, then nothing.
9. **Knob cards have two anatomies.** Simple-mode macros carry an
   icon + name + a plain-language descriptor badge ("Balanced Tone"); Master FX
   and the drum filter show only a label and a number.

## 2. Goals and non-goals

**Goals.** One structural vocabulary across all four tabs, enforced by shared
components and by data rather than by discipline; plain-language copy in the
transport; a Master FX view whose contract is legible and that has room to grow.

**Non-goals.**

* **No new save/preset features.** Master FX and the drum grid get no preset
  library in this work. Only existing entry points are relocated and renamed.
* **No new module identity colours.** See §3.1.
* **No unrelated refactoring** of the two large view files beyond what adopting
  the shared header requires.

## 3. Decisions

### 3.1 View-header colour: `primary` everywhere; no `module-drum` / `module-fx`

An earlier draft proposed giving every view an identity hue so the tab bar and
the view header would agree. **Rejected**, because `docs/design.md` §6.5 already
settled this: module identity colours belong to the synth's *signal stages*, and
"chrome that is not a signal stage stays on `primary`, which now unambiguously
means 'the thing you picked'". Tinting tabs per view destroys that meaning. The
same section also constrains new hues (the 20–60° amber band is reserved for
`primary`; adjacent hues must be ≥28° apart in OKLCH), which an eight-hue set
already strains.

`ChordView` is the file that currently breaks the rule — its header icon uses
`bg-module-chord/20 … text-module-chord` while the other three use `primary`.
**`ChordView` moves to `primary`.** This both fixes the inconsistency and brings
the file back into compliance with the existing spec; `design.md` needs no
amendment, only the confirmation noted in §8.

### 3.2 Master FX holds FX modifiers and a monitor, in that order

Master FX is the effect chain. Padding it with unrelated widgets would make
future units (compressor, graphic EQ) an awkward fit. Instead the four existing
units go from a four-column row to a **two-column grid**, which doubles card
width, unclutters the knobs, and leaves obvious slots for growth.

The `AudioVisualizer` moves out of `TransportBar` into a **separate Monitor
section** below the chain — visibly not part of the chain — where its
wave / bars / oscilloscope switcher becomes a real control instead of the
hover-revealed button it is today (`TransportBar.tsx:156-165`).

### 3.3 An ambient backdrop, as a new component

The app is visually static while playing. A low-contrast, analyser-driven field
behind the workspace gives continuous "audio is live" feedback on every tab.

It is a **new component**, not a fourth `AudioVisualizer` mode. Note that
`docs/design.md` §4 item 9 claims four modes including `ambient-bg`; that is
**wrong** — `VisualizerMode` is `'wave' | 'bars' | 'oscilloscope'`
(`AudioVisualizer.tsx:12`). The spec is corrected as part of this work.

Four constraints are part of the design, not polish:

* Mounted at the `App.tsx` root behind `main`, `pointer-events-none`, very low
  alpha. Panels are opaque `bg-panel`, so the field shows only in the gutters
  between them — that is what keeps text legible, and it matters most in
  `solna-light`, where a bright field over warm paper degrades fastest.
* **Frozen under `prefers-reduced-motion`.** A full-viewport animation makes
  this mandatory, not optional.
* **rAF runs only while playing** (`aggregatePlayerState !== 'stopped'`) and is
  cancelled otherwise.
* Colours resolve at runtime through `src/utils/themeColor.ts`, per the existing
  canvas rule.

**Layering exception.** `AmbientBackdrop` must read the analyser, so it must
import `audio/engine`, which `eslint.config.js:53` forbids for components.
The alternative — pushing level into the store — means a store write per
animation frame and a re-render of every subscriber. The existing exemption list
(`eslint.config.js:61-62`) exists for exactly this reason, so `AmbientBackdrop`
is added to it deliberately and the reason is recorded in `design.md` §4 and
`CLAUDE.md`.

### 3.4 `PowerToggle` semantics

* **On = the module's own tone; off = `btn-ghost` + dimmed. Never `btn-error`.**
  `ChordView` currently renders "off" in error red; per `design.md` §6.5,
  `error` means destructive, so the current UI reads as "broken", not "muted".
* **One icon: `Power`.** `Volume2` / `VolumeX` are withdrawn from every on/off
  control and reserved for actual level controls. The resulting rule is easy to
  hold: **speaker icon = level, power icon = on/off.**

### 3.5 The meter belongs in a badge, not in the title

`sequencerTitle(meter)` returns `"Drum Sequencer (16-Step · 4/4)"`. Per
`design.md` §3, machine-computed values belong in a badge with `tabular-nums`,
not inside a heading. The function splits: the name comes from `VIEW_META`, and
`sequencerMeterBadge(meter)` returns `"16-Step · 4/4"` for the header badge —
the same treatment as the `A Natural Minor` badge beside `KEYBOARD`.

## 4. New and changed units

### 4.1 `src/components/viewMeta.ts` (new)

```ts
export interface ViewMeta { icon: LucideIcon; tabLabel: string; title: string }
export const VIEW_META: Record<ViewMode, ViewMeta>
```

| view | icon | tabLabel | title |
|---|---|---|---|
| `synth` | `Sliders` | Synth | Synth Lab |
| `sequencer` | `Grid` | Beat Step | Drum Sequencer |
| `chords` | `Music` | Chords | Chord Studio |
| `effects` | `AudioWaveform` | Master FX | Master Effects Rack |

This is the single source of truth for both the tab button and the view header,
so the two can no longer disagree. `Header.tsx` stops holding icons and labels:
`AUTOMATION_TABS` becomes `Array<{ view: ViewMode; module: PlayerModule }>` and
`SOLO_TABS` becomes `ViewMode[]`; `TabButton` reads `VIEW_META[tab.view]`.

Making the data central is what turns problem 2 from a bug into an invariant: a
test asserts the four icons are distinct references.

### 4.2 `src/components/ui/ViewHeader.tsx` (new)

```ts
interface ViewHeaderProps {
  view: ViewMode;        // supplies icon + title from VIEW_META
  badge?: ReactNode;     // sequencer: "16-Step · 4/4"
  actions?: ReactNode;   // right-hand cluster
  children?: ReactNode;  // absolutely-positioned extras, e.g. save toasts
}
```

Owns the card shell (`card bg-panel border border-base-300 shadow-md` +
`card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5`)
and the `primary` icon chip that the three views currently duplicate.

### 4.3 `src/components/ui/PowerToggle.tsx` (new)

```ts
export type PowerToggleTone =
  | 'primary' | 'accent' | 'module-chord' | 'module-bass';   // closed union, as KnobColor is

export function resolvePowerToggle(
  on: boolean, tone: PowerToggleTone, iconOnly: boolean,
): { className: string; label: string }
```

The resolver is pure and exported so behaviour is testable without a DOM —
the same shape as `resolveTransportButtons` in `ui/PlayerTransport.tsx:23`.

Adopted at three sites: `ChordView` (Chord / Bass layers), `EffectsRackView`
(four bypass buttons), `SequencerView` (per-track mutes, `iconOnly`).

**Track mutes do not take the track's colour.** Sequencer track colours are
persisted strings on `SequencerTrack.color` (`bg-error`, `bg-warning`, … — see
`store/initialState.ts:41-77` and the palette migration in `migrate.test.ts`),
so they cannot feed a closed union without reopening it to `string`. They also
should not: the coloured dot beside the track name already carries the track's
identity, and tinting the mute button as well would compete with it. Track
mutes therefore pass `tone: 'primary'`.

### 4.4 `Knob` gains `descriptor?: string`

The plain-language badge is currently hand-rolled four times in
`SimpleSynthPanel.tsx`. It moves into `Knob`, coloured from the knob's own
`KnobColor` via a pure `badgeColorFor(color)` map. Net code is removed.

**When a descriptor is warranted:** when the number alone does not tell the user
what they will hear — reverb decay, delay feedback, distortion drive, drum
filter cutoff. **Not** for percentages and dB, which already read plainly (mix,
EQ gain); adding them there would be noise, not consistency.

### 4.5 `src/components/ui/AmbientBackdrop.tsx` (new)

Per §3.3.

## 5. Per-view target state

| view | badge | header actions | other changes |
|---|---|---|---|
| **Synth** | — | Simple/Pro · Save · Library(N) | header row 1 keeps only the TARGET selector and merges into the preset bar below it; `PlayheadReadout` leaves; "Presets" → "Library" |
| **Beat Step** | `16-Step · 4/4` | drum volume · genre · kit · shift ⇤⇥ · Random · Clear | per-track mutes → `PowerToggle iconOnly` |
| **Chords** | — | PowerToggle Chord · PowerToggle Bass · Save · Library(N) | header icon `module-chord` → `primary`; `Bass Module` → uppercase section header; save toast passes as `children` |
| **Master FX** | — | — | two zones per §3.2 |

Master FX unit headers change from `1. SPACE REVERB` to a numbered badge plus a
Title Case name — `[1] Space Reverb` — which keeps the chain-order information
while reusing the `Bar 1..4` badge treatment already present in Chords.

## 6. TransportBar

* Centre: the `AudioVisualizer` strip leaves; `PlayheadReadout` takes its place,
  so now/next chord and beat dots are visible on all four tabs.
* Right: master volume and the VU meter are unchanged — master level must stay
  reachable at all times.
* Copy: `Soft Stop` → `Stop`, `Stopping` → `Stopping…`; the hard-stop button
  drops its text label, keeping the `X` icon plus `title="Stop immediately"`.

**Consequence to design for:** `App.tsx` keeps all four views mounted and toggles
`block`/`hidden` so audio never stops. A visualizer living inside a view would
therefore keep its rAF loop running on hidden tabs. The Monitor unit takes a
`paused` prop bound to `activeTab !== 'effects'`. This hazard does not exist
today only because the visualizer sits on the always-visible transport bar.

## 7. Testing

All tests stay pure-logic with no DOM, matching the repo's existing convention.

| file | change |
|---|---|
| `viewMeta.test.ts` | new — the four icons are distinct; `tabLabel` and `title` are unique and non-empty; every `ViewMode` is covered |
| `ui/PowerToggle.test.tsx` | new — `resolvePowerToggle` over every tone; asserts the off state never yields `btn-error` |
| `ui/Knob.test.tsx` | extend — `badgeColorFor` covers every member of `KnobColor` |
| `sequencerGrid.test.ts` | amend 5 cases — `sequencerTitle` → `sequencerMeterBadge` |
| `ui/PlayerTransport.test.tsx` | amend 2 assertions — new labels |

`bun run verify` is the gate for every phase. `bun run eslint` must be run
separately in the phase that touches the exemption list.

## 8. Documentation to update

* `docs/design.md` §3 — record the casing rule: view header Title Case, in-page
  section header uppercase-tracked, card title Title Case.
* `docs/design.md` §4 — correct item 9 (three visualizer modes, not four);
  document `AmbientBackdrop` and its layering exemption; add `ViewHeader`,
  `PowerToggle` and `viewMeta` to the `ui/` primitive layer list.
* `docs/design.md` §6.5 — confirm that view-header chrome uses `primary`, and
  note that `ChordView` was the one violation.
* `CLAUDE.md` — extend the analyser-consumer exemption sentence to three files.

## 9. Phases

Each phase ends green on `bun run verify`.

1. **Primitives.** `viewMeta`, `ViewHeader`, `PowerToggle`, `Knob.descriptor`
   and their tests. No view touched.
2. **Adopt.** Migrate the four views onto `ViewHeader` and `PowerToggle`; casing
   and "Presets" → "Library"; split `sequencerTitle`. Fixes problems 1–5.
3. **Layout swap.** `PlayheadReadout` into `TransportBar`; visualizer into the
   Master FX Monitor with `paused`; two-column FX chain; unit header badges;
   knob descriptors; transport copy. Fixes problems 6–9.
4. **Backdrop.** `AmbientBackdrop` plus the eslint exemption.
5. **Docs.** §8.

## 10. Risks

* **Phase 2 touches the two largest files** (`SynthView.tsx` 1447 lines,
  `ChordView.tsx` 1215). The header extraction is mechanical, but Synth also
  reflows row 1 after `PlayheadReadout` leaves — that reflow is the one part
  worth reviewing visually rather than trusting to tests.
* **Backdrop legibility in `solna-light`.** Verify in both themes before
  committing phase 4; the alpha that looks right on the espresso base is
  likely too strong on warm paper.
* **`prefers-reduced-motion` cannot be covered by the existing test style** (no
  DOM). It needs a manual check, or the media-query decision extracted into a
  pure helper that a test can drive — the latter is preferred and matches how
  `resolveInitialTheme` handles the same problem for themes.
