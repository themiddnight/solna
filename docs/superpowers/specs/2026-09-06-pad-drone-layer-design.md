# Pad / Drone Layer — Design

Date: 2026-09-06
Status: Approved (brainstormed and signed off before writing)

## Context

Solna has three generative layers today: the lead melody, the chord/bass pair, and the drum
sequencer. Two of those — chord comp and bass — already follow the progression, and both are
built the same way: a slice of plain state, a full `SynthParams` voice, a pattern library, and a
per-step emitter driven by the Chords player.

What is missing is the layer underneath: the sustained one. Every genre the Instant Vibes cover
uses it, and the app cannot make it. Synthwave's standard chord treatment is a two-layer stack —
a slow-attack pad holding the harmony while a faster patch pokes the transient through — and
solna can only produce the second half. Ambient and the Zen Garden vibe want the other shape
entirely: one pitch, or one interval, held under the whole loop while the progression moves over
it.

This adds a fourth layer, `pad`, that does both. It lives in the Chords tab because it is
chord-aware, it rides the Chords player because it has no independent sense of time, and it has
two modes:

- **pad** — plays the current chord, legato, re-struck on each chord change.
- **drone** — plays a fixed scale degree and a chosen set of intervals, held for one loop pass,
  ignoring the progression entirely.

It is a full synth layer, not a fixed voice: `padSynthParams` is a complete `SynthParams`, the
same as `bassSynthParams`, so the pad can be reconfigured into a string bed, a sub drone or a
choir without the design changing.

## Terminology

- **pad mode / drone mode** — the two values of `padMode`. Unqualified "pad" means the layer.
- **degree** — an index into the active scale's degrees, not a roman numeral. Stored as a number.
- **interval** — one of `1 | 4 | 5 | 8 | 12`, counted from the chosen degree's root.
- **voicing** — how a chord is reduced for pad mode: `triad`, `open5` or `root`.
- **loop pass** — one traversal of the progression, from the first chord back to the first chord.

## Scope

In scope: the pad layer's state, playback, UI on three surfaces, per-vibe data, and both
migration chains.

Not in scope, stated so the boundary is explicit:

- **No rhythm patterns for the pad.** The chord and bass layers each carry a pattern library; the
  pad has none. Legato is the only articulation. A pad that could hit on the offbeat is a second
  chord comp, and the app already has one.
- **No arpeggiator on the pad.** `chordSynthParams.arpActive` and `bassSynthParams.arpActive`
  branch the emitter; `padSynthParams` does not. The pad is defined as the layer that sustains.
- **The dice does not roll the pad.** `vibeVariation.ts` decorates drum rows and the lead's arp.
  Rolling a drone degree would change the pitch you hear at random, which is not what that button
  promises. If it is wanted later it is its own issue.
- **Voice leading is not implemented.** A chord change in pad mode re-strikes the whole voicing;
  the outgoing chord's release tail overlaps the incoming attack, and that overlap is the legato.
  True common-tone holding is a different feature with a different cost, and the envelope gets
  close enough that it has not been missed.

## Playback: pad and drone are one code path

The two modes differ in exactly two dimensions:

| | notes | hold |
|---|---|---|
| pad | current chord at `padOctave`, reduced by `padVoicing` | `chord.bars × barDur` |
| drone | fixed degree's root, transposed by each selected interval | `loopBars × barDur` |

Both are "strike every note together, release them together" — which is precisely
`playFullHoldChord` (`src/audio/playback/chordPlayback.ts:214`), the function the sustained chord
rhythm already uses.

**`ChordPlan` and `emitChordPlanStep` are not touched.** This is the load-bearing consequence of
having no pattern: with no pattern there is no per-step emission, so the pad never produces a
`BarInvariantEvent` and never needs a step to hang one on. One arm is one note-on/note-off pair.
Adding a `padEvents` field to `ChordPlan` would be carrying an always-empty array through the
hot path — `emitChordPlanStep` runs on every 16th for the life of the session — to express
nothing.

### The single hook point

`useChordPlayback.ts:624` already opens the branch that arms a chord, and `:632` already computes
the index the arm needs:

