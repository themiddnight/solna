# The FX melody track

Date: 2026-09-10 · Status: design agreed, not yet planned

## Goal

A sixth track, `fx`, that is a **twin of the lead melody track**: the user writes its notes on a
lead-style grid and shapes its synth into an effect voice — a riser, an ambient bed, a filter
sweep. It plays alongside the lead rather than instead of it.

It is named FX and it is deliberately general-purpose. Nothing in the model constrains it to
effect material: a user who wants a counter-melody or a second lead writes one, and the track
behaves identically. The name states the intent the factory content is authored for, not a rule
the code enforces — the same relationship `Pad` already has to its own track, where the pad
layer is a drone by convention and an ordinary sustained voice by construction.

The reason it is a twin and not a new kind of surface: the lead grid is the only surface in the
app where a user places arbitrary pitches at arbitrary lengths, and an effect voice needs exactly
that and nothing more. A dedicated "FX lane" with its own vocabulary (trigger points, one-shot
slots) would be a second grid model to keep honest against meter, step resolution and loop
length — three axes the lead grid already gets right — for a surface that would then be unable to
play a melody.

## Non-goals

- **No new synthesis.** The FX voice is a `SynthParams` patch like every other track's. What
  makes it an effect is the patch, not new engine capability.
- **No FX pattern library, and therefore no sixth dice axis.** See §4.
- **No free-running LFO and no filter-envelope target switch.** Both are deferred to a second
  spec; §5 states precisely what the FX track can and cannot do as a consequence, so nobody
  discovers the limit by building a riser that does not rise.
- **No rename of `lead` to a generic track id.** See Rejected alternatives.

## 1. Data model

**FX is per-loop, exactly as lead is.** Lead state is not at store root — `leadMelodySteps`,
`leadLoopLength`, `leadStepResolution`, `leadMelodyView`, `leadMelodyOctave` and `leadGate` are
all entries in `LOOP_FLAT_KEYS` (`store/loop.ts`), which is what makes a melody travel with the
loop it was written for. FX gets the mirroring set, plus its own voice and mix fields:

```
fxMelodySteps  fxLoopLength  fxStepResolution  fxMelodyView  fxMelodyOctave  fxGate
fxSynthParams  fxVolume  fxMuted
```

Every one of them is added to `LOOP_FLAT_KEYS`. `fxSynthParams` sits with the other three
per-loop patches (`synthParams`, `chordSynthParams`, `bassSynthParams`, `padSynthParams`), and
`fxVolume`/`fxMuted` with the other bus pairs, so a reader comparing the fx block to the pad
block is comparing like with like.

