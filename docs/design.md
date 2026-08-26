# Solna — Design System & Architecture Specification

## 1. Introduction & Conceptual Vision

**Solna** is a dawn-inspired, single-user solo music creation and idea-sketching workspace. 
- **The Narrative**: Solna represents the quiet, focused morning hours (*Dawn*) where a musician explores chords, tests melodies, and sequences loops in solitude. Later, these ideas can be brought into **Murva** (*Dusk*) for multiplayer collaborative jamming.
- **Design Objective**: Deliver a cozy, low-pressure, highly tactile audio workstation experience that blends professional DAW capabilities with warm, inviting analog-hardware aesthetics.

---

## 2. Color System & Theme Architecture

Solna is built using Tailwind CSS and DaisyUI, featuring two custom-crafted warm-tinted themes designed to reduce eye strain during extended creative sessions while maintaining high contrast.

### 🔥 Solna-Dark (`solna-dark`) — Ember & Solar Flare
The hour before sunrise. A warm near-black ground (hue ~55° in OKLCH, not the cold blue-blacks or
the violet-tinted charcoal this theme used to carry — that band belongs to Murva's dusk) with the
first full-strength gold breaking over it.

* **Canvas & App Background (`base-200`):** `#110B07` (Pre-Dawn Ember)
* **Panels & Cards (`base-100`):** `#1B130C` (Warm Ember Panel)
* **Borders & Insets (`base-300`):** `#2C1F14` (Burnt Umber Inset)
* **Primary Accent (`primary`):** `#FFB000` (Solar Gold — Playhead, Active Steps, Key Controls)
* **Secondary Accent (`secondary`):** `#FF6B45` (Horizon Orange — Chords & Harmony highlights)
* **Visual Accent (`accent`):** `#35C9BA` (Retreating Teal — Synth & Modulation; the cold counterweight that keeps the theme from reading as one continuous orange wash)
* **Base Content (Text):** `#FBF0E2` (Warm Cream Off-White)
* **Neutral (`neutral`):** `#231910` / content `#FBF0E2` (chrome that must not read as an accent — inactive audition pills, muted chips)
* **Success (`success`):** `#63CE8A` — "saved", "envelope OK", live-signal indicator
* **Warning (`warning`):** `#FFD24A` — VU meter upper-mid segments
* **Error (`error`):** `#F5533A` — destructive actions, VU clip segments, mute-on
* **Info (`info`):** `#6FA2D8` — neutral informational hints

### 📜 Solna-Light (`solna-light`) — First Light on Paper
Designed for morning and daytime sketching, simulating warm parchment paper without clinical stark
white glare.

* **Canvas & App Background (`base-200`):** `#FDF4E4` (First-Light Paper)
* **Panels & Cards (`base-100`):** `#FFFDF8` (Warm White)
* **Borders & Insets (`base-300`):** `#F0DFBF` (Soft Sand Border)
* **Primary Accent (`primary`):** `#B06200` (Deep Solar Gold)
* **Secondary Accent (`secondary`):** `#D14421` (Ember Terracotta)
* **Visual Accent (`accent`):** `#0C8F86` (Deep Morning Teal)
* **Base Content (Text):** `#1F1408` (Roasted Coffee Charcoal)
* **Neutral (`neutral`):** `#35250F` / content `#FFFFFF`
* **Success (`success`):** `#238652`
* **Warning (`warning`):** `#9A6100`
* **Error (`error`):** `#C2321F`
* **Info (`info`):** `#2C6FA8`

> **Every `·-content` value is contrast-derived, not chosen by eye.** Each one is whichever of the
> theme's ink or paper wins WCAG contrast against its own token, and all eight semantic pairs clear
> 4.5:1 in both themes. The previous palette did not: white on `solna-light`'s `primary` was 3.19:1
> and on its `accent` 3.74:1. Re-tint a token and its content value has to be re-derived with it.

> **The canvas is a gradient, not a flat fill.** `src/index.css` defines a `bg-canvas` utility — `base-200` under two soft radial glows: a sunrise rising from the bottom edge (`--canvas-dawn`, mixed from `primary`) and a cooler dawn-sky wash in the top-right (`--canvas-sky`, mixed from `secondary`). Both are `color-mix`ed from the live theme tokens, so the gradient re-tints itself on a theme flip rather than needing a second hand-written palette; only the mix percentages differ per theme (warm paper stains at far lower opacity than the espresso base). The app shell in `src/App.tsx` wears `bg-canvas` instead of `bg-base-200` — it is a full-height flex column that would otherwise paint over anything set on `body`. It is **static**: the audio-reactive ambient wash that used to live here was removed deliberately.

> Both themes are declared CSS-first in `src/index.css` via `@plugin "daisyui/theme" { … }`. There is no `tailwind.config.*` file in this repository and none may be added. The active theme is read from `document.documentElement.dataset.theme` and persisted to `localStorage` under `solna_theme`; `index.html` sets the attribute in a blocking `<head>` script so light-theme users never see a dark first paint.

---

## 3. Typography & Hierarchy

Typography is shared with murva: one sans face for everything, and monospace reserved for machine values and music notation. `murva-brand/design.md` §4 is the source of truth for the stack — change it there first.

* **Headings & Titles:** **Figtree** (variable, 300-900, loaded from Google Fonts in `index.html`) with **Anuphan** behind it for Thai — `font-family: "Figtree", "Anuphan", sans-serif`, `tracking-tight` for compact musical labels. This stack is **shared with murva** and copied verbatim from `murva-brand/design.md` §4; change it there first. It is registered as `--font-sans` in an `@theme` block in `src/index.css` (so the `font-sans` utility and Tailwind's `--default-font-family` both resolve to it) and applied to `body` in the same file.
* **Monospace — no face is loaded.** solna loads **no mono webfont**, matching murva: `font-mono` and `<kbd>` fall back to Tailwind's system monospace stack. The oscilloscope's canvas axis labels name that same stack literally (`8px ui-monospace, SFMono-Regular, Menlo, monospace` on the 2D context) because canvas cannot take a class.
* **When to reach for `font-mono`.** The utility follows murva's usage, not "any number":
  * **Yes** — values the machine produced or music notation: BPM, cutoff in Hz, gain in dB, master/mix percentages, chord symbols and roman numerals, note names on keys, rhythmic notation (`1/16`, `1/8`, `1/32`), octave offsets, and short technical codes (`LPF`, `saw`).
  * **`tabular-nums` instead** — numbers sitting in ordinary UI chrome, where mono would read as too heavy: knob parameter readouts, counts in badges and pills, bar numbers. This mirrors murva's `AnalogSynthControls` and `GenreTemplateSelect`.
  * **Neither** — words. Section labels (`AMP / VCA`, `Category:`), category names, button text, prose. These were on `font-mono` before the murva alignment and were moved off it.
* **Font Scaling:**
  * **App Title:** 14px Bold (`text-sm font-extrabold`)
  * **Section Headers:** 14-16px Bold
  * **Control Labels & Hints:** 10-12px Medium (`text-xs` / `text-[10px]`)

---

## 4. Component Architecture

Solna is structured into modular, single-responsibility React components:

1. **`Header.tsx`**: Top navigation bar containing the Solna brand logo, project title, primary view tabs (`Synth`, `Step Matrix`, `Chords`, `Master FX`), global Key/Scale selector, Project modal trigger, and the **Theme Toggle** button.
2. **`InstantVibesBar.tsx`**: Quick-start genre and mood presets (`Lo-Fi Chill`, `Synthwave 80s`, `Cyber EDM`, `Deep Ambient`, `Boom Bap`, `Zen Garden`) allowing instant loading of complete harmonic and rhythmic templates.

   > **Ids drift from display names — do not "fix" this.** Four vibe ids predate their current labels. Project files persist the id, so renaming an id silently breaks every saved project that references it.
   >
   > | id (persisted) | display name |
   > |---|---|
   > | `lofi-chill` | Lo-Fi Chill |
   > | `synthwave-80s` | Synthwave 80s |
   > | `cyber-dance` | **Cyber EDM** |
   > | `ambient-chill` | **Deep Ambient** |
   > | `hiphop-groove` | **Boom Bap** |
   > | `asian-zen` | **Zen Garden** |
   >
   > The table lives in `src/store/instantVibes.ts`. It used to be duplicated in an `audio/` fork; that fork is gone, so there is one copy to keep correct.
3. **`TransportBar.tsx`**: Bottom sticky player controls featuring Play/Stop All, Tab Play, a BPM stepper (−/+ buttons around a `40`–`240` number input; there is **no** tap-tempo), a Metronome toggle, a **mono** 10-segment VU meter (green below segment 7, `warning` at 7-8, `error` at 9-10), and the Master Output volume fader.

   > **Explicitly unbuilt.** Two features described in earlier revisions of this spec were never implemented and are recorded here as future work, not as shipped behaviour:
   > - **Tap Tempo** — a button that derives BPM from the interval between successive clicks. The BPM setter (`setBpm`) already exists in the store, so this is UI-only work.
   > - **Stereo VU** — the meter reads a single scalar level. Making it stereo requires a channel-split analyser in `src/audio/engine.ts` before any UI change is worthwhile.
4. **`SimpleSynthPanel.tsx` / `SynthView.tsx`**: Dual-mode synthesizer interface featuring 4 friendly macro knobs (`Tone`, `Space`, `Vibe`, `Punch`), 1-click Arpeggiator controls, and an interactive musical keyboard supporting computer key bindings.
5. **`SequencerView.tsx`**: Multi-track step sequencer grid for drums, bass, synth, and percussion patterns with velocity and step probability editing.
6. **`ChordView.tsx`**: Interactive chord progression builder featuring sortable chord cards, Roman numeral analysis, and automatic chord voicing generation.
7. **`EffectsRackView.tsx`**: Master audio chain comprising Algorithmic Space Reverb, Stereo Echo Delay, Wave Distortion/Crunch, and a 3-Band Equalizer.
8. **`ProjectModal.tsx`**: Project save / load / export / import dialog, rendered as a daisyUI `modal` with a `modal-box` and `modal-backdrop`.
9. **`AudioVisualizer.tsx`**: Canvas visualizer with four modes (`wave`, `bars`, `oscilloscope`, `ambient-bg`). Because canvas takes colour strings rather than classes, it reads the live theme through `src/utils/themeColor.ts`; its `colorTheme` prop takes a semantic role (`primary` | `secondary` | `accent`), never a palette name.
10. **`DrumPads.tsx`**: Velocity-sensitive drum pad grid with computer-key shortcuts. Exports `DEFAULT_PADS`, whose `shortcut` codes are asserted collision-free against the synth keyboard by `scripts/check-key-bindings.ts`.
11. **`ChordPresetLibrary.tsx`** / **`SynthPresetLibrary.tsx`**: Searchable, category-filtered preset browsers for chord progressions and synth patches, including user-saved presets from `localStorage`.
12. **`chord/SortableChordCard.tsx`**: A single draggable chord card (`@dnd-kit/sortable`) used by `ChordView`.
13. **`InstantVibesBar.tsx`** *(see item 2)* and **`useSequencerPlayback.ts`** / **`chord/useChordPlayback.ts`**: playback hooks, not visual components.

### The `ui/` primitive layer

Shared, presentation-only controls under `src/components/ui/`. These own the daisyUI class defaults, so feature components should pass **no** colour overrides:

* **`Knob.tsx`** — rotary control. Its `color` prop is a closed union: `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'`. Passing a raw palette class is a compile error, which is deliberate.
* **`Slider.tsx`** — wraps `<input type="range">`; defaults to `range range-primary range-xs w-full`.
* **`Keyboard.tsx`** — `ScaleLockedKeyboard` and `ChromaticKeyboard`, plus the `KEYBOARD_NOTES` binding table and the `getBlackKeyLeftPx` geometry helper covered by `SynthView.test.tsx`.
* **`ChannelStrip.tsx`** — mixer channel (fader, mute, solo, pan).
* **`PresetLibrary.tsx`** — the generic library shell both preset browsers build on.
* **`QuickSavePopover.tsx`** — inline name-and-category save form; its `inputClassName` / `selectClassName` props default to daisyUI classes (`input input-sm input-bordered` / `select select-sm select-bordered`), and `buttonClassName` defaults to `""` and layers over the built-in `btn` classes — all three should be left alone.

---

## 5. Audio Engine & State Persistence

- **Audio Synthesis**: Hand-rolled on the **raw Web Audio API** — a single `audioEngine` singleton (`src/audio/engine.ts`) owning the `AudioContext`, the voice pool, the parallel effect sends and the shared 16th-note clock. There is no Tone.js; `tonal` is a music-theory dependency only.
- **State Management**: Zustand store (`src/store/`) managing transport, synth patches, chord progressions, drum patterns, and master effects in real-time.
- **Persistence**: Local storage and project JSON export/import workflows allowing creators to save and load their musical sketches effortlessly.

### Resolved: the forked Instant Vibes module

`src/audio/instantVibes.ts` was a diverged copy of `src/store/instantVibes.ts`
with no production importer — only its own test file loaded it. The
`2026-08-24-murva-restructure` plan already called for deleting it after the
move to `store/`; that step was never carried out, so the fork stayed behind
and drifted: its drum-pattern keys were `Kick`/`Snare`/`HiHat` where the engine
reads `kick`/`snare`/`hihat`, and it named a `Velvet EP` preset that no longer
exists anywhere in the codebase. Its test suite passed the whole time, on data
nothing shipped.

Both files are now deleted. `src/store/instantVibes.ts` is the only copy, and
the two `no-restricted-imports` errors the fork raised (`audio/` must not import
`store/`) are gone with it. The engine-init block and the extra effect
parameters it carried (`delayTime`, `chorusWet`/`Rate`/`Depth`) were never
audible and are recoverable from git history if they are ever wanted.

---

## 6. Token Discipline & Enforcement

Solna has exactly two themes, and every surface must work in both. That is only achievable if **no component names a colour**. Components name *roles*; `src/index.css` maps roles to colours; daisyUI swaps the mapping when `data-theme` changes.

### 6.1 Canonical role map

Legacy Murva-era colours and their permanent replacements. When you touch old code, apply this table verbatim — do not improvise a "closer" match.

| legacy value | semantic token |
|---|---|
| `#0B0D19`, `#0E1022` — app / page inset background | `bg-base-200` |
| `#12152A`, `#171B36`, `#171B38`, `#161B36`, `#1A1E38`, `#1A1F3B`, `#1A1F3A`, `#181C35` — panels & cards | `bg-base-100` |
| `#1C213E`, `#22284C`, `#22274A`, `#20264A`, `#151933` — hover fills and recessed wells | `bg-base-300` / `hover:bg-base-300` |
| `#252B48`, `#2D355A`, `#3B4371`, `#1E2344` — borders and hairlines | `border-base-300` / `bg-base-300` |
| `indigo-*` — primary action, active state, playhead | `primary` (Sunrise Amber) |
| `purple-*` / `pink-*` — harmony, chords, filter / VCF | `secondary` (Horizon Orange) |
| `cyan-*` / `purple-*` — LFO, modulation, arpeggiator | `accent` (Fresh Teal) |
| `emerald-*` meaning "OK / saved / envelope healthy" | `success` |
| `emerald-*` used as a module accent (e.g. the bass channel) | `accent` |
| `rose-*` / `red-*` — delete, mute-on, clip | `error` |
| `slate-100` / `slate-200` / `slate-300` | `text-base-content` |
| `slate-400` / `slate-500` | `text-base-content/60` (or `/50`) |
| `text-white` sitting on a coloured fill | the matching `*-content` token |
| `bg-black/60`, `bg-black/70` overlays | `modal-backdrop` / `bg-neutral/60` |

### 6.2 Component classes, not hand-rolled markup

| hand-rolled | daisyUI |
|---|---|
| raw `<button>` | `btn btn-xs` / `btn btn-sm` + `btn-ghost` / `btn-primary` / `btn-secondary` / `btn-accent` / `btn-active` |
| raw `<select>` | `select select-sm select-bordered` |
| raw `<input type="text">` | `input input-sm input-bordered` |
| `<input type="range">` | `range range-xs` + `range-primary` / `range-secondary` / `range-accent` |
| panel `<div>` | `card bg-base-100 border border-base-300` wrapping a `card-body` |
| modal `<div>` | `<dialog className="modal modal-open">` + `modal-box` + `modal-backdrop` + `modal-action` |
| segmented control | `tabs tabs-box`, or `join` + `btn join-item` |
| pill / tag `<span>` | `badge badge-sm` (+ `badge-primary` / `badge-outline` / …) |
| toast `<div>` | `toast` container + `alert alert-success` |
| keycap chip | `<kbd className="kbd-key">` — the custom utility in `src/index.css`, not daisyUI's filled `kbd`. Every control with a keyboard binding (piano keys, drum pads) shows its shortcut this way: an outline-only square keycap that inherits its colour from the parent through `currentColor`, so it stays legible on white keys, black keys and active tinted keys alike. |

### 6.3 The guard

`scripts/themeTokenGuard.ts` is a dependency-free scanner that walks `src/**/*.{ts,tsx}` and reports violations. Its rules:

| rule | catches |
|---|---|
| `raw-hex` | any `#RRGGBB` in a class string or style value |
| `palette-color` | Tailwind palette classes: `indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*` |
| `absolute-bw` | `text-white`, `bg-white`, `text-black`, `bg-black` |
| `dark-variant` | the `dark:` variant, which is meaningless under daisyUI's `data-theme` switching |
| `rgba-literal` | `rgba(…)` / `rgb(…)` with numeric channels, including inside canvas code |
| `invalid-utility` | classes that silently do nothing: `py-0.2`, `scale-102`, `z-60`, `xs:` |

It is enforced by `scripts/themeTokenGuard.test.ts` under `bun test`, and its `ALLOWLIST` is currently **empty**. Re-populating it cannot make a build pass: every `src/` file is token-clean, so any path re-added to the allowlist fails the hygiene test that forbids already-clean entries, and the shrink test keeps the list trending to zero. Canvas code, which cannot use classes at all, resolves colours at runtime through `src/utils/themeColor.ts`.

### 6.4 Shape tokens

Solna's `--radius-*` values are set explicitly in both `@plugin "daisyui/theme"` blocks in `src/index.css`, matching Murva's shape language (colours are unaffected — Solna keeps its own palette from §2/§6.1):

| token | value | role |
|---|---|---|
| `--radius-selector` | `0.5rem` | small interactive/decorative elements: checkbox, radio, toggle, badge, icon chip |
| `--radius-field` | `0.5rem` | controls the user operates: button, input, select, tab, a clickable pad/step |
| `--radius-box` | `0.75rem` | containers/surfaces: card, modal, alert, bordered panel |
| `--border` | `1px` | default border width |

Components must use the semantic classes (`rounded-box`, `rounded-field`, `rounded-selector`, and their directional variants like `rounded-b-field`) instead of raw `rounded-lg`/`rounded-xl`/`rounded-md`/etc., picking the token that matches the element's *role* per the table above — not its current pixel size. `rounded-full` stays literal for circles and pills (avatars, dots, pill toggles); it isn't part of this 3-tier scale. A handful of small decorative accents (e.g. tiny VU-meter LED segments) are left on Tailwind's literal scale (`rounded-xs`) where none of the three roles fit — don't force those onto a semantic token just for uniformity.

### 6.5 Module identity colours

daisyUI's semantic roles are about *meaning* (`success` = saved, `error` = destructive), so a module cannot borrow one just because the hue looks nice — a green "AMP / VCA" label reads as a status. Modules that need a persistent identity tint therefore get their own token pair, registered in `@theme` and indirected through per-theme custom properties exactly like the piano-key colours:

| token | hue | used by |
|---|---|---|
| `module-chord` / `-content` | olive 125° | Chord cards, chord audition, the Chord target in `SynthView`'s toggle |
| `module-bass` / `-content` | steel blue 256° | Bass module, the Bass target in `SynthView`'s toggle |
| `module-osc` / `-content` | butter gold 87° | `SynthView` panel 1 — Oscillators |
| `module-filter` / `-content` | rose 356° | `SynthView` panel 2 — VCF Filter |
| `module-env-vca` / `-content` | emerald 162° | `SynthView` panel 3 — ADSR's AMP / VCA half |
| `module-env-vcf` / `-content` | violet 294° | `SynthView` panel 3 — ADSR's FILTER / VCF half |
| `module-lfo` / `-content` | cyan 213° | `SynthView` panel 4 — LFO & Octave |
| `module-arp` / `-content` | orchid 322° | `SynthView` panel 5 — Arpeggiator |

The synth's **six signal stages each own a hue** — the two ADSR halves share one card, so they are the pair that has to contrast hardest. Values come straight from Tailwind's palette (the `400` step on the espresso base, the `600` step on warm paper, where the `400`s wash out) and are ordered so no two neighbours land in the same family, with every adjacent pair ~50°+ apart on the wheel:

> 1 Oscillators amber 43° → 2 VCF rose 350° → 3 ADSR emerald 160° + fuchsia 292° → 4 LFO sky 199° → 5 Arp violet 255°

**Simple Mode wears the same colours.** Each macro dial is coloured by the Pro-Mode stage it actually writes to, so a control keeps its identity when the user switches modes — the colour is the thread between the friendly view and the modular one:

| macro | writes | colour |
|---|---|---|
| Tone | `filterCutoff` | `module-filter` |
| Space | `release` + `sustain` | `module-env-vca` |
| Vibe | `detune` + `lfoDepth` | `module-lfo` — the only macro that touches modulation; Punch already owns the oscillator identity |
| Punch | `subOscVolume` + `attack` | `module-osc` |
| 1-Click Arp card | arp params | `module-arp` |

`module-env-vcf` has no Simple-Mode counterpart because Simple Mode exposes no filter envelope. Chrome that is *not* a signal stage — the Simple/Pro switcher, preset picker, category filters, keyboard octave — stays on `primary`, which now unambiguously means "the thing you picked".

Hues are spaced around the **OKLCH** wheel rather than sRGB HSL (which bunches the yellows), at a fixed lightness per theme — ~0.75 dark, ~0.57 light — so no stage reads as merely a darker version of its neighbour; every adjacent pair is at least 28° apart. Two rules constrain the set: the 20–60° amber band belongs to `primary` alone, so `module-osc` is a pale butter gold separated from the brand by lightness rather than hue, and no module may reuse a semantic hex — which is exactly what `module-filter` and `secondary` used to do (both `#FB7185`), and `module-osc` and `primary` in the light theme (both `#D97706`). No synth panel rides a daisyUI semantic any more, which keeps `primary` free to mean "the thing you picked" everywhere else. Because daisyUI components are variable-driven, a module colour fills a control through arbitrary-value overrides (`btn` + `[--btn-color:var(--color-module-lfo)] [--btn-fg:var(--color-module-lfo-content)]`), a badge through `[--badge-color:…]`, and a range through `text-module-*` + `[--range-thumb:…]` (ranges read `color`, not a variable).

`Knob`'s `color` prop is a closed union, so adding a module colour means adding `text-module-*` to that union in `src/components/ui/Knob.tsx` — deliberately, so the set of legal knob colours stays reviewable.