```ts
if (action === 'play') {
  const liveChords = useAppStore.getState().chords;
  const index = arming.chordIndex % liveChords.length;   // existing
  const chord = liveChords[index];
  planRef.current = startChordPlan(chord, step, time);
  armPad(chord, index === 0, time);                      // added
  ...
}
```

`index === 0` is the top of a loop pass. No "loop boundary" concept is introduced; the value is
already on the line above. In drone mode `armPad` returns immediately unless it is the top of a
pass; in pad mode it arms on every chord.

`armPad` is deliberately called from here rather than folded into `startChordPlan`.
`startChordPlan` (`:219`) has no access to `arming.chordIndex` and would need a flag threaded in,
at which point it stops being the function that builds the chord/bass plan and becomes the
function that arms three voices with two different lifetimes.

### The new module

`src/audio/playback/padPlayback.ts` — pure, importing neither the store nor React, so every rule
in it is testable without rendering:

```ts
resolveDroneNotes(degree, intervals, octave, scaleRoot, scaleType): string[]
applyPadVoicing(chordNotes, voicing): string[]
padHoldSec(mode, chordBars, loopBars, barDur): number
```

`resolveDroneNotes` takes the degree's root through `getDiatonicChordForDegree`
(`src/utils/musicTheory.ts:202`) and transposes it with `tonal`, using interval notation as the
music-theory skill requires — never by editing the octave digit in the note name:

```ts
const INTERVAL: Record<PadInterval, string> = {
  1: '1P', 4: '4P', 5: '5P', 8: '8P', 12: '12P',
};
```

`12P` is a perfect twelfth — an octave plus a fifth, 19 semitones. It is one interval name, not
an octave shift composed with a fifth.

`applyPadVoicing` needs the same fallback discipline `resolveBassSteps` uses for its chord-tone
tokens: `open5` wants `notes[2]`, but a pentatonic or Hirajoshi triad can be shorter than three
notes, so it falls back `notes[2] → notes[1] → notes[0]`. `root` takes `notes[0]`; `triad`
returns the notes unchanged.

`padHoldSec` does NOT call `fullHoldDuration` or apply its `chordFeel`-derived `holdScale`: the pad
case returns `Math.max(1, bars) * barDur` outright. That divergence is deliberate — a legato pad
must not be shortened by the comp's feel setting the way a chord voicing is — not an oversight to
reconcile with `fullHoldDuration`. The drone case uses the loop's own length —
`loopBars(chords)` in `src/store/loop.ts:47`.

### `playFullHoldChord` gains a `source` parameter

It currently hardcodes `"chord"` at `chordPlayback.ts:226` and `:232`. The pad needs the same
function against the `'pad'` bus, so the source becomes a parameter and the two existing call
sites pass `"chord"`. Copying the function to make `playFullHoldPad` would leave two bodies that
must be kept in step for no reason.

### Drone's out-of-scale fifth on the leading tone is intended

`resolveDroneNotes` transposes by a *fixed* interval from the degree's root; it does not read the
diatonic chord's quality. In C major, degree vii gives B, and `5P` above B is F# — outside the
key.

This is the correct behaviour and must not be "fixed". A drone's identity is the perfect fifth:
the tanpura is tuned to the tonic and the fifth, and it is that interval's overtone series that
makes a drone read as a drone rather than as a held chord. Deriving the fifth from the diatonic
chord instead would give a tritone on vii°, which is a dissonance held for an entire loop pass —
strictly worse than a note outside the scale. Snapping the fifth back into the scale would give
the same tritone while lying about it in the label.

Degree vii is also the only degree where this arises, and a user who selects it has selected it
deliberately. Pin the behaviour with a test so a later reader does not mistake it for a bug.

### Stop handling

`'pad'` joins the two existing stop paths: the hard stop beside
`playbackStopSource('bass', HARD_STOP_RELEASE)` at `useChordPlayback.ts:586`, and the soft stop
beside `playbackStopSource('bass', releasesRef.current.bass, time)` at `:618`. `releasesRef`
gains a `pad` entry so the soft stop uses the live release value rather than one captured when
the subscription was created.

The comment at `:549` — *"Cut BOTH sources: the Chords player drives the bass line, so silencing
'chord' alone would leave the bass droning"* — must be updated to three sources. The word becomes
literal.

