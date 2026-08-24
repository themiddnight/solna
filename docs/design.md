# Solva — Design System & Architecture Specification

## 1. Introduction & Conceptual Vision

**Solva** is a dawn-inspired, single-user solo music creation and idea-sketching workspace. 
- **The Narrative**: Solva represents the quiet, focused morning hours (*Dawn*) where a musician explores chords, tests melodies, and sequences loops in solitude. Later, these ideas can be brought into **Murva** (*Dusk*) for multiplayer collaborative jamming.
- **Design Objective**: Deliver a cozy, low-pressure, highly tactile audio workstation experience that blends professional DAW capabilities with warm, inviting analog-hardware aesthetics.

---

## 2. Color System & Theme Architecture

Solva is built using Tailwind CSS and DaisyUI, featuring two custom-crafted warm-tinted themes designed to reduce eye strain during extended creative sessions while maintaining high contrast.

### ☕ Solva-Dark (`solva-dark`) — Espresso & Sunrise Glow
Designed for deep night-owl or twilight composition sessions with warm charcoal undertones instead of cold blue-blacks.

* **Canvas & App Background (`base-200`):** `#14121B` (Deep Espresso Charcoal)
* **Panels & Cards (`base-100`):** `#1C1924` (Warm Dark Slate)
* **Borders & Insets (`base-300`):** `#2C2738` (Warm Muted Inset)
* **Primary Accent (`primary`):** `#F59E0B` (Sunrise Amber — Playhead, Active Steps, Key Controls)
* **Secondary Accent (`secondary`):** `#FB7185` (Dawn Coral — Chords & Harmony highlights)
* **Visual Accent (`accent`):** `#2DD4BF` (Fresh Teal — Synth & Modulation)
* **Base Content (Text):** `#F5EFEB` (Warm Cream Off-White)
* **Neutral (`neutral`):** `#24202E` / content `#F5EFEB` (chrome that must not read as an accent — inactive audition pills, muted chips)
* **Success (`success`):** `#5FD08B` — "saved", "envelope OK", live-signal indicator
* **Warning (`warning`):** `#FACC15` — VU meter upper-mid segments
* **Error (`error`):** `#F05545` — destructive actions, VU clip segments, mute-on
* **Info (`info`):** `#79A6E0` — neutral informational hints

### 📜 Solva-Light (`solva-light`) — Sunlight Alabaster & Warm Paper
Designed for morning and daytime sketching, simulating warm parchment paper without clinical stark white glare.

* **Canvas & App Background (`base-200`):** `#F7F4EF` (Warm Alabaster Linen)
* **Panels & Cards (`base-100`):** `#FFFFFF` (Pure White with Warm Cast)
* **Borders & Insets (`base-300`):** `#E8E2D8` (Soft Warm Gray Border)
* **Primary Accent (`primary`):** `#D97706` (Deep Warm Amber)
* **Secondary Accent (`secondary`):** `#E11D48` (Terracotta Rose)
* **Visual Accent (`accent`):** `#0D9488` (Deep Morning Teal)
* **Base Content (Text):** `#241E19` (Roasted Coffee Charcoal)
* **Neutral (`neutral`):** `#3D352E` / content `#FFFFFF`
* **Success (`success`):** `#2F8F5B`
* **Warning (`warning`):** `#A16207`
* **Error (`error`):** `#C2321F`
* **Info (`info`):** `#2C6FA8`

> Both themes are declared CSS-first in `src/index.css` via `@plugin "daisyui/theme" { … }`. There is no `tailwind.config.*` file in this repository and none may be added. The active theme is read from `document.documentElement.dataset.theme` and persisted to `localStorage` under `solva_theme`; `index.html` sets the attribute in a blocking `<head>` script so light-theme users never see a dark first paint.

---

## 3. Typography & Hierarchy

Solva uses clean, highly readable font stacks optimized for precision controls and musical notation.

* **Headings & Titles:** **Figtree** (variable, 300-900, loaded from Google Fonts in `index.html`) falling back to `system-ui, -apple-system, sans-serif`, with `tracking-tight` for compact musical labels. Applied to `body` in `src/index.css`.
* **Musical Values & BPM:** **JetBrains Mono** (weights 400/500/600/700), bound in `src/index.css` to `code, pre, .font-mono`. Every numeric readout carries `font-mono`: BPM, filter cutoff in Hz, gain in dB, percentages, octave offsets, arp step timing (`1/16`, `1/8`, `1/32`), and the oscilloscope's canvas axis labels, which set `8px 'JetBrains Mono', monospace` directly on the 2D context.
* **Font Scaling:**
  * **App Title:** 14px Bold (`text-sm font-extrabold`)
  * **Section Headers:** 14-16px Bold
  * **Control Labels & Hints:** 10-12px Medium (`text-xs` / `text-[10px]`)

---

## 4. Component Architecture

Solva is structured into modular, single-responsibility React components:

1. **`Header.tsx`**: Top navigation bar containing the Solva brand logo, project title, primary view tabs (`Synth`, `Step Matrix`, `Chords`, `Master FX`), global Key/Scale selector, Project modal trigger, and the **Theme Toggle** button.
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
   > The table is duplicated in `src/store/instantVibes.ts` and `src/audio/instantVibes.ts`; both copies must stay in sync.
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

### Known issue: forked Instant Vibes module

`src/audio/instantVibes.ts` and `src/store/instantVibes.ts` are diverged
copies of the same module. Only `store/` is imported (by
`InstantVibesBar.tsx`); the `audio/` copy additionally initialises the
audio engine and carries different preset content, and is dead code.
Resolving the fork is a product decision — it changes which presets and
which engine-sync behaviour ship — and is deliberately out of scope for
the theme-token migration.

---

## 6. Token Discipline & Enforcement

Solva has exactly two themes, and every surface must work in both. That is only achievable if **no component names a colour**. Components name *roles*; `src/index.css` maps roles to colours; daisyUI swaps the mapping when `data-theme` changes.

### 6.1 Canonical role map

Legacy Murva-era colours and their permanent replacements. When you touch old code, apply this table verbatim — do not improvise a "closer" match.

| legacy value | semantic token |
|---|---|
| `#0B0D19`, `#0E1022` — app / page inset background | `bg-base-200` |
| `#12152A`, `#171B36`, `#171B38`, `#161B36`, `#1A1E38`, `#1A1F3B`, `#1A1F3A`, `#181C35` — panels & cards | `bg-base-100` |
| `#1C213E`, `#22284C`, `#22274A`, `#20264A`, `#151933` — hover fills and recessed wells | `bg-base-300` / `hover:bg-base-300` |
| `#252B48`, `#2D355A`, `#3B4371`, `#1E2344` — borders and hairlines | `border-base-300` / `bg-base-300` |
| `indigo-*` — primary action, active state, playhead | `primary` (Sunrise Amber) |
| `purple-*` / `pink-*` — harmony, chords, filter / VCF | `secondary` (Dawn Coral) |
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
| keycap chip | `kbd kbd-xs` |

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