**Adding a key is safe; reshaping one is not.** This repo has no migration chains by policy —
validation replaced them (see CLAUDE.md's "no migration chains" note and
`store/projectFormat.ts`'s header). Under that policy `sanitizePersistedState`/`sanitizeLoops`
fill a **missing** key with its default on every read, regardless of which version wrote the
payload — which is exactly the right behaviour for a project written before FX existed: it opens
with an empty FX track and nothing else changes. A key whose **shape** changed gets no such
grace, because a value that fails validation is replaced by the default and the old content is
gone. That asymmetry is the whole reason the model below is additive.

**`PROJECT_LOOP_KEYS` derives from `LOOP_FLAT_KEYS`**, so FX enters the `.solna` body and the
dirty fingerprint the moment the keys land — no second list to remember. But the tests that pin
those key lists go red, and **that is what the pins are for**: adding a field to a project body
is a decision about what belongs in a saved project, and the pin forces it to be made out loud
rather than inherited from a derivation nobody re-read.

**`PROJECT_DB_LEVEL_KEYS` is the one list that does not derive.** It is a hand-written literal in
`projectFormat.ts`, and its own comment records why that matters: `padVolume` was once quietly
missing from the sanitizer's copy of it and went unvalidated straight into `faderDbToGain`, which
fails safe **to silence** — a corrupt stored value muted the pad bus instead of taking the
default every other bus got. `fxVolume` is a dB fader under the same contract (-60..+12,
unity 0, finite -60 for silence) and must be added to that array by hand, in the same edit as
`LOOP_FLAT_KEYS`. Missing it does not fail loudly; it produces an FX track that is silent for a
reason no meter shows.

**`.solna` `formatVersion` is an additive change.** An older murva reading a newer body sees no
FX track — the keys are simply not in the shape it reads. Per the format's own rule, the version
constant moves only when the content **contract** changes, not for a field addition validation
already defaults. See "Resolved: the murva interop question".

**Code symmetry comes from a table, not a rename.**

```ts
export const MELODY_TRACKS = [
  { id: 'lead', steps: 'leadMelodySteps', loopLength: 'leadLoopLength', … },
  { id: 'fx',   steps: 'fxMelodySteps',   loopLength: 'fxLoopLength',   … },
] as const;
```

The store field names are **table data**, spelled out, not derived from a `${id}MelodySteps`
convention. That is the stated `SOURCE_BUSES` precedent: that table spells all of its field names
out because one row is irregular (`masterSequencerVolume`/`drumMuted`) and encoding the exception
into a template would cost more than writing the regular cases longhand. The same reasoning holds
here the moment a single FX field wants a name that is not `fx` + the lead's suffix, and it holds
pre-emptively — a convention is only worth its brittleness if nothing will ever break it, and
nothing about this codebase's naming history suggests that.

`leadSlice`, the `audio/leadMelody.ts` helpers and the lead hooks take a **track id** instead of
hardcoding lead, and read their fields through the table.

## 2. Audio

**One row added to `SOURCE_BUSES`:**

```ts
{ source: 'fx', volume: 'fxVolume', muted: 'fxMuted', solo: 'fx' }
```

`engineSync.ts`'s snapshot pass and its per-value subscriptions are both driven off that one
table, so both follow from the single edit — which is the property that table was built to have
(a bus added to one and forgotten in the other is silent until the first apply).

**`engine.ts` needs no change.** `getSourceBus` is string-keyed and lazy: the bus is created on
first use, so the FX bus comes into existence with the first FX note and needs no declaration.

**Solo.** `SOLO_TRACKS` and `SOLO_TRACK_LABELS` (`store/trackAudibility.ts`) gain `'fx'`. The
solo set stays a set, solo still beats mute, and `isTrackAudible` is unchanged — it is generic
over the track id already. `soloTrackForControlTarget` keeps its **single** irregularity
(`'synth'` → `'lead'`); the FX control target is called `fx` and the FX solo track is called
`fx`, so it passes through the identity branch. Do not take the opportunity to "regularise"
the lead case: that one mapping is the entire reason the function exists, and a second special
case would be the point at which it stops being readable.

**Control target.** `SynthControlTarget` (`utils/synthControl.ts`) gains `'fx'`, which means
`SYNTH_TARGET_STYLES` needs a complete style row — including a **module colour** — and
`resolveSynthControlChannel`'s channel record gains an `fx` channel. Every string in that table
must stay a literal: Tailwind scans source statically, so a class assembled from
`--color-module-${target}` at runtime is never emitted.

**Mix.** `LoopMixPatch` gains `fxVolume`/`fxMuted`. `components/mixLayers.ts` picks the new keys
up through its mapped `MixVolumeKey`/`MixMuteKey` types automatically, but the **ordered lists do
not derive**: `MIX_LAYER_IDS` gains `'fx'` and `MIX_GROUP_IDS` gains an `'fx'` group, by hand.
FX is **its own mixer group**, not a member of Lead's: the two are independent tracks with
independent faders, and grouping them would say they are one layer with two voices, which is
exactly the claim the group dividers exist to make. `MIX_GROUP_LABELS` is a `Record`, so a group
id added without a label is a compile error rather than a divider reading `undefined` — that part
is already safe.

Comments that state a count go stale in this change and must be updated with it:
`LoopMixPatch`'s "the 10 volume/mute fields", `mixLayers.ts`'s "the ten fields", and
`SOURCE_BUSES`' "all ten names" and `trackAudibility.ts`'s "the five track-solo targets".

**`check:levels` is not affected.** `scripts`' trim table is keyed by preset name and kit name,
never by bus, so a new bus adds no row and invalidates none.

## 3. UI

`PATTERN_SEGMENT_IDS` (`src/types.ts`) becomes `['lead', 'fx', 'accompaniment', 'beat']`, in that
order — FX next to Lead because the two are the same kind of surface, and both before the
accompaniment/rhythm halves, which preserves the existing "pitched first, rhythm after" story the
tabs and the mixer already tell.

`PATTERN_SEGMENTS` in `components/viewMeta.ts` gains a row with an unused Lucide icon (`Waves` or
`Sparkles`). That table is a **LIST, not a `Record<PatternSegment, …>`**, so the compiler cannot
see a missing entry — `SegmentHeader` would throw at render and `PatternView` would show a blank
tab. `viewMeta.test.ts` is what catches it, by comparing the table's ids to
`PATTERN_SEGMENT_IDS` and asserting every icon is distinct. Reusing an icon another view already
wears fails that test, which is why the icon has to be genuinely unused rather than merely
apt.

`PatternView` gains a fourth `block`/`hidden` block rendering the same grid component with
`trackId="fx"`, inside the same padding shell the lead segment borrows.

**The `trackId` prop is REQUIRED, with no default.** A default of `'lead'` would make a call site
that forgot the prop render a second copy of the lead grid — visually plausible, silently wrong,
and caught by no test, because both instances would be internally consistent.

**Two grids means two clock subscriptions, and that is correct.** Playback lives inside
`LeadMelodyGrid` (it mounts `useLeadPlayback` and `useLeadStepPublisher`), which is only sound
because every segment stays mounted — a segment click must not tear down a running player. Two
mounted grids therefore hold two subscriptions, which is exactly what the rule permits: the
shared 16th clock runs **iff a player holds a subscription**, and both of these are players.
Neither starts a timer of its own.

**The step publisher must be keyed per track, and this is the specific thing to verify when
parameterizing.** `components/playbackStep.ts` types its key as a **closed union**,
`StepPlayerId = 'chords' | 'lead' | 'sequencer'`, backed by a `PLAYER_IDS` array. It is not a
free string, so the FX track cannot simply pass a new key: `'fx'` must be added to both, and
`useLeadStepPublisher`'s `publishStepAt('lead', …)` / `resetStep('lead')` must take the track's
id. Miss this and the two grids write the same publisher slot — the FX playhead drives the lead's
marker and vice versa, at whichever grid's stride published last, with no error anywhere.

The same parameterization is needed one layer deeper and is easy to miss because it does not look
like UI state: `useLeadPlayback` reads **`s.leadPlayer`** and calls
`playbackNoteOn`/`playbackStopSource` with the literal engine source `'synth'`. The FX track
needs its own transport player field and its own engine source, both routed through the
`MELODY_TRACKS` table — see the risk list in §5.

**The Sound view's target chip row goes from four chips to five.** That row is the tightest
horizontal space in the app on a phone, and it is the layout most likely to need attention in
implementation; it is called out here so it is designed rather than discovered.

## 4. Vibes

`VibeSpec` gains **`fxPresetId: string`**, required on every vibe. Required, not optional: that
file's rule is that a vibe writes every library id **exactly once and completely**, so a reader
of one vibe literal sees everything that vibe sounds like. (`pad` is optional and stays that way
for the reason its own comment gives — a vibe *chooses* whether to bring a pad — but FX is a
track every loop has, the way lead is, and a vibe that declined to voice it would leave the FX
track on whatever the previous vibe set.)

A **plain string id**, resolved in `store/vibes.ts`, not a resolved object in the data file. That
is what keeps `InstantVibesBar`'s eager import free of a resolver graph: the bar is always
mounted, and a single resolver call in `data/vibes.ts` would pull the library modules into the
eager chunk.

`applyVibeToStore` writes `fxSynthParams` from that preset — through the existing
`resolveVibeSynthParams` path the chord, bass and lead presets already use — and **never writes
`fxMelodySteps`**. A vibe supplies a **voice, never notes**, which is exactly what it already
does for the lead: applying a vibe must never destroy something the user wrote.

**The dice gains no sixth axis.** There is no FX pattern library to roll from, and an axis that
rolls over nothing fails silently — the same reasoning already recorded for why `progressions`
and `drumGrids` use plain `pick` rather than `pickDistinct` (there is no `current` to exclude, and
manufacturing one would fail without saying so).

**Three FX-category presets already exist in the factory library**, so all eight vibes can be
authored against existing content. New FX presets are polish, not a prerequisite for this spec.

`fxVolume`'s default starts at the pad's level — the quietest of the melodic buses, and the right
starting point for a layer that decorates rather than carries — and is tuned by ear once real FX
presets exist.

## 5. Scope and risk

**The riser use case needs no model change.** The lead note-length invariant is *"start + len
never crosses the **loop** end"*, not the bar end — `resizeLeadMelody` enforces it against
`newLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH`, and `setLeadNoteLength` enforces it on
write. At read time `leadAudibleLen` clamps a sounding note to `melodyTicks - startTick`, again
the loop's ticks. A single note spanning the entire loop is therefore already expressible and
already sounds for its full length. Nothing about a riser requires a new "long note" concept.

**The FX module colour is the hardest single decision, but not for the reason first written here.**
This section originally claimed `check:contrast` guards the module palette and that the AA floor
was nearly exhausted. Both are wrong, and the correction is recorded rather than quietly patched
because the wrong version is the kind that survives review by sounding right:
`scripts/check-drum-contrast.ts` brace-matches from `--drum-kick` and iterates `DRUM_TYPES`, so it
reads `--drum-*` pairs and **no `--module-*` token at all**. CLAUDE.md says "drum palette" exactly;
the claim came from misreading it. Adding a module colour trips no existing gate.

Two facts replace it. First, the binding constraint is `index.css`'s own hue rule: the module hues
sit at least 28° apart, and the widest remaining gap leaves a ninth hue at most about 25° from its
neighbours — **the stated rule is no longer satisfiable**, so adding a colour means restating the
rule with its new floor and its reason, not quietly breaking it. A rule the palette visibly
violates teaches the next reader to ignore the rule. Second, and separately: the light theme's
module palette **already sits below 4.5 in more than one place**, unguarded and unnoticed. That is
a pre-existing defect this work uncovered, not one it introduces — it must not be silently
absorbed into this change, and a gate that fails on colours this track never touches is not a gate
this task can adopt. The FX pair gets a scoped check of its own; fixing the existing breaches is
separate work.

**Choose and check the colour first, not last** — that instruction survives the correction intact,
for its own reason: a colour picked to look right beside the existing four and only verified at the
end is a colour that gets re-picked after the UI has been built against it.

**A per-track transport player is part of this work, not a detail of it.** `leadPlayer` is a
transient field on the transport slice, named in `transportSlice.ts`'s `PlayerField` union and in
its player-name map, reset by `loadLoop`, and counted in `engineSync.ts`'s
fully-stopped bitmask — the subscription that decides when `resetClock()` may run, whose whole
correctness argument is *"'fully stopped' means ALL players are 'stopped'"*. An `fxPlayer` must
join that bitmask, or a rewind can fire while the FX track is still playing and restart the grid
under it.

**Tests that will go red and must be updated deliberately:** `viewMeta`, `projectFormat`,
`projectFingerprint`, `initialState`, `loop`, `engineSync`, `trackAudibility`, `soloNav`,
`loopCopy`, `vibes` and its three golden fixtures. Every one of these is a pin over a roster or a
key list; a red one here is the pin doing its job, and each needs a reviewer's judgement rather
than a mechanical re-snapshot.

**Explicitly out of scope, deferred to a second spec:**

- **A free-running LFO.** Today the LFO oscillator is created **per voice** and started at
  note-on, so its phase resets on **every note** — not, as it appears when you play a steady
  pattern, on every bar. A shared free-running LFO is a change to voice construction and belongs
  with its own design.
- **A filter-envelope target switch between cutoff and VCO pitch.** The envelope currently ramps
  `filter.frequency` only. `lfoDepthFor` is the precedent for per-target unit scaling — a depth
  in cents is not a depth in hertz — and that scaling is the substance of the change.

**State plainly, so nobody is surprised:** the FX track as shipped by *this* spec can build a
**filter-sweep riser** but not a **pitch riser**, and its LFO still restarts on each note.

## Rejected alternatives

**Reshaping `leadMelodySteps` into a `Record<TrackId, LeadNote[][]>` map.** This is the change
that looks cleanest and is the most dangerous one available. The repo has no migration chains by
policy; validation replaced them. A stored `leadMelodySteps` that is an array fails validation
against a record shape, and a value that fails validation is **replaced by the default** — so
every stored melody in every saved project blanks, quietly, on the first load after the change.
Adding a key has the opposite property: a missing key takes its default, which is the correct
reading of "this project predates FX". The whole data model in §1 follows from that asymmetry.

**Renaming `lead` to a generic `synthA`.** Considered for the symmetry it would buy and rejected
on three counts. It touches on the order of 139 files. It breaks the persisted key
(`leadMelodySteps` and its siblings), which under the no-migration-chains policy means the same
silent blanking as above. And it breaks the murva-facing `.solna` contract, whose key names are
an external interface. All of that to trade a name that carries musical meaning — a *lead* is a
thing a musician recognises — for one that carries none. The table in §1 gets the code symmetry
without any of those costs.

**A dedicated FX lane with its own trigger model.** Rejected in the Goal section: it would be a
second grid model to keep honest against meter, step resolution and loop length, and it would be
unable to play a melody — which forecloses the counter-melody use the general-purpose framing
exists to allow.

**A sixth dice axis over an FX pattern pool.** Rejected in §4: there is no pool, and an axis over
an empty pool fails silently.

**Putting FX in the Lead mixer group.** Rejected in §2: the group dividers say "these are one
layer", which is not true of two independent tracks with independent faders.

## Resolved: the murva interop question

**Asked:** does the murva side accept the `.solna` body's FX keys as an additive change with no
`formatVersion` move?

**Answered, 2026-09-10: yes — murva has implemented nothing against this format yet, so there is
no reader to break.** `PROJECT_FORMAT_VERSION` does not move for this work.

Recorded rather than deleted because the *reasoning* outlives the answer, and the precondition it
rests on is the thing that can expire. `PROJECT_FORMAT_VERSION` moves when the content **contract**
changes, not when a field is added that validation already defaults: an older reader seeing a newer
body simply does not see the FX keys, and a newer solna reading an older body defaults them to an
empty track, so neither direction loses data. That argument was always sound on its own; what was
missing was whether a real reader on the other side **ignores** unknown loop keys or **rejects** a
body carrying them.

Today there is no such reader, which is why this is not a decision anyone has to live with yet. The
moment murva does implement a reader, that question becomes live again for the *next* additive
field — and the answer then depends on murva's behaviour, not on this document. This is the same
shape as the "no migration chains" precondition in `CLAUDE.md`: a decision that is correct because
of a fact about the world right now, and that must be revisited when the fact changes rather than
inherited as a rule.