**The long scheduled note-off is not a new risk.** A drone schedules its note-off a full loop
pass ahead, and a soft stop mid-pass cuts the voice while that note-off is still queued on the
audio clock. `playFullHoldChord` already does exactly this for a multi-bar sustained chord, and
the soft-stop path already handles it. The drone only makes the interval longer.

**All five transitions that can replace what is sounding, not only the two transport stop
paths above:**

1. The transport hard stop (`useChordPlayback.ts:586`) — cuts `'pad'` beside `'chord'`/`'bass'`/`'synth'` to `HARD_STOP_RELEASE`.
2. The transport soft stop (`useChordPlayback.ts:618`) — cuts `'pad'` at its own live release value via `releasesRef.current.pad`.
3. The Instant Vibe swap (`applyInstantVibeToStore` in `instantVibes.ts`) and `loadLoop`'s default (non-boundary) path both cut `'pad'` to `LOAD_LOOP_RELEASE`/`VIBE_SWAP_RELEASE` unconditionally, the same as `'chord'`/`'bass'` — a state-only swap would otherwise leave the outgoing pad or drone ringing over the incoming loop or vibe.
4. `projectSlice.install` (New / Open / Import) — the same unconditional `stopSource('pad', INSTALL_RELEASE)` cut, for the same reason: it replaces the whole session, so nothing should ring across it.
5. **`loadLoop`'s seamless `atBoundary` path (a song-mode advance)** — the one path that does NOT do an unconditional cut, because nothing here is a Stop and the whole point is for voices to ring across the seam with the envelopes their presets asked for. `'pad'` joins `dropVoicesScheduledFrom`'s source list like the other three buses, so a pad note-on arming AT the boundary is dropped rather than sounding over the incoming loop. But a drone's `startTime` is the start of its pass, strictly BEFORE the boundary, so `dropVoicesScheduledFrom` never touches it — left alone it would ring until its own note-off, up to a full pass, while the incoming loop's `armPad` strikes a second drone on top in a different key. So this path makes one deliberate exception to its own "nothing gets cut" rule: it calls `stopSource('pad', LOAD_LOOP_RELEASE)`, but ONLY when the outgoing loop was in drone mode. A drone's length is set by the loop pass rather than by its preset's envelope, so it falls outside the "ring with the envelope the preset asked for" premise the seamless path is built on; a pad-mode tail does not, and stays uncut.

### Engine and engineSync

No engine change at all. Per-source buses are keyed by string in a `Map`
(`src/audio/engine.ts:193`), so `'pad'` needs no registration. The pad is polyphonic by default;
only `'bass'` is forced monophonic, by the `killPreviousBassVoice` call at `engine.ts:829`.

`engineSync.ts` gains two lines in `applyEngineSnapshot` beside `:71` and two subscriptions
beside `:122`, mirroring bass exactly. `padSynthParams` is deliberately **not** synced: like
`chordSynthParams` and `bassSynthParams` it is read live from the store at arm time, which is
what makes a timbre knob audible on the next chord instead of only on the next play.

## State: eight keys, per loop, all required

The pad is per-loop state, like every other layer. All eight keys go into `LOOP_FLAT_KEYS`
(`src/store/loop.ts:4`):

| key | type | default |
|---|---|---|
| `padSynthParams` | `SynthParams` | `factory-warm-polypad` — the most neutral of the five Pad-category presets |
| `padMode` | `'pad' \| 'drone'` | `'pad'` |
| `padOctave` | `number` | `3` |
| `padVoicing` | `'triad' \| 'open5' \| 'root'` | `'triad'` |
| `padDroneDegree` | `number` | `0` |
| `padDroneIntervals` | `PadInterval[]` | `[1, 5, 8]` |
| `padVolume` | `number` | `1.0` |
| `padMuted` | `boolean` | `false` |

`LoopMixPatch` (`src/store/types.ts:353`) gains `padVolume` and `padMuted`. Its doc comment says
"the 8 volume/mute fields edited on each Arrange card" — that comment is the type's specification
and must be corrected to ten, not left to drift.

