# Sound Header Ownership and Beat Voice Cards — Design

> Give the Sound tab's header back to the Sound tab, make the depth switch one value with two
> vocabularies, and turn the eleven Beat voice accordion rows into cards in a grid.
> Written 2026-09-15 on `enhance/beat-instrument-model` (`9e0c31c`). Every decision below is
> settled; the one genuinely open question is under **Open**.

## Problem

**The synth half owns the whole tab's header.** `SoundSynthSection` renders `ViewHeader
view="sound"` itself, so the tab's identity — its icon, its title, the `SoloChip` that rides in
every `HeaderCard` — is drawn by a component whose name claims only the synth. That is invisible
while a synth channel exists and becomes a defect the moment one does not. On a drum focus
`synthTargetForFocus` returns `null`, and today the section still renders: a Sound header carrying
a Simple/Pro switch over a screen with no Simple and no Pro to choose between, then a focus row,
then a `SectionCard` whose body has no patch to draw — an empty card between the header and the
real editor. The Beat editor that IS the screen renders below all of it, third.

**The Beat editor stacks eleven full-width accordion rows.** One voice per row, one row open at a
time below `lg`, every row open at `lg` — so at desktop width eleven rows each spend a full
viewport's width on a knob lane that needs a fraction of it, and the vertical run is eleven rows
of header plus knobs. Each row carries a per-row More/Less disclosure on top of the list's own
accordion, which is two disclosure models in one surface, and a one-line `beatVoiceSummary`
whose entire job is to stand in for knobs that are not on screen.

## Goals

- `SoundView` owns the Sound header; `SoundSynthSection` becomes only the synth half its name
  claims, and unmounts entirely on a drum focus.
- One depth value for the whole tab, labelled in the vocabulary of whatever is focused.
- The Beat voices read as an instrument's eleven compartments — a card grid — not as a list.
- No new persisted state, no slice, no engine change, no schema change.

## Non-goals

- No change to `BEAT_CONTROL_SCHEMA`: Primary/More still means exactly what it means today, and
  `beatControlSchema.test.ts` needs no edit.
- No change to the synth's Simple/Pro panel trees, the preset browser, the overlays, or
  `useSynthChannel`.
- No Simple/Pro macro layer for Beat. `BeatSoundSection`'s own docblock — "NO SIMPLE/PRO SPLIT …
  Primary/More is disclosure, not a second parameter model" — stays true and stays in the file.
- No mobile-only interaction model for the voice cards (see **Accepted trade-offs**).

---

## 1. Header ownership moves to `SoundView`

`SoundView` renders `ViewHeader view="sound"` itself and passes `depth` down.
`SoundSynthSection` stops rendering a `ViewHeader` and takes `depth` as a prop.

`SoundFocusRow` is deleted **as a component**, not as a set of controls. Its three occupants each
go where they belong:

- the focus chips (the melody pair, the `GroupFrame`'d accompaniment three, the Beat chip) move
  into `HeaderCard`'s `viewControls` slot;
- `SoloButton` (`id="btn-solo-target"`) moves with them — it follows the focus, and "it follows
  the focus" is only legible beside the focus, which is the argument its current docblock makes
  and which the move preserves rather than breaks;
- the per-target oscilloscope moves DOWN into the synth card, carrying its `activeTab` pause prop
  with it. It taps `synthTarget`'s own pre-fader tap, so it belongs to the synth channel and not
  to the tab; on a drum focus it renders nowhere because the component that draws it is no longer
  mounted, which is stricter and cheaper than today's `synthTarget !== null` guard.

The depth switch moves to the `actions` slot, in the right cluster beside the existing `SoloChip`.

### The rule that changes, stated

`HeaderCard`'s `viewControls` docblock and `SoundSynthSection`'s call site currently argue that
the mode switcher belongs beside the title and NOT in `actions`, because "`actions` is the
right-hand cluster of things you DO to what is on screen … and a control that changes the screen
itself is not one of them". That argument was made when `viewControls` held the depth switch and
nothing else — with one occupant, "beside the title" cost nothing and the rule was untestable.

**The replacement rule: `viewControls` holds the control that selects WHAT this view shows;
`actions` holds everything else in the header's right cluster, including HOW DEEP the selected
thing is shown.** Focus and depth are different axes — which track, versus how much of it — and
now that the focus selector occupies `viewControls`, putting both on the same side would read as
one compound switcher. Opposite sides is more honest than the old placement was, not a
relaxation of it: the old rule only ever had one candidate to sort.

Both `HeaderCard` docblocks and `SoundSynthSection`'s comment must be rewritten to say this.
Leaving the old prose in place is how a later reader "restores" the depth switch to
`viewControls` and undoes the distinction.

### `SoloChip` and `SoloButton` are different controls

They look adjacent after this change and must not be deduped. `SoloChip` is the loop's own state
showing up wherever the user is — the `SOLO · … ×` badge with a clear affordance, rendered by
`HeaderCard` on every view header, reading `soloChipLabel(soloTracks)` and rendering nothing when
the set is empty. `SoloButton id="btn-solo-target"` is a TOGGLE for one track, the one
`soloTrackForFocus(focusTrack)` names. One says "something is silenced, stop it"; the other says
"silence everything but this". Both stay.

### Before / after

```
BEFORE                                  AFTER
SoundView                               SoundView
└─ SoundSynthSection                    ├─ ViewHeader view="sound"
   ├─ ViewHeader view="sound"           │     viewControls: [Focus chips][SoloButton]
   │     viewControls: [Simple|Pro]     │     actions:      [SoloChip][Simple|Pro]
   │     actions:      [SoloChip]       ├─ SoundSynthSection depth=…      (melodic focus)
   ├─ SoundFocusRow                     │  └─ SynthCard
   │     [Focus chips][Solo][Scope]     │        [Scope] + Simple|Pro panel tree
   └─ SynthCard        (bodyless on     ├─ BeatSoundSection depth=…       (drum focus)
        a drum focus, still mounted)    │     toolbar · bus filter · voice card grid
