# Solna — Design System & Architecture Specification

## 1. Introduction & Conceptual Vision

**Solna** is a dawn-inspired, single-user solo music creation and idea-sketching workspace. 
- **The Narrative**: Solna represents the quiet, focused morning hours (*Dawn*) where a musician explores chords, tests melodies, and sequences loops in solitude. Later, these ideas can be brought into **Murva** (*Dusk*) for multiplayer collaborative jamming.
- **Design Objective**: Deliver a cozy, low-pressure, highly tactile audio workstation experience that blends professional DAW capabilities with warm, inviting analog-hardware aesthetics.

---

## 2. Color System & Theme Architecture

Solna is built using Tailwind CSS and DaisyUI, featuring two custom-crafted warm-tinted themes designed to reduce eye strain during extended creative sessions while maintaining high contrast.

### 🌌 Solna-Dark (`solna-dark`) — Plum Shadow & Rising Gold
The hour before sunrise, with some of the night still in the shadows. A warm
plum-brown ground rather than the cold blue-black or the violet-tinted charcoal
this theme used to carry, and the first gold breaking over it. The violet accent
is deliberate: it is the one place solna and murva touch, so the two read as one
family across opposite ends of the same day.

* **Canvas & App Background (`base-200`):** `#17100F` (Plum Shadow)
* **Panels & Cards (`base-100`):** `#221921` (Warm Plum Panel) — rendered at 80% via `bg-panel`, see below
* **Borders & Insets (`base-300`):** `#33232D` (Plum Inset)
* **Primary Accent (`primary`):** `#FFB347` (Rising Gold — Playhead, Active Steps, Key Controls)
* **Secondary Accent (`secondary`):** `#F2657E` (Dawn Rose — Chords & Harmony highlights)
* **Visual Accent (`accent`):** `#8C7BE0` (Handshake Violet — Synth & Modulation; murva's own hue, and the cool counterweight that keeps the theme from reading as one continuous warm wash)
* **Base Content (Text):** `#F6E9E4` (Warm Cream Off-White)
* **Neutral (`neutral`):** `#2A1F27` / content `#F6E9E4` (chrome that must not read as an accent — inactive audition pills, muted chips)
* **Success (`success`):** `#5FD08B` — "saved", "envelope OK", live-signal indicator
* **Warning (`warning`):** `#F0C244` — the level meter's `hot` zone fill (−6 to −1 dBFS; `zoneFillClass` in `utils/meterColor.ts`), the `SOLO · … ×` chip, and the Stop transport
* **Error (`error`):** `#F0604B` — destructive actions, the meter's `over` zone (≥ −1 dBFS) (mute state is not one of these — see §6.5 / `PowerToggle`, whose off state is `btn-ghost text-base-content/40`, never `btn-error`)
* **Info (`info`):** `#7C9EE8` — neutral informational hints

### 📜 Solna-Light (`solna-light`) — First Light on Paper
Designed for morning and daytime sketching, simulating warm parchment paper
without clinical stark white glare.

* **Canvas & App Background (`base-200`):** `#F9F0EC` (First-Light Paper)
* **Panels & Cards (`base-100`):** `#FFFCFA` (Warm White)
* **Borders & Insets (`base-300`):** `#E9D8D6` (Soft Rose-Grey Border)
* **Primary Accent (`primary`):** `#B65F00` (Deep Rising Gold)
* **Secondary Accent (`secondary`):** `#C43356` (Rose Madder)
* **Visual Accent (`accent`):** `#6A4FD1` (Handshake Violet)
* **Base Content (Text):** `#2A1A20` (Roasted Plum Charcoal)
* **Neutral (`neutral`):** `#3E2B33` / content `#FFFFFF`
* **Success (`success`):** `#238652`
* **Warning (`warning`):** `#A16207`
* **Error (`error`):** `#C2321F`
* **Info (`info`):** `#4B46C0`

> **Every `·-content` value is contrast-derived, not chosen by eye.** Each one is whichever of the
> theme's ink or paper wins WCAG contrast against its own token, and all eight semantic pairs clear
> 4.5:1 in both themes. The previous palette did not: white on `solna-light`'s `primary` was 3.19:1
> and on its `accent` 3.74:1. Re-tint a token and its content value has to be re-derived with it.

> **The canvas is a sky, not a tint.** `src/index.css` defines a `bg-canvas` utility: an opaque three-stop `linear-gradient(to bottom in oklch, …)` — `--canvas-sky` `#011019` at the top, `--canvas-cross` `#120914` at 54%, `--canvas-ground` `#120600` at the bottom — with the sunrise (`--canvas-dawn`, mixed from `primary` at 15%) as a radial glow layered over it. `App.tsx` wears `bg-canvas` instead of `bg-base-200`; it is a full-height flex column that would otherwise paint over anything set on `body`. It is **static** — the audio-reactive ambient wash that used to live here was removed deliberately.
>
> The structure mirrors murva's `--murva-dusk-canvas` (see `murva-brand/tokens.css`): cool top, chromatic crossing, warm ground. **murva crosses through plum, solna crosses through rose** — that is the whole difference between dusk and dawn, and the jump sizes are asymmetric on purpose: dusk puts its crossing near the cool end because violet owns the upper sky once the sun has gone, dawn puts it near the warm end because the light is arriving from below. The crossing also does real work; a straight blue→amber interpolation passes through the grey axis and goes muddy, which is why the rose stop and the `in oklch` hint are both load-bearing. `background-color: var(--color-base-200)` stays as a fallback, because a browser that cannot parse `in oklch` drops the whole gradient.
>
> Why it exists at all: Solar's ground, primary and text all sit between hue 57° and 76° — a 19° window — so a flat `base-200` canvas read as gold rather than as dawn. The gradient travels about 190° as rendered.

> **The canvas must stay darker than the panels.** The dark stops are the full-brightness values halved in sRGB. Before that they were not: the sky stop sat at L 0.232 against the 80% panel's 0.225, so at the top of the screen the canvas was *lighter* than the cards on it and at the bottom it was darker — the figure/ground order inverted halfway down and cards read as holes. Halved, every stop sits 0.050–0.071 below its own panel and stays there. Halving in sRGB rather than OKLCH lightness is deliberate: sRGB scaling preserves hue by construction, where halving OKLCH `L` pushed the ground stop out of gamut and rendered it grey. The sunrise gains too — it now lifts the bottom centre 0.128 over the bare ground, where before the ground was already warm and the glow did almost nothing. Chroma now sits near the sRGB ceiling for these lightnesses (~0.030) and cannot be raised without raising lightness with it, which would reintroduce the inversion.
>
> **The light stops are not halved.** On paper the panels are already 0.037–0.043 lighter than every point of the gradient, so the order never inverted there, and darkening would only turn the canvas grey.

> **A nested panel recesses rather than floats.** `PANEL_CARD_INSET` (`ui/PanelCard`'s `inset` prop) is `bg-base-200` with a border and no shadow, for a card that sits INSIDE another card — the synth's five stage panels and the Simple-Mode macro dials, inside the Synth `SectionCard`. The floating shell repeated inside a card reads as a pile of siblings that happen to overlap their parent; the recessed one reads as the parent's own compartments, which is the well idiom the oscilloscope box and `JOIN_LANE` already use.
>
> **Panels are opaque; the canvas reads around them.** The panel layer uses `bg-panel` (an `@utility` in `src/index.css`), which is plain `base-100`. It was 80% for a while so the sky showed through the UI, and the page read washed — the panels never settled into a surface of their own. The utility stays rather than folding back into `bg-base-100`: it names the role, it is the single place to revisit that ratio, and the module tints composite over it. **Overlays do not use it** — a modal, drawer or popover covers other UI rather than the canvas, so `modal-box`, the preset drawer `aside`, its inner `card-compact` and `QuickSavePopover` keep plain `bg-base-100`, as do nested wells inside a card and the `Header`/`TransportBar` frame chrome.
>
> **Module tints are flat, and they need a surface under them.** `tint-chord` and `tint-bass` paint a 10% module colour as a single-colour image layer over `bg-panel`, for the Synth `SectionCard` in `SoundView` (once — see §6.5) and the progression and Bass Module cards in `ChordView`. They are image layers rather than background-colours because those cards already carry `bg-panel`, and two background-colour utilities on one element is a coin toss decided by Tailwind's sort order. The `ChordView` pair used to be `bg-module-chord/10` and `bg-module-bass/10` with no surface beneath — 10% opaque directly on the canvas, so the sky gradient read straight through the cards and they appeared to be gradients themselves. Any tinted card needs `bg-panel` under the tint for the same reason.

> Both themes are declared CSS-first in `src/index.css` via `@plugin "daisyui/theme" { … }`. There is no `tailwind.config.*` file in this repository and none may be added. The active theme is read from `document.documentElement.dataset.theme` and persisted to `localStorage` under `solna_theme`; `index.html` sets the attribute in a blocking `<head>` script so light-theme users never see a dark first paint.

---

## 3. Typography & Hierarchy

Typography is shared with murva, and solna is **single-face**: one sans stack for everything, nothing monospaced anywhere. `murva-brand/design.md` §4 is the source of truth for the stack — change it there first.

* **Headings & Titles:** **Figtree** (variable, 300-900, loaded from Google Fonts in `index.html`) with **Anuphan** behind it for Thai — `font-family: "Figtree", "Anuphan", sans-serif`, `tracking-tight` for compact musical labels. This stack is **shared with murva** and copied verbatim from `murva-brand/design.md` §4; change it there first. It is registered as `--font-sans` in an `@theme` block in `src/index.css` (so the `font-sans` utility and Tailwind's `--default-font-family` both resolve to it) and applied to `body` in the same file.
* **Monospace — none, and `font-mono` is banned.** No mono webfont is loaded and the `font-mono` utility is not used: the whole UI, machine values and music notation included, sits on the sans stack. The `mono-font` rule in `scripts/themeTokenGuard.ts` (`bun run check:theme`) fails the build on `font-mono` or a literal mono stack in app source, so the ban is a gate rather than a convention. Two places the class-level ban alone would have missed, both handled in `src/index.css`: `<kbd>`, `<code>`, `<pre>` and `<samp>` get `font-family: inherit` in `@layer base`, because the user agent (and daisyUI's `.kbd`) monospaces them on its own; and the oscilloscope's canvas axis labels name the sans stack literally (`8px Figtree, Anuphan, sans-serif` on the 2D context), because canvas cannot take a class — that literal must stay in step with `--font-sans`.
* **How numbers hold still.** What `font-mono` used to buy — digits that do not jitter as a readout ticks — is `tabular-nums`, and that is the only tool for it: dB and gain readouts, BPM, Hz, octave offsets, bar and step counts, rhythmic notation (`1/16`, `1/8`), positions in badges and pills. Words never take it: section labels (`AMP / VCA`, `Category:`), chord symbols and roman numerals, note names on keys, category names, button text, prose.
* **Font Scaling:**
  * **App Title:** 14px Bold (`text-sm font-extrabold`)
  * **Section Headers:** 14-16px Bold
  * **Control Labels & Hints:** 10-12px Medium (`text-xs` / `text-[10px]`)
  * **Casing by role.** A view's header title is Title Case (`Synth Lab`,
    `Drum Sequencer`). A section header inside a view is
    `text-xs font-bold uppercase tracking-wider` (`KEYBOARD`, `FX CHAIN`,
    `BASS MODULE`). A card title is Title Case (`Space Reverb`). Machine-computed
    context never sits inside a heading — it goes in a `tabular-nums` badge beside
    it, which is why `sequencerMeterBadge` exists.
  * **Field labels are not section headers.** A label naming one control is the
    plain muted 10px form, never `uppercase font-bold tracking-wider` — that
    weight belongs to the section header above it, and a label wearing it
    flattens the hierarchy. There is exactly one such label in the app,
    `FIELD_LABEL` in `components/ui/fieldClasses.ts`; four hand-written copies
    had drifted in opacity, margin and weight before it existed, and
    `fieldClasses.test.ts` fails the build if a fifth appears.
  * **Stacked or inline, by container.** A control inside a card's control row
    wears its label *above* it (`FIELD_LABEL`) — the form `ChordView`'s
    preset/octave/pattern/feel/level row uses. An inline `Label:` prefix is only
    for a group that sits in a one-line toolbar with no room to stack, which is
    why `Focus:` and `Sound Style:` keep it.
  * **One label line, one control lane.** A stacked label only lines up if every
    control in the row does, so a labelled field puts its control in
    `FIELD_LANE` — the 32px line `btn-sm` and `select-sm` already resolve to.
    Bottom-aligning raw controls instead is what scattered the sequencer's Drum
    Sound labels across five heights: a 24px `btn-xs` join, a 30px fader shell,
    a 32px select and a 48px knob in one `items-end` row. A control slightly
    taller than the lane (a `sm` knob is 36px) centres and overhangs it evenly;
    that reads as aligned, a differing label baseline does not.

    The *pairing* is the rule, so `components/ui/Field.tsx` owns it and
    `FIELD_LABEL` / `FIELD_LANE` are its internals: the Drum Sound row
    hand-assembled the same `<div><label/><div lane/></div>` four times before
    it existed. A lane with no label above it (the Pattern card's drum-grid select,
    named by `aria-label` because its card title already says "Pattern") still
    uses `FIELD_LANE` directly — there the lane is load-bearing layout, since
    daisyUI's `.select` is `width: 100%` and would claim the whole flex row.
  * **Section headers and ordinal badges are tokens too.** `SECTION_HEADER`
    (`text-xs font-bold uppercase tracking-wider text-base-content`) is the
    string `FIELD_LABEL` defers to above; it was spelled out by hand in six
    components. `STEP_BADGE` is the ordinal chip a numbered module card carries
    (the synth's five signal stages, the master rack's four FX units — nine
    copies), and `HEADER_BADGE` is the badge `ViewHeader` sets beside a title,
    which ChordView's chord-count chip is a second instance of. `HEADER_GROUP` is
    the join shell every group in the header chrome sits in — the layer switcher,
    the tab bar, Pattern's segment row, Sound's Simple/Pro — and is deliberately
    not `JOIN_LANE`: that one composes `FIELD_LANE` to drop `btn-xs` toggles onto a
    labelled field's baseline, and a header has no field baseline to join.

---

## 4. Component Architecture

Solna is structured into modular, single-responsibility React components:

1. **`Header.tsx`**: Top navigation bar containing the Solna brand logo, project title, primary view tabs (`Sound`, `Pattern`, `Arrange`, `Master FX`), global Key/Scale selector, Project modal trigger, the **Theme Toggle** button, and the song layer's `Export ▾` menu — the header's one arrangement-wide action, offering **Export mixdown (WAV)**, which renders the whole arrangement to a file the browser downloads (`ExportButton`, rendered only when the active layer is the song layer; the menu is shaped for a stem row that v1 does not ship).
2. **`InstantVibesBar.tsx`**: Quick-start genre and mood presets (`Lo-Fi Chill`, `Synthwave 80s`, `Cyber EDM`, `Deep Ambient`, `Boom Bap`, `Zen Garden`, `Lo-Fi Waltz`, `Afro 6/8`) allowing instant loading of complete harmonic and rhythmic templates.
3. **`TransportBar.tsx`**: Bottom sticky player controls featuring the app's ONE Play/Stop (the per-tab "Tab Play" transports were deleted with the nav restructure — `Header.tsx` renders no `PlayerTransport` any more), a play-target label naming what Play will start (`Song` on the song layer, the active loop's name on the loop layer — `playTargetLabel` in `components/transportAction.ts`, tied to the button by `aria-describedby`; which action Play runs is the layer itself, read inline in `TransportBar`), a BPM stepper (−/+ buttons around a `40`–`240` number input; there is **no** tap-tempo), a Metronome toggle, a **mono** dBFS level meter (`VuMeter` → `ui/MeterBar.tsx`: a solid RMS fill over a fainter peak fill, both coloured ONCE from `classifyZone(peakDbfs)` — neutral `base-content/30` below −24, `success` from −24 to −6, `warning` in `hot` (−6 to −1), `error` at `over` (≥ −1) — with zone ticks and a decaying peak-hold marker; never a gradient, and no segments: the ten-block bar and `utils/vuMeter.ts` were both deleted), and the Master Output volume fader. Its centre carries `PlayheadReadout`, not the visualizer — the canvas view moved to `EffectsRackView`'s Monitor section (item 7).

   > **Explicitly unbuilt.** Two features described in earlier revisions of this spec were never implemented and are recorded here as future work, not as shipped behaviour:
   > - **Tap Tempo** — a button that derives BPM from the interval between successive clicks. The BPM setter (`setBpm`) already exists in the store, so this is UI-only work.
   > - **Stereo VU** — the meter reads a single scalar level. Making it stereo requires a channel-split analyser in `src/audio/engine.ts` before any UI change is worthwhile.
4. **`SimpleSynthPanel.tsx` / `SoundView.tsx` / `loop/synth/*Panel.tsx`**: Dual-mode synthesizer interface. Simple mode is 4 friendly macro knobs (`Tone`, `Space`, `Vibe`, `Punch`) in `SimpleSynthPanel`. Pro mode is five independent module panels under `components/loop/synth/` — `OscillatorPanel`, `FilterPanel`, `EnvelopePanel`, `LfoPanel`, `ArpeggiatorPanel`, in that order — each wearing its own identity token from §6.5. They take **no props**: each calls `useSynthChannel()` (`loop/synth/useSynthChannel.ts`), which resolves `params` / `onChangeParams` for the active focus (Lead, FX, Chord, Bass or Pad) straight from the store — the tint moved to the section, see §6.5, so `SoundView` renders `<OscillatorPanel />` with no wiring and its own re-renders no longer reconcile the knob JSX. `SoundView` keeps the mode switcher, the preset header, the focus row, the keyboard and the lazily-loaded preset library. The preset bar and whichever mode body is showing live in ONE `SectionCard` titled "Synth", with the five stage panels as `inset` compartments of it rather than cards beside it — but the focus row itself sits in the page shell ABOVE that card, not inside it, because a drum focus unmounts the Synth section entirely and the row is the only control that can point focus back at a melodic track. Synth and Drum Sound are mutually exclusive on focus — exactly one of the two is ever on screen — so they never read as peers open on the same band; Mixer is the one section that stays up regardless of focus. (The lead piano-roll moved to Pattern › Lead with the nav restructure; `SoundView.tsx` was named `SynthView.tsx` before that restructure — the old name no longer exists on disk.)
5. **`SequencerView.tsx`**: Multi-track step sequencer grid for drums, bass, synth, and percussion patterns with velocity and step probability editing. Seven tracks — kick, snare, hihat, openhat, clap, tom, crash — each on its own semantic theme token; `THEME_TOKENS` has eight non-surface entries, so the next two voices cannot each take a fresh one.
6. **`ChordView.tsx` / `loop/chord/ChordModulePanel.tsx` / `loop/chord/BassModulePanel.tsx`**: Interactive chord progression builder. `ChordView` owns the sortable chord-card grid, the in-scale and borrowed quick-add palettes, the key/scale effects and the pattern-preview handlers; the two module cards own their own controls (preset, octave, pattern select + custom step grid, feel, level — plus Re-harmonize and Auto-Reharmonize on the chord card), read their own slice of the store, and take only what they cannot derive: the two preview handlers, and the chord card's auto-reharmonize state and Re-harmonize action. The grid is deliberately NOT extracted — it shares `handleMoveChord` / `removeChord` / `updateChord` and `SortableChordCard`'s memo contract too tightly to split without threading half of ChordView's state back in as props.
7. **`EffectsRackView.tsx`**: Two sections. **FX Chain** is a two-column grid (room for a compressor or graphic EQ) holding Algorithmic Space Reverb, Stereo Echo Delay, Wave Distortion/Crunch, and a 3-Band Equalizer. **Monitor** holds `AudioVisualizer` (item 9), passed a `paused` prop tied to whether Master FX is the active tab — see item 9 for why that prop exists at all.
8. **`ProjectModal.tsx`**: Project save / load / export / import dialog, rendered as a daisyUI `modal` with a `modal-box` and `modal-backdrop`. Its menu (`project/ProjectMenu.tsx`) is three sections — **New project**; **Local** (Open .solna, Save, Save as…); and **Drive** (**Open from Drive**, Save as to Drive…, Disconnect Drive), a group that appears only when a client id is configured, so a Drive-less build shows no dead affordance. Open, Open from Drive and New all replace the one autosaved project and share one confirm; Save, Save as… and Disconnect Drive never touch it. See §5 for what Save writes to, and for the two browser and Drive limits a reader will otherwise be surprised by.
9. **`AudioVisualizer.tsx`**: Canvas visualizer with three modes (`wave`, `bars`, `oscilloscope`) — `VisualizerMode` never had a fourth; an earlier revision of this spec claimed an `ambient-bg` mode that was never built. Because canvas takes colour strings rather than classes, it reads the live theme through `src/utils/themeColor.ts`; its `colorTheme` prop takes a semantic role (`primary` | `secondary` | `accent`), never a palette name. The mode set and its order live in one exported `VISUALIZER_MODES` so the canvas click-to-cycle gesture and a caller's own switcher cannot disagree about them. It renders no built-in mode switcher: `EffectsRackView` is the only caller that offers one, it renders its own, and a second unused copy inside this component was dead markup that also forced `mode` to support an uncontrolled path nothing used. It lives in Master FX's Monitor section (item 7) and takes a `paused` prop: `App.tsx` keeps all four views mounted at once, only toggling `block`/`hidden` on the active tab so audio never stops on a tab switch, which means any `requestAnimationFrame` loop inside a view keeps running on a hidden tab unless something gates it — `paused` is that gate, driven by `activeTab !== 'master'`.
10. **`DrumPads.tsx`**: Velocity-sensitive drum pad grid with computer-key shortcuts. Exports `DEFAULT_PADS`, whose `shortcut` codes are asserted collision-free against the synth keyboard by `scripts/check-key-bindings.ts`.
11. **`ChordPresetLibrary.tsx`** / **`SynthPresetLibrary.tsx`**: Searchable, category-filtered preset browsers for chord progressions and synth patches, including user-saved presets from `localStorage`.
12. **`chord/SortableChordCard.tsx`**: A single draggable chord card (`@dnd-kit/sortable`) used by `ChordView`.
13. **`InstantVibesBar.tsx`** *(see item 2)* and **`useSequencerPlayback.ts`** / **`chord/useChordPlayback.ts`**: playback hooks, not visual components.
14. **`ui/AmbientBackdrop.tsx`**: full-bleed, analyser-driven ambient field mounted as the first child of the App root at `absolute inset-0 z-0`, behind the whole workspace. Gives every tab continuous "audio is live" feedback without a meter's per-bin detail — three slow-drifting radial-gradient blobs, tinted `primary` / `accent` / `secondary`, whose size and opacity track the analyser's average level. It is frozen (not merely paused) under `prefers-reduced-motion` and idle whenever nothing is playing, per `shouldAnimateBackdrop`. It is one of the five `no-restricted-imports` exemptions in layering rule 3 (with `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/GainReductionMeter.tsx` and `ui/SourceMeter.tsx` — `eslint.config.js` is the binding list), for the same reason as the others: routing a per-frame analyser read through the Zustand store would mean a store write on every animation frame and a re-render of every subscriber, so it reads `audioEngine` directly instead.

### The `ui/` primitive layer

Shared, presentation-only controls under `src/components/ui/`. These own the daisyUI class defaults, so feature components should pass **no** colour overrides:

* **`Knob.tsx`** — rotary control. Its `color` prop is a closed union: `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'`. Passing a raw palette class is a compile error, which is deliberate. Its `descriptor?: string` prop renders a badge tinted from the knob's own colour, for plain-language readings of a raw number — reverb decay in seconds as "Room" / "Hall" / "Cathedral", distortion drive as "Warm" / "Crunch" / "Fuzz" (see `fxDescriptors.ts`). It exists for parameters whose number alone does not say what the user will hear; percentages and dB values already read plainly and deliberately get no descriptor.
* **`Slider.tsx`** — wraps `<input type="range">`; defaults to `range range-primary range-xs w-full`.
* **`Keyboard.tsx`** — `ScaleLockedKeyboard` and `ChromaticKeyboard`, plus the `KEYBOARD_NOTES` binding table and the `getBlackKeyLeftPx` geometry helper covered by `SoundView.test.tsx`.
* **`ChannelStrip.tsx`** — mixer channel (fader, mute, solo, pan). `max` is required, not defaulted: the fader ceiling is a property of the bus (chord and bass boost to 1.5, the drum bus is a plain 0..1 master), so a default would hand whichever value it picked to the next caller by silence.
* **`StepRow.tsx`** — the single implementation of a step-grid row app-wide: the chord on/off grid, the bass tone-choice grid and the sequencer's drum/synth lanes all render through it. Generic over the per-step value; `isActive` says what counts as on and `color` is the caller's module token, so the primitive never names a colour. Three optional props cover the sequencer's needs without forking the markup: `getButtonId` (the `step-${track.id}-${index}` convention `TrackRow` has always stamped), `activeOverlay` (`'label'`, the default badge, or `'pulse'`, the sequencer's `animate-pulse` fill) and `rowClassName` (the sequencer's row needs `flex-1`). `TrackRow` used to carry a byte-for-byte copy of this button's class expression; it does not any more, and a byte-identity test in `sequencer/TrackRow.test.tsx` pins that the migration changed no markup.
* **`PresetLibrary.tsx`** — the generic library shell both preset browsers build on.
* **`QuickSavePopover.tsx`** — inline name-and-category save form; its `inputClassName` / `selectClassName` props default to daisyUI classes (`input input-sm input-bordered` / `select select-sm select-bordered`), and `buttonClassName` defaults to `""` and layers over the built-in `btn` classes — all three should be left alone.
* **Header holds identity; modules hold their own controls.** A view header
  carries the title, its badge, and at most a few view-level actions (a mode
  switch, Save, the library drawer). Everything that adjusts one module lives in
  that module's own card — which is why `Chord Level` and `Re-harmonize` sit
  inside the chord card rather than the header. `SequencerView` was the last
  view to break this: its header had grown to seven controls, so the kit, filter
  and level moved into `Drum Sound` and the drum-grid picker, shift, Random and
  Clear moved onto the `Pattern` card, beside the grid they rewrite. Those
  pattern tools sit OUTSIDE that card's `overflow-x-auto`, so they stay put
  while a grid wider than the card scrolls under them.

* **`ViewHeader.tsx`** — the header card a TAB opens with; it used to be copy-pasted into three views and was simply missing from `SoundView`. Icon and title come from `viewMeta.ts`, so a tab and the view it opens can never disagree about what it's called; the icon chip is always `primary` (§6.5) and takes no colour prop. Three tabs use it: Sound, Arrange and Master FX; Pattern's three segments each open with a **`SegmentHeader.tsx`** instead, which takes its icon and title from `VIEW_META.pattern` — so the card is named for the TAB, not the segment — and hangs the segment row off it as `viewControls` (`PatternSegmentRow`, the one reader of `PATTERN_SEGMENTS`, whose entries carry no `title` any more), rendering the *same* card through the shared `HeaderCard` so the two cannot drift. The card has two control slots and the split is by role, not by side: `viewControls` sits beside the title and selects WHAT the view shows — Pattern's segment row (which content), the Sound tab's Simple/Pro (how deep the same content) — while `actions` is the right-hand cluster of what you DO to what is on screen (save this patch, open that library). That cluster leads with the `SOLO · … ×` chip (`SoloChip.tsx`) — not an action a view declares but the loop's own state, shown wherever the user is. It sits in the shared card, not in one view, because a solo set survives the Sound ↔ Pattern hop (`store/soloNav.ts`) and the control that names it has to survive it too; on the song layer the set is already cleared, so the chip renders nothing there without any view gating. It moved here from `TransportBar`, where it was wedged between the play-target label and the BPM stepper and truncated the track names on narrow widths. Because six headers stay mounted at once it carries `data-solo-chip`, never an `id`. The cluster is `empty:hidden`, so a header with neither actions nor a solo leaves no empty box in the row. Both `viewControls` callers wear `HEADER_GROUP`, the one join shell the layer switcher and the tab bar also wear, so every segmented control in the chrome is one height. Simple/Pro used to sit in `actions` in a `JOIN_LANE` of `btn-xs`, which put a 32px segmented control in the same card as Pattern's 40px one.
* **`SegmentHeader.tsx`** — see above: `ViewHeader`'s sibling for Pattern's Lead / Accompaniment / Beat segments, exactly one of which is on screen at a time.
* **`SectionCard.tsx`** — `ViewHeader` one level down: it names a SECTION *inside* a view, where `ViewHeader` names the tab. The Sound tab holds three — Synth, Drum Sound, Mixer — and before this component the three announced themselves at three different weights (the synth had no heading at all, the drum card drew a `secondary` icon plus a `SECTION_HEADER`, the mixer drew a bare `SECTION_HEADER`), which is what made the tab read as "the synth, plus two leftovers". One band, one icon rule (`primary`, §6.5), one optional tint (also §6.5), and the section's own controls in `actions`.

* **`GroupFrame.tsx`** — a neutral enclosure that says "these belong together" and nothing else. It carries no tint and never recolours its contents: §6.5 spaces `module-chord`, `module-bass` and `module-pad` around the wheel so the three stay separable, and a group tint would undo that to express a grouping the enclosure already expresses.
* **`SoloButton.tsx`** — the one track-solo control, at all six placements (Sound's focus row, Pattern › Lead's grid card, the chord/bass/pad rows, Pattern › Beat's Drum Pattern card). The two Pattern ones ride the content card's `ModuleHeader` `right` slot, not the segment header: `SegmentHeader` names the TAB, so a solo that describes one grid sits beside that grid. It only WRITES `soloTracks`; effective audibility is computed in `store/engineSync.ts` and nowhere else, because `src/components/` may not import `audio/engine`. The mixer deliberately has none.
* **`PowerToggle.tsx`** — the single on/off control app-wide. `on` wears the module's own tone (a closed `PowerToggleTone` union); `off` is `btn-ghost text-base-content/40`, never `btn-error` — per §6.5, `error` means destructive, and red on an off control would read as broken rather than muted. One icon throughout: `Power` means on/off; `Volume2`/`VolumeX` are reserved for level controls, not toggles.
* **`viewMeta.ts`** — not a component but the table both `Header.tsx`'s tab buttons and `ViewHeader.tsx` read: one row per tab with its icon, `tabLabel` (short form, hidden below `xl`) and `title` (long form on the header card). A test pins the four icons as distinct — it caught a real bug where Synth and Master FX both used `Sliders` and were indistinguishable once the tab label disappears below `xl`.

---

## 5. Audio Engine & State Persistence

- **Audio Synthesis**: Hand-rolled on the **raw Web Audio API** — a single `audioEngine` singleton (`src/audio/engine.ts`) owning the `AudioContext`, the voice pool, the parallel effect sends and the shared 16th-note clock. There is no Tone.js; `tonal` is a music-theory dependency only.
- **State Management**: Zustand store (`src/store/`) managing transport, synth patches, chord progressions, drum grids, and master effects in real-time.
- **Persistence**: Local storage and project JSON export/import workflows allowing creators to save and load their musical sketches effortlessly.
- **Project source — Save, Save As, Open from Drive.** A project has a *source* as well as a body: the slot's value is a record `{ body, source }`, where the source is `untitled`, a local file handle, or a Google Drive file id, and it lives beside the body rather than inside it. **Save** writes to whatever the source already names — overwriting the local file or the Drive file — and on an untitled project Save *is* Save As, since there is nothing to overwrite. **Save As** mints a new document identity (fresh id, new name) and lets the caller choose local or Drive. **Open from Drive** lists the app's own Drive files and installs the chosen one. The source is never serialised into the `.solna` body, so a file carries no pointer to where it came from, but it lives in the IndexedDB slot record beside the body, so a reload restores the source from the slot record.
- **Two capability facts worth stating, because a reader will otherwise expect them.** Local
  overwrite needs the **File System Access API** — `showSaveFilePicker` / `showOpenFilePicker`,
  Chromium today, and absent or refused in Safari and Firefox — so on those browsers Save falls
  back to a download rather than a silent no-op. And **Drive lists only the projects solna
  itself created**: the app requests the single scope `.../auth/drive.file`, under which Google
  returns only files this app made, so a user's other Drive files are neither shown nor
  reachable. Both are deliberate, not gaps.

### Resolved: the forked Instant Vibes module

`src/audio/instantVibes.ts` was a diverged copy of `src/store/instantVibes.ts`
with no production importer — only its own test file loaded it. The
`2026-08-24-murva-restructure` plan already called for deleting it after the
move to `store/`; that step was never carried out, so the fork stayed behind
and drifted: its drum-pattern keys were `Kick`/`Snare`/`HiHat` where the engine
reads `kick`/`snare`/`hihat`, and it named a `Velvet EP` preset that no longer
exists anywhere in the codebase. Its test suite passed the whole time, on data
nothing shipped.

Both files are now deleted. `src/store/instantVibes.ts` was the only copy from
that point on — it has since been renamed `src/store/vibes.ts` and had its
literal split out to `src/data/vibes.ts`, but there is still exactly one copy
of the table. The two `no-restricted-imports` errors the fork raised (`audio/`
must not import `store/`) are gone with it. The engine-init block and the
extra effect parameters it carried (`delayTime`, `chorusWet`/`Rate`/`Depth`)
were never audible and are recoverable from git history if they are ever
wanted.

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
| `rose-*` / `red-*` — delete, clip | `error` |
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
| `module-chord` / `-content` | olive 125° | Chord cards, chord audition, the Chord target in `SoundView`'s toggle |
| `module-bass` / `-content` | steel blue 256° | Bass module, the Bass target in `SoundView`'s toggle |
| `module-osc` / `-content` | butter gold 87° | `loop/synth/OscillatorPanel.tsx` |
| `module-filter` / `-content` | rose 356° | `loop/synth/FilterPanel.tsx` |
| `module-env-vca` / `-content` | emerald 162° | `loop/synth/EnvelopePanel.tsx` — AMP / VCA half |
| `module-env-vcf` / `-content` | violet 294° | `loop/synth/EnvelopePanel.tsx` — FILTER / VCF half |
| `module-lfo` / `-content` | cyan 213° | `loop/synth/LfoPanel.tsx` |
| `module-arp` / `-content` | orchid 322° | `loop/synth/ArpeggiatorPanel.tsx` |

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

**The target tint is painted once, on the section that owns the target.** `tint-chord` / `tint-bass` / `tint-pad` say WHICH of the four layers the Sound tab is editing, and they belong on `ui/SectionCard`'s Synth section — not on the panels inside it. They used to ride all six surfaces at once (the target/preset card, the five Pro-Mode stage panels, and every Simple-Mode macro card), which was one fact stated six times inside what is now a single card, and it left `useSynthChannel()` handing every panel a `tintClass` it only needed because the panels were siblings rather than compartments. A stage panel therefore takes `PanelCard`'s `inset` shell and no tint at all; the hook no longer returns one. This does not loosen the rule above it — a stage's own identity hue (`module-osc`, `module-filter`, …) is unchanged and still lives on the stage — it only stops the *target* tint from being repeated inside a container that already carries it.

View-header chrome is `primary` like every other non-signal-stage control: `ViewHeader`'s icon chip is always `primary`, never a module colour, and `SectionCard`'s section icon follows the same rule — the Drum Sound band wore `secondary` until this work, which read as a fourth signal colour on a surface that is not a signal stage. `ChordView` tinted its header chip `module-chord` until this work — the sole violation of the rule above, now removed. There is deliberately no `module-drum` or `module-fx` token: the sequencer and effects rack are not signal stages with a persistent identity to defend, so their chrome stays on `primary` like everything else that isn't one of the synth's six panels.

**Accepted exception: the four Master FX cards.** `EffectsRackView`'s Reverb, Delay, Distortion and EQ cards tint their active ring and knobs `accent`, `accent`, `primary` and `secondary` respectively, purely so the four units read as visually distinct at a glance — while their bypass `PowerToggle`s are uniformly `accent`, since bypass state (on/off) is one semantic regardless of which unit it belongs to. This borrows daisyUI semantic roles for per-card identity, which is exactly what this section otherwise forbids for modules. It is accepted as-is rather than fixed, because the correct fix — a `module-fx` token pair per unit — is the token this section deliberately declines to add above (the effects rack is not a signal stage with a persistent identity to defend). Revisit only if the effects rack grows enough units that borrowed semantics stop reading as distinct, at which point a real `module-fx-*` set becomes worth its cost.