### Why the keys are required and not optional

`loopStatePatch` (`src/store/loop.ts:87`) writes every key in `LOOP_FLAT_KEYS` unconditionally:

```ts
for (const key of LOOP_FLAT_KEYS) {
  out[key] = src[key];      // no guard, no ??
}
```

and persist `merge` spreads that patch **last**, over everything else (`src/store/store.ts:353`):

```ts
return { ...withPresets, loops, activeLoopId: active.id, ...loopStatePatch(active) };
```

So a loop object missing `padMuted` does not fall back to the slice default — it writes
`padMuted: undefined` over the default, and that value reaches `engineSync` and the UI. Optional
pad keys would fail silently rather than degrade. Requiring the keys, and backfilling them in
both migration chains, is what makes the type honest about what `loopStatePatch` guarantees.

### `PROJECT_CONTENT_KEYS` is not touched

```ts
// src/store/projectFormat.ts:42
export const PROJECT_CONTENT_KEYS = ['bpm', 'meterId', 'masterVolume', 'effects', 'loops'] as const;
```

Per-loop state reaches a `.solna` body inside `loops`, and `loopSync.ts:36` mirrors every
`LOOP_FLAT_KEYS` key back into the active loop on each `set()`. Adding the eight keys to
`LOOP_FLAT_KEYS` is therefore the whole of the work: saving writes them, and `projectDirty`
fingerprints them, with no further wiring. The drift guard in `projectDirty.test.ts` covers the
content-key tuple and is unaffected.

### `padDroneIntervals` is normalised on write

Sanitize filters to members of the union, de-duplicates, and **sorts ascending**. The sort is not
cosmetic: `projectDirty` fingerprints the content set, so `[5, 1]` and `[1, 5]` — the same
selection — would produce different fingerprints and raise an unsaved-changes badge that no edit
caused.

An empty array is legal and means a silent drone. No guard prevents unchecking the last interval:
the result is self-explanatory, and a "you may not uncheck this one" rule is a special case that
buys nothing.

## Migration: two chains, two defaults

**Persist** — bump the persist `version` by one and append a matching step to the bottom of the
chain in `store.ts:287`. That file's comment states the rule the step must follow: one step per
version, in version order, reading order is run order, and a new version is one more line at the
bottom.

```ts
// previous version → new version (pad/drone layer)
if (version < NEW_VERSION) next = migratePadLayer(next) as PersistedState;
```

`migratePadLayer` lives in `migrate.ts` beside `migrateLeadStepResolution` (`:309`) and uses the
same module-private `mapLoops` helper (`migrate.ts:227`) — it must live in that file to reach it:

```ts
mapLoops(state, (row) => ({ ...row, ...DEFAULT_PAD_STATE, padMuted: true }))
```

**It must map every loop, not only the active one.** A payload with four loops that backfills one
of them leaves three that write `undefined` through `loopStatePatch` the moment the user switches
to them.

**Project body** — bump `PROJECT_FORMAT_VERSION` (`projectFormat.ts:16`) and append one step to
`migrateProjectBody` (`projectFormatMigrate.ts:108`), which runs *before* `sanitizeContent`, as
that file's comment requires.

### The two chains stay separate

They share `DEFAULT_PAD_STATE`, which is data, and nothing else. A persist payload is private
`localStorage` shape; a project body is an external contract that a user can carry between
machines. Their versions move for different reasons and at different times — a future
`localStorage` reshape must not force a `.solna` format bump, and a format change must not be
readable through the persist chain. This is the trap CLAUDE.md already records for the lead
melody's two chains, and it applies here for the same reason.

### The two defaults must not be collapsed

```ts
DEFAULT_PAD_STATE                          // padMuted: false — new projects, factory content
{ ...DEFAULT_PAD_STATE, padMuted: true }   // both migrations
```

A new project gets an audible pad, because that is the point of shipping the layer. A project
saved before the pad existed gets a silent one, because its author never wrote a pad and a
reopened project must sound the way it sounded when it was closed.

If a later reader collapses these into one constant, every pre-existing project gains a voice, no
test goes red on its own, and the change is inaudible in review. Three tests pin it — see
Testing.

## UI