└─ BeatSoundSection   (drum focus)      └─ SoundMixer
└─ SoundMixer
```

Order after the change: Sound header → **synth section OR Beat section** → `SoundMixer`. The two
sections are mutually exclusive on `synthTargetForFocus(focusTrack) === null`, and the synth
section unmounts on a drum focus rather than rendering bodiless. `BeatSoundSection` keeps its own
`SectionCard`: it holds the preset toolbar, the bus filter panel and the voice grid, so it is a
card with a body, not the empty shell the synth card becomes.

Unmounting the synth section already has its consequence handled: `shouldCloseSynthOverlays`
exists precisely because the preset library and quick-save popover are `useState` in a section
that used to survive the focus change. That stays as it is.

---

## 2. Depth is ONE value with two vocabularies

`useSynthViewMode` is renamed `useSoundDepth` and moves out of `synth/synthPresetBrowser.ts` into
its own module. It was never the preset browser's: the browser answers "which preset is this
patch on", and a UI depth flag shares nothing with that question but a file.

The hook is owned as **local state by `SoundView`**, not a slice — the same reason `openVoice` is
local one level down: every tab view and every Pattern segment stays mounted, so a slice write
re-renders all of them. Nothing persists it into the project; its only durability is the
localStorage key below.

The stored value stays `'simple' | 'pro'`. What changes is that its LABELS come from one table
keyed by focus, never from scattered `if`s at the render site:

| focus | shallow | deep |
| --- | --- | --- |
| melodic (lead, fx, chord, bass, pad) | `Simple` | `Pro` |
| drum | `Essential` | `All` |

**Icons do not change with the vocabulary.** `Sliders` for the shallow depth and `Zap` for the
deep one in both columns, deliberately: it is the same stored value and the same switch, so the
same icons say "same control, different context" across a focus change, where a second icon pair
would say a different control had appeared.

**Why the words differ where the value does not.** The synth's Simple/Pro is a real depth split —
two distinct panel trees, a macro deck against raw per-stage parameters, a different preset bar.
Beat's is pure disclosure over ONE parameter model: every knob writes exactly one stored field at
either depth, and `All` shows strictly more of the same knobs. Calling that "Pro" would make one
phrase mean two different things in one app, and would contradict the docblock in
`BeatSoundSection` that says Beat has no second parameter model. Reusing the VALUE carries none
of that risk — a user who chose "deep" on the synth has expressed a preference about detail, and
honouring it on Beat is the point of the shared value.

### localStorage

Read `musibox_sound_depth` first, falling back to `musibox_synth_view_mode`, then
`murva_synth_view_mode`. Write only `musibox_sound_depth`.

This is **not** a migration chain in the sense CLAUDE.md forbids. There is no version gate and no
read-time transform: it is one more rung on the legacy-key adoption ladder this read already
climbs (`murva_` → `musibox_`), and the same ladder `migrate.ts` climbs for the persist key. It
is justified because the value's MEANING widened — it is no longer the synth's view mode, it is
the Sound tab's depth — so keeping the old name would make the key a lie about what it stores.

**The move also fixes a guard defect.** The current read calls `localStorage.getItem` outside any
`try`. CLAUDE.md's rule is "Storage access is always guarded", and its reason is exactly this
case: `localStorage` can THROW (Safari private mode, blocked cookies, embedded webviews), not
merely return null, so the existing `typeof window !== 'undefined' && window.localStorage` test
does not save it. The write is already wrapped; the read was not. `useSoundDepth` takes an
injectable storage parameter and reads it INSIDE the `try`, never in a default-parameter
expression — the pattern `Header.tsx`'s theme helpers already follow, and injectable so a test
can drive a throwing storage without touching the global.

---

## 3. Beat voices become cards in a grid

`BeatVoiceRow.tsx` → `BeatVoiceCard.tsx`. `BeatVoiceList.tsx` → `BeatVoiceGrid.tsx`.

### The card

```
┌────────────────────────────────────────────┐
│ [▶] ● Snare Snap            [+4] [⟳]       │  ModuleHeader: children | right
├────────────────────────────────────────────┤
│ (◎) (◎) (◎) (◎)                            │  KNOB_LANE, wrapping
│ (◎) (◎)                                    │
└────────────────────────────────────────────┘
```

The header is `ui/ModuleHeader` with a **bespoke left cell passed through `children`**, not
`title`: the Preview button must sit beside the voice name, and a 44px tap target inside the
canonical `MODULE_TITLE` span would be a button wedged into a text run. `ModuleHeader` already
supports exactly this — `title` is optional and `children` replaces it when the left cell is not
canonical. `right` carries the `+N` chip and Reset.

**Do not import `ProModule` or `KnobGrid` from `loop/synth/proControls`.** `ProModuleColor` is
`Extract<KnobColor, 'text-module-osc' | …>` — the six synth signal-stage tints — and it excludes
the `text-drum-*` tints every Beat voice uses. Reuse would mean widening a synth-owned type to
admit drum tokens, which couples two features permanently for the sake of a shell that is a card,
a header and a body. Beat writes its own shell over the same primitives `ProModule` composes:
`ui/PanelCard` with `inset` (the recessed compartment idiom, correct here — these cards sit
inside `BeatSoundSection`'s own `SectionCard`) plus `ui/ModuleHeader`. **Rule of three: a THIRD
consumer promotes the shell into `ui/`, the second does not.** Two near-identical shells in two
features is cheaper to read and cheaper to change than one shared component with a type union
widened to serve both.

### The knob lane stays flex-wrap

Keep `KNOB_LANE` exactly as it is; do not switch to a fixed-column grid. Port its docblock's
argument, and note that the argument gets STRONGER inside a narrow card: knob counts per voice
differ by a factor of several — the widest voice carries several times what the narrowest does —
so a fixed column count makes the narrowest voice pay the widest voice's width in a column that
is now a third of the viewport rather than all of it. Flex packs each knob at its fixed `w-14`
footprint and breaks when it runs out, so a card is as tall as its voice needs at every width,
with no breakpoint to keep in step with the schema.

The docblock's other warning ports verbatim: `flex` is not in `KNOB_LANE`, because a lane that
toggles between `flex` and `hidden` with two display utilities on one element resolves by
stylesheet order, not class order.

### The grid

One column, two at `md`, three at `xl`, with `items-start` so a card keeps its natural height
instead of stretching to the tallest sibling in its row — the whole point of the flex lane is
that a short voice is short, and a stretching grid item would hand the saved height back as
whitespace.

Not four at `xl`: the widest voice's lane gets uncomfortable near 300px, where the knob row wraps
into a column tall enough to undo the density the grid bought.

### Depth drives the card body

- `simple` renders the voice's `primary` set only.
- `pro` renders `primary` then `more` **in the same lane** — one continuous wrapping run, not a
  second lane below a divider. At this depth they are one set.

Deleted with the accordion: the `moreOpen` state and the per-card More/Less button, the
`openVoice` state in the list, and `beatVoiceSummary` together with its assertions. The summary
existed as the COLLAPSED row's stand-in for knobs that were off screen — its own docblock says so
— and a card is never collapsed, so the stand-in has nothing to stand in for.

### The `+N` chip

Rendered ONLY at `simple` depth, and ONLY on a voice whose `more` set is non-empty. Today that is
kick, snare, rimshot, ride and bell; the other six voices state every parameter they have at
either depth. Style it with the `ui`-level chip styling consistent with the synth's `ModuleChip`
(a small outline badge) — not by importing `ModuleChip`, which takes a `ProModuleColor`.

What it is FOR: a section-level depth switch that visibly changes only a minority of the cards on
screen reads as broken — the user presses `All`, five of eleven cards change, and the other six
look like they failed. The chip makes the affected cards legible BEFORE the switch is pressed, so
a card WITH a chip is a card with more to show and a card WITHOUT one is complete rather than
silent.

Derive the count from the schema (`BEAT_CONTROL_SCHEMA[voice].more.length`), never from a second
hand-written list — the same discipline `beatVoiceSummary` followed, and the reason a re-sorted
or re-partitioned schema can never leave the chip claiming a number nothing renders.

---

## Files touched

| Path | Change |
| --- | --- |
| `src/components/loop/SoundView.tsx` | renders `ViewHeader`, owns `useSoundDepth`, gates the two sections, passes `depth` |
| `src/components/loop/SoundSynthSection.tsx` | drops `ViewHeader` and `SoundFocusRow`; takes `depth`; the oscilloscope moves into `SynthCard`; focus chips + `SoloButton` move out to `SoundView` |
| `src/components/loop/synth/synthPresetBrowser.ts` | `useSynthViewMode` removed |
| `src/components/loop/useSoundDepth.ts` *(new)* | the depth hook, the focus→vocabulary table, the guarded/injectable storage read |
| `src/components/ui/ViewHeader.tsx` | `viewControls` / `actions` docblocks restated per §1 |
| `src/components/loop/beat/BeatVoiceCard.tsx` *(was `BeatVoiceRow.tsx`)* | card shell, `+N` chip, depth-driven body; `moreOpen` and `beatVoiceSummary` deleted |
| `src/components/loop/beat/BeatVoiceGrid.tsx` *(was `BeatVoiceList.tsx`)* | responsive card grid; `openVoice` deleted |
| `src/components/loop/beat/BeatSoundSection.tsx` | takes `depth`, renders the grid; the NO SIMPLE/PRO docblock stays and gains the vocabulary note |
| `src/components/loop/beat/BeatSoundSection.test.tsx` | substantial rewrite (below) |

Unchanged on purpose: `beatControlSchema.ts` and its test, `beatVoices.ts`, `useBeatParamDraft`,
`BeatFilterPanel`, `BeatPresetToolbar`, everything under `src/audio/` and `src/store/`.

## Accepted trade-offs

**On a phone the eleven cards stack one per row with no accordion, so the Sound tab scrolls
further than it does today.** Accepted, with reasons, as a decision rather than an oversight:

- the default depth is `simple`, so a card's lane is only its `primary` set — a handful of knobs,
  not the whole voice;
- the Sound tab already scrolls past `SoundMixer` at that width, so this lengthens a scroll that
  exists rather than introducing one;
- a mobile-only accordion would be a second interaction model reachable only by viewport, which
  is precisely what the current row's docblock argues against ("a JS-measured breakpoint would be
  a second interaction model, and would render the wrong one for a frame on every mount"). Paying
  the scroll is cheaper than paying that.

**Two card shells exist in the codebase** (`ProModule` and Beat's) until a third consumer appears.
Stated above as the rule of three; the alternative — widening `ProModuleColor` — was considered
and rejected.

## Verification

- `BeatSoundSection.test.tsx` needs substantial rewriting: its current assertions target the
  accordion (one open voice, the toggle's `aria-expanded`, the `lg:hidden` summary) and the
  per-card More disclosure, all of which are gone. New assertions: a card per voice in canonical
  order; `simple` renders only `primary` knob ids; `pro` renders `primary` then `more`; the `+N`
  chip appears only at `simple` and only on voices with a non-empty `more`, with its count read
  off the schema.
- `beatControlSchema.test.ts` needs no change.
- Tests follow `.claude/rules/testing.md`: `renderToString`, and `useLiveStore` (never
  `useAppStore`) for any value a test sets before rendering, because zustand serves
  `getServerSnapshot` the store's creation-time state.
- The depth hook's storage read gets its own test through the injectable storage param, including
  a storage that throws.
- `bun run verify` is the completion gate.

## Open

Nothing. The one question this document carried — where `useSoundDepth.ts` lives — is settled:
`src/components/loop/`, beside `SoundView.tsx`. `SoundView` is its only reader, and a
`loop/sound/` folder holding one file would be a directory standing in for a boundary that is
not there. The same rule the repo already applies to its registries: the code lives where the
code that reads it lives.