### Chords tab — the Pad module card

`src/components/loop/chord/PadModulePanel.tsx`, rendered after `<BassModulePanel>`
(`ChordView.tsx:898`), structured like `BassModulePanel`:
`card bg-panel tint-pad border border-module-pad/30 p-4`.

```
● PAD / DRONE                        [ Pad │ Drone ]
Preset  [ Warm PolyPad ▾ ]                AdjustSynth →

── pad mode ────────────────────────────────────────
Octave   [2] [3] [4]
Voicing  [Triad] [Open 5th] [Root]

── drone mode ──────────────────────────────────────
Degree   [I] [ii] [iii] [IV] [V] [vi] [vii°]
Interval [1] [4] [5] [8] [12]

────────────────────────────────────────────────────
🔊 ━━━━●━━ vol
```

The two middle blocks **swap** with the mode; they are not both shown with one disabled.
`padVoicing` is dormant in drone mode and `padDroneDegree` / `padDroneIntervals` are dormant in
pad mode — persisted, but unread. Showing a dormant control greyed out invites the user to work
out why it does nothing.

A third `PowerToggle` joins the two in `ViewHeader` (`ChordView.tsx:565`, `:572`) with
`id="btn-mute-pad"` and `tone="module-pad"`, following `on={!padMuted}` like its neighbours.

The fader is a `ChannelStrip` with `max={1.5}`, the ceiling chord and bass already use. That prop
is required rather than defaulted by deliberate design — its doc comment explains that a default
would hand whichever value it picked to the next caller by silence — so `1.5` is a decision the
pad makes for itself, not one it inherits.

**The degree row is rendered from the scale's own length**, looping
`SCALES[scaleType].intervals.length` and labelling each button from
`getDiatonicChordForDegree(i, scaleRoot, scaleType, false).degreeName`, which already lower-cases
minor and diminished numerals. Hirajoshi renders five buttons, not seven. Hardcoding seven is the
mistake `SCALES` is shaped to prevent.

**When the scale shrinks, the UI highlights `padDroneDegree % length` and the stored value is
left alone.** Selecting degree 6 in Major and switching to Hirajoshi makes the resolver wrap to
degree 1, and the highlight follows it, so what is shown is always what is heard. Clamping the
stored value instead would destroy a setting merely because the user looked at another scale, and
switching back would not restore it.

### Synth tab — a fourth target

- `SynthControlTarget` (`src/utils/synthControl.ts:3`) gains `'pad'`.
- `SYNTH_TARGET_STYLES` (`:14`) is a `Record<SynthControlTarget, …>`, so TypeScript requires the
  new entry rather than allowing a silent gap.
- `resolveSynthControlChannel`'s `channels` parameter gains `pad`.
- `SynthView.tsx:92` `activeTargetVolumeConfig` gains a case; `:62` `resolveTargetBorderClass`
  gains a branch.
- The preset-library target badge follows from `SYNTH_TARGET_STYLES` with no further change.

### Arrange — a fifth mix row

`SortableLoopCard.tsx` gains a `MixRow` after the bass row (`:579`), reading `loop.padVolume` /
`loop.padMuted` and writing through `onSetMix`. `LoopMixPatch` is already widened above, so this
is markup only.

### Theme — a third module hue

Module hues are spaced around the wheel: osc 87°, chord 125°, env-vca 162°, lfo 213°, bass 256°,
env-vcf 294°, arp 322°, filter 356°. The only gap is 356° → 87°, and the pad takes **amber ≈ 40°**,
which sits near its midpoint.

Four `Record<Union, …>` sites must gain an entry, and once the unions are widened TypeScript
finds all four:

| file | addition |
|---|---|
| `src/index.css` | `--color-module-pad(-content)` in `@theme` beside `:145`; `--module-pad`, `--module-pad-content`, `--module-pad-tint` in **both** theme blocks (`:173` dark, `:217` light); `@utility tint-pad` beside `:306` |
| `src/components/ui/Knob.tsx:21` | `KNOB_COLORS` gains `'text-module-pad'` |
| `src/components/ui/PowerToggle.tsx:13` | `POWER_TOGGLE_TONES` gains `'module-pad'`, plus its `TONE_CLASS` entry |
| `src/utils/synthControl.ts:14` | `SYNTH_TARGET_STYLES.pad` |

`TONE_CLASS` entries must be complete literal strings. The file's own comment explains why:
Tailwind v4 scans source statically, so an interpolated class name emits no CSS at all.

The dark-theme value is unconstrained — module colours sit near L 0.75 and the canvas gradient
stops are all near L 0.1, so any amber separates. **The light theme is where the value must
actually be checked**: module colours darken there (chord `#A9C96D` → `#6D8F45`), and a darkened
amber can collide with daisyUI's `warning` role. Choosing the pair of hex values is an
implementation step with a visual check, not a number copied from this document. `check:theme`
will not catch a collision — it scans for raw hex and palette classes in source, not for
readability.

## Instant Vibes

`InstantVibe` gains one **optional** object:

```ts
pad?: {
  volume: number;
  presetId: string;        // must resolve to a Pad-category preset
  mode: 'pad' | 'drone';
  octave: number;
  voicing: PadVoicing;
  droneDegree: number;
  droneIntervals: readonly PadInterval[];
};
```

Optional here and required on `Loop`, and the asymmetry is deliberate: a vibe *chooses* whether
to bring a pad, while a loop *always has* pad state. Absence carries the enabled/disabled meaning
with no extra boolean.

`PadInterval` and `PadVoicing` are literal unions declared in `src/types.ts`, which imports
nothing and must keep importing nothing.

### `applyInstantVibeToStore`

Three changes, in the order the function already establishes:

**1. Resolve before mutating** (`instantVibes.ts:42`). The existing comment explains why all
preset ids are resolved up front: `resolveVibeSynthParams` throws on an unknown id, and throwing
mid-swap would leave the store holding half of each vibe.

```ts
const finalPadSynthParams = vibe.pad ? resolveVibeSynthParams(vibe.pad.presetId) : null;
```

**2. Cut the pad bus during the swap** (beside `instantVibes.ts:68`):

```ts
audioEngine.stopSource('pad', VIBE_SWAP_RELEASE);
```

This is the sharpest edge in the vibe work. The comment above those lines records that the whole
swap runs inside one `onClick`, React batches it, the rendered player state goes
`'playing' → 'playing'`, and no effect keyed on it ever runs — so the sources must be cut here,
synchronously. The drone holds the longest note in the application; omitting this line leaves the
outgoing vibe's drone singing over the incoming one for a full loop pass.

**3. Apply.** With `vibe.pad` present, write every field and set `padMuted: false`. With it
absent, set `padMuted: true` and **leave the remaining pad fields untouched**. Muting is
reversible and resetting is not: switching Boom Bap → Synthwave → Boom Bap must not erase pad
settings the user tuned by hand.

### Per-vibe data

| vibe | mode | preset | octave | voicing | degree / intervals | volume |
|---|---|---|---|---|---|---|
| `lofi-chill` | pad | `factory-warm-polypad` | 3 | `open5` | — | 0.30 |
| `synthwave-80s` | pad | `factory-string-ensemble` | 3 | `triad` | — | 0.65 |
| `cyber-dance` | pad | `factory-neon-poly-saw` | 3 | `triad` | — | 0.50 |
| `ambient-chill` | drone | `factory-dark-sub-pad` | 2 | — | 0 / `[1,5,8]` | 0.55 |
| `hiphop-groove` | *(no `pad`)* | — | — | — | — | — |
| `asian-zen` | drone | `factory-warm-polypad` | 2 | — | 0 / `[1,5,8]` | 0.40 |
| `lofi-waltz` | pad | `factory-warm-polypad` | 3 | `open5` | — | 0.30 |
| `afro-six-eight` | *(no `pad`)* | — | — | — | — | — |

The two lo-fi entries sit low on purpose: in lo-fi production the pad is glue rather than a
foreground voice, and a pad mixed forward turns the genre into something else.
`synthwave-80s` and `cyber-dance` already carry short comp voices — `factory-neon-poly-saw` and
`factory-trance-pluck` — so the pad supplies the sustained half of the two-layer stack the genre
is built on. `ambient-chill` and `asian-zen` take the drone: the first because a pedal tone under
a Lydian progression is the genre's defining gesture, the second because the sustained shō of
gagaku is a direct ancestor of drone music and the closest thing the Zen Garden vibe has to an
authentic instrument.

**`afro-six-eight` ships no pad**, for three reasons that reinforce each other. Its identity is
the compound bell cell — two dotted-quarter beats — and a voicing held across the bar smears
exactly the accent pattern the vibe is named for. It uses the `boombap-dry-room` effect chain, a
deliberately dry space with no wash for a pad to sit in. And its `variation.genre` is `'boombap'`,
the same pool `hiphop-groove` draws from: giving one sibling a pad and not the other would make a
reroll between them change the instrumentation, which the dice does not otherwise do.

Two of eight vibes shipping no `pad` key is the point of the optional shape — it is a genuine
choice, not a field every entry must fill.

## Testing

Conventions are `bun:test`, no DOM, no testing-library. The pure-logic style is preferred and
most of this feature is already shaped for it.

### Pure logic — `padPlayback.test.ts`

- `resolveDroneNotes` wraps the degree on a five-degree scale (Hirajoshi).
- `12P` is 19 semitones — assert on the MIDI difference, not on the spelled note name.
- Degree vii in a major key yields a fifth outside the scale. **Pin this**; it is the behaviour
  the "Out-of-scale fifth" section above explains, and an unpinned intentional oddity gets
  "fixed".
- An empty interval set yields no notes.
- `applyPadVoicing` falls back correctly when the chord has fewer than three notes.
- `padHoldSec` returns chord length in pad mode and loop length in drone mode.

### The trap tests

These are the ones that earn their place, because each pins a failure that is silent.

1. **Two defaults, three tests.** A pre-pad persist payload hydrates with `padMuted === true`; a
   project body at the previous format version opens with `padMuted === true`;
   `factoryProjectContent()` has `padMuted === false`. Collapsing the constants turns exactly one
   of these red.
2. **Every loop is backfilled.** A multi-loop payload, migrated, has no `undefined` pad key on
   any loop — not just on the active one.
3. **Interval order does not dirty the session.** The same selection entered in two orders
   produces one fingerprint. Assert on the fingerprint, since the fingerprint is the bug.
4. **The vibe swap cuts the pad bus.** `instantVibes.test.ts` already spies on
   `audioEngine.stopSource` and asserts which sources were silenced; extend that assertion to
   include `'pad'`.
5. **Editing a pad control marks the project dirty.** Proves the `LOOP_FLAT_KEYS` →
   `loopSync` → `loops` → fingerprint path is connected end to end.

### Vibe data invariants

Mirror the existing per-vibe preset checks — `instantVibes.test.ts:126` pins that every
`bassPresetId` resolves to a Bass-category preset. Add: every `pad.presetId` resolves to a
Pad-category preset, and every vibe that ships a `pad` has a non-empty `droneIntervals`. An empty
set is legal at runtime but is a data bug in authored content: it ships a layer that cannot make
a sound.

### `PadModulePanel` exports its decisions

The zustand + `renderToString` trap makes a rendered test of mode switching worse than useless:
`getServerSnapshot` returns creation-time state, so `useAppStore.setState({ padMode: 'drone' })`
before a render has no effect and the assertion silently checks the wrong mode. Nothing in
`bun run verify` catches it.

So the panel must export the pure decisions it makes — which control block a mode shows, which
degree index is highlighted for a given scale length — and the tests import those functions.
Rendered assertions stay limited to the class-string checks the repo already uses for structure.

### Mutation check

For each trap test, revert the guard it protects and confirm the test fails. A test that passes
against the bug it was written for is the failure mode this list exists to avoid.

## Cost

Roughly: one new pure module (~60 lines), one new component, ~35 lines added to
`useChordPlayback.ts`, one parameter added to `playFullHoldChord`, four lines in `engineSync.ts`,
eight keys through `LOOP_FLAT_KEYS` and both migration chains, four theme-record entries, and
six vibes' worth of data.

The engine is untouched. `emitChordPlanStep`, `ChordPlan` and `PROJECT_CONTENT_KEYS` are
untouched.
