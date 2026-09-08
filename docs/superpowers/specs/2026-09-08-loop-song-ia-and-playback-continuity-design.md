# Loop / Song IA, one transport, track solo, and playback continuity

Date: 2026-09-08 · Status: design agreed, not yet planned

Four changes that only make sense together. The navigation restructure is what a new user
sees; the other three are what makes the restructured app coherent once they start pressing
things.

## Why

Two problems a first-time user hits today, both visible in the code that serves them:

- **`Synth/Lead` holds two unrelated jobs** — editing a patch, and writing a melody.
  `Header.tsx`'s `AUTOMATION_TABS` needs a comment to explain the pairing ("the synth page
  edits the synth patch but plays the lead melody"). A tab whose grouping needs a comment is
  a tab whose grouping is not obvious.
- **Faders live in three places and nowhere shows the loop's balance.** `LoopMixPatch` already
  carries all five volume/mute pairs per loop, but the only screen that renders them is the
  Arrange card.

And one problem for anyone past the first hour: **Loop-layer and Song-layer playback are
severed.** `songMode.ts`'s `reconcile()` hard-stops every player on a layer change, so
auditioning a loop on Arrange and then opening it to edit means pressing play again, always.

## 1. The taxonomy, written once

**Lead · Accompaniment · Beat**, over five tracks: `lead`, `chord`, `bass`, `pad`, `drums`.
Accompaniment is the group of three: chord, bass, pad.

Those five are not new. They are exactly the five volume/mute pairs `LoopMixPatch`
(`store/types.ts`) already stores per loop. Every count in this document — five faders, five
mutes, five solos — is that same set, and the design's rule is that nothing may introduce a
sixth grouping of the same layers.

The name has precedent: `viewMeta.ts` already renamed `Chords/Bass` to `Accompany` when the
pad layer landed, for exactly this reason ("names the job all three do rather than listing
them"). This design extends that decision rather than making a new one.

## 2. Navigation

```
Loop
  Sound     synth engine (target: lead / chord / bass / pad), preset library, mixer (5 tracks)
  Pattern   segments: Lead | Accompaniment | Beat
Song
  Arrange   loop arrangement
  Master    master FX + meters
```

**The boundary rule, in the words a reviewer can apply:** *changes the sound but not the notes
→ Sound; changes the notes or the rhythm → Pattern.* So chord rhythm, bass pattern, drum grid
and kit are Pattern; oscillator, filter, envelopes, LFO, arpeggiator and the faders are Sound.

Chord progression and the chord/bass/pad pattern settings stay on the same screen
(Pattern › Accompaniment). They are edited together, and splitting them across tabs — which an
earlier draft of this restructure did — is the single change that would make the new layout
worse than the old one.

`Arrange` now means one thing only: ordering loops. Nothing else may take that name.

**Shell layout** — unchanged from today's, only its contents move:

```
[● solna][Loop|Song] --- [Sound][Pattern] --- [Loop A ▾][C Major ▾][theme]
[vibes bar]
[Lead][Accompaniment][Beat]          ← only on Pattern
...view...
[transport bar]
```

**Types.** `ViewMode` becomes `'sound' | 'pattern' | 'arrange' | 'master'`, with the Pattern
segment as its own ui-slice field (`patternSegment: 'lead' | 'accompaniment' | 'beat'`).
`activeTab` is **not** in `partializeAppState`, so this rename needs no sanitize path and no
persist version move. `VIEW_META` / `VIEW_ORDER` and `Header.tsx`'s `AUTOMATION_TABS` /
`SONG_NAV_TABS` follow; `AUTOMATION_TABS`'s `module` field goes away entirely (see §5).

## 3. The Accompaniment group frame

A neutral frame (1px border) with a small `ACCOMPANIMENT` label, in three places:

- **Sound** — the target chips read `[Lead]` then the frame around `[Chord][Bass][Pad]`.
- **Mixer** — `Lead`, then the frame around the chord / bass / pad strips, then `Drums`.
- **Pattern › Accompaniment** — the card is already named for the group, so it carries the
  frame without a second label; the label there would duplicate the card title.

**The frame is neutral and never recolors its contents.** `index.css` spaces the module hues
around the OKLCH wheel deliberately and records that chord (125°), bass (256°) and pad (40°,
the one recorded exception in the amber band) must stay separable. A group tint would undo
that. The frame groups by enclosure; the dots keep saying which is which.

This is presentation only. `controlTarget`'s persisted values
(`'synth' | 'chord' | 'bass' | 'pad'`) do not change.

## 4. Track solo — session state, placed where you edit

**Solo is a monitoring gesture, not arrangement intent.** Mute is the opposite, which is why
mute stays per loop in `LoopMixPatch` and solo is never written there.

**This is deliberately not the DAW convention, and the deviation is the feature.** In a normal
DAW a latched solo is an ordinary working state that survives everything. Here, the
arrangement — including "the drums drop out in the chorus" — is expressed entirely with mute,
which is per loop and persisted; solo exists only to hear something for a moment while editing
it. That is why it clears on navigation instead of persisting: a control that can silence a
track must not be able to keep doing so once the user has stopped looking at it. A future
contributor who finds the clearing inconvenient is looking at the purpose of the feature, not
at a rough edge, and must not "fix" it into stickiness.

- **Five solo targets**, one per track. No per-drum-voice solo: the drum grid keeps its
  existing per-voice *mute* exactly as it works today — persisted per loop with
  `sequencerTracks` — and auditioning a single voice is already covered by the preview Play
  button every row carries (`TrackRow.tsx`'s `onPreview`). The Beat segment's only solo is the
  track-level Drums one in the card header, which answers a different question the preview
  button cannot: hearing the whole kit with nothing else under it.
- **Placed where the editing happens**, not in the mixer: Sound (one button following the
  active target), Pattern › Lead (card header), Pattern › Accompaniment (one per chord / bass /
  pad row), Pattern › Beat (card header). The mixer has no solo column at all.
- **Solo is a set, not a radio.** Soloing Drums and then Lead must sound both. This is load-
  bearing: with per-module play buttons gone (§5), "write a lead over just the drums" is
  *only* expressible as two simultaneous solos. A radio-style solo would delete that workflow
  silently.
- **Solo beats mute.** A track muted in `LoopMixPatch` sounds when soloed.
- **Scope is the whole loop.** Soloing the drums silences chord, bass, pad and lead — there is
  one solo set in the system, never a solo nested inside a group.
- **Cleared by navigation**: changing tab, Pattern segment, layer, or active loop empties the
  set. Crossing from Loop to Song is a tab change, so a solo can never leak into song playback.

**Two hard constraints, to be written into the implementation plan as prohibitions rather than
left to judgement:**

1. Solo must not touch `LoopMixPatch` and must not appear in `partializeAppState` or
   `PROJECT_CONTENT_KEYS`. It lives in the ui slice, which is not persisted. A project that
   reopens with a solo latched is the exact failure this design exists to avoid.
2. Effective audibility is computed in `engineSync.ts`, never in a component
   (`src/components/` must not import `audio/engine`):
   `audible(track) = soloTracks.length > 0 ? soloTracks.includes(track) : !muted(track)`,
   and for a drum voice, that result AND `!voice.muted` — the two mute layers are deliberate
   and stay.

## 5. One transport

**The three per-module play buttons are removed.** One play button, in the transport bar.
Monitoring one layer is what solo is for; two mechanisms for the same job is one too many.

This is also a bug class removed, not just a control. `subscribeClock` / `stopClockTimer` run
the shared 16th clock if and only if a player holds a subscription, and the metronome once
started that clock on its own — a second, invisible transport, with the playhead running and
the lead recorder quantising against silence. One play button means one place that starts the
clock.

**The Arrange cards keep their own play buttons, and that is not a contradiction.** Those play
a *different thing* — one loop instead of the arrangement — where the three module buttons all
played parts of the same loop.

The transport bar shows what the play button will play (`Loop A` or `Song`) and, when the solo
set is non-empty, a `SOLO · <tracks> ×` chip that clears it. With one play button, a silent
app must still have somewhere to look.

## 6. Playback continuity across the Loop / Song boundary

### The invariant

> Playback survives a navigation if and only if what sounds afterwards is exactly the loop now
> in focus.

Everything below follows from that sentence, including the four cases raised in discussion:

| From | To | Result |
|---|---|---|
| Loop layer playing loop L | Song layer | **continues**, shown as the solo-loop of L |
| Song layer solo-looping L | edit L | **continues** |
| Song layer solo-looping L | edit M | **stops** |
| Song layer playing the song | edit any loop | **stops** |

Entering the Song layer never stops anything. Only arriving at the Loop layer can.

### Store changes

`PlaybackScope` keeps its three kinds. The `layer-change` action is **deleted** and replaced:

```ts
| { type: 'focus-loop'; loopId: string }   // the Loop layer now shows loopId
```

```ts
case 'focus-loop':
  if (scope.kind === 'none') return scope;
  if (scope.kind === 'solo' && scope.loopId === action.loopId) return scope;
  return SCOPE_NONE;
```

Dispatched when the layer becomes `loop`, and when `activeLoopId` changes while the layer is
already `loop`. Reference-stable on the no-op rows, as the reducer's existing contract with
`songMode`'s `subscribeWithSelector` equality requires.

**Loop-layer play now carries a scope.** The transport button on the Loop layer dispatches
`toggle-loop { loopId: activeLoopId }` — no new action needed: `none → solo{id}` starts, and
the same id again stops. The consequence to state plainly: **while any player is playing, the
scope is never `none`**, on either layer. `none` means stopped. That invariant deserves its own
test, because the rest of this section depends on the scope alone being able to answer "what
is sounding".

**`songMode.reconcile()`** stops unconditionally hard-stopping on a layer boundary. Instead it
dispatches `focus-loop` and hard-stops only when that transition lands on `none` while players
are playing. Its store subscription must add `activeLoopId` to the selector it currently
watches (`activeTab` plus the three player states).

Two things fall out for free and should not be re-implemented: `loopPlayButton(scope, id)`
already derives the Arrange cards' disabled state from the scope alone, so a Loop→Song carry-
over shows the right card as Stop with the others disabled; and the existing
`layer !== 'song' || scope.kind === 'solo'` branch already nulls `songLoopIndex` and drops the
advance subscription, which is exactly right for a solo carried into the Song layer.

**Song playback must not move `activeLoopId`.** `songLoopIndex` is the cursor; if advancing the
arrangement also moved the edit focus, song playback would trip `focus-loop` and stop itself.
This is already true in the code and becomes load-bearing here.

**Deleting the scoped loop stops playback.** `deleteLoop` must not leave the scope pointing at
an id that no longer exists.

### What this reverses, knowingly

`songMode.ts` currently carries the comment "crossing a layer boundary can never preserve a
solo". That invariant came from the DEV fix recorded in
`2026-09-01-playback-scope-redesign.md`, where the layer-change clear was one of only two ways
a stuck `auditionLoopId` could ever be cleared — a cleanup mechanism, not a UX decision. The
scope reducer now makes a stuck scope unreachable by construction, so the layer stop is
redundant safety rather than the safety itself. **The comment must be replaced, not deleted**,
with the new invariant and this reasoning, or the next reader will restore the stop as a fix.

## 7. Naming: two different things are called "solo"

`PlaybackScope`'s `solo` kind means *one loop auditioned alone*. This design adds *track solo*.
Recommended, and cheap now while both are being touched: rename the scope kind `'solo'` →
`'loop'` (`{ kind: 'loop'; loopId }`) and `soloLoopId()` → `scopedLoopId()`. It is a mechanical
rename across `playbackScope.ts`, `songMode.ts`, `ArrangeView.tsx` and their tests, and it
removes a permanent trap — a reader grepping `solo` otherwise gets two unrelated features.
If the rename is declined, every mention in code and docs must be qualified as "solo loop" or
"track solo"; the bare word must not survive.

## Out of scope

- Solo does not start playback. Pressing solo with the transport stopped is silent, by design.
- No persist `version` or `.solna` `formatVersion` move: nothing new is persisted, and
  `activeTab` was never persisted. Per the repo's no-migration-chains rule, this is a
  validation question only if a persisted shape changes — none does.
- Tap Tempo and stereo VU stay unbuilt (`docs/design.md` §4 item 3).
- The takeover behaviour when Play All interrupts a carried-over loop scope keeps today's
  semantics; whether it restarts the arrangement from the loop's head is a question for the
  plan, not a change here.

## Implementation order

Four steps, in dependency order. Each is a branch and lands green under `bun run verify`.

1. **One transport** — remove the per-module play buttons and `AUTOMATION_TABS`'s `module`
   field; Loop-layer play goes through the existing `soloLoop(activeLoopId)`. Establishes
   "playing implies a scope", which step 3 depends on.
   Plan: `docs/superpowers/plans/2026-09-08-one-transport.md`.
2. **Nav restructure** — `ViewMode`, `patternSegment`, `VIEW_META`, `Header`, the Accompaniment
   frame, the mixer moved onto Sound. Pure UI and types; no audio behaviour changes.
3. **Playback continuity** — the `focus-loop` action, `songMode.reconcile()`, the replaced
   comment, the `deleteLoop` guard.
4. **Track solo** — ui-slice field, the solo controls, `engineSync` audibility, the transport
   bar's solo chip.

**Why the transport comes before the nav**, which is the reverse of the order this section
first carried: `AUTOMATION_TABS` (`Header.tsx:25`) maps one tab to one `PlayerModule`, and the
per-tab play button depends on that being one-to-one. The restructured Pattern tab owns three
modules at once, so doing the nav first would mean inventing a temporary mapping already known
to be deleted one step later. Removing the per-tab buttons first makes the nav change a pure
rename with nothing to invent.

### Test obligations

- `playbackScope.test.ts`: the reducer stays a total function over the new action set,
  including every `focus-loop` row and its reference-stability on no-ops.
- `songMode`: the four cases in §6's table, asserted on player state, not on the scope alone.
- A guard test for "while any player is playing, scope is never `none`".
- A guard test that the solo key appears in neither `partializeAppState`'s output nor
  `PROJECT_CONTENT_KEYS` — this is what keeps §4's first constraint true after the branch that
  writes it.
- Solo is additive; solo beats mute; a drum voice needs both its track audible and its own
  mute off.
- `viewMeta.test.ts` extends to the four views and three segments, keeping labels and icons
  distinct.

## What Phase 1 learned that Phase 3 must carry

Phase 1 (`docs/superpowers/plans/2026-09-08-one-transport.md`) shipped as
`refactor/one-transport`. Three things it discovered contradict what this spec assumed when it
was written, and Phase 3 inherits all three.

**The scope is not yet ground truth, and this spec's §6 assumes it is.** Two store paths restart
players without setting a scope: `loadLoop.ts`'s non-boundary branch and `vibes.ts`'s
`applyVibeToStore`. Both capture which players were active, call `hardStopAll()` — which resets
the scope to `none` — and then restart with `play(module)`, which sets no scope. Pressing the
transport Play on the loop layer and then switching loops, or clicking a vibe, therefore leaves
players `'playing'` under a `none` scope. Phase 1 documented this at the `PlaybackScope` type
rather than closing it, because closing it means deciding what a loop switch should leave
sounding — which is §6's own question. `playbackScope.test.ts` carries a source-scan guard that
fails the suite if a third caller of `play(module)` appears, so the hole cannot silently widen
while Phase 3 is being written.

**Two more scope/`activeLoopId` desynchronisations wait behind the layer-crossing hard stop that
§6 deletes.** `loopSlice.ts`'s `addLoop` and `duplicateLoop` both move `activeLoopId` without
touching the scope or the players. Today that is unreachable on the loop layer only because
crossing the layer boundary hard-stops everything; once §6 relaxes that, they become reachable
producers of a `solo{some other loop}` scope while the loop layer edits a different loop. In that
state the master Play renders enabled and does nothing, because `toggle-loop` returns the scope
unchanged and `soloLoop` early-returns on an unchanged reference. §6's `focus-loop` action is the
right place to answer this, but it must be checked against these two writers, not only against
`songMode`'s reconcile.

**Per-module monitoring has no interim replacement.** Phase 1 removed the three per-tab play
buttons; §4's track solo, which replaces them, is Phase 4. Between the two, auditioning one
layer alone is only possible by editing the loop's persisted mix. That is acceptable inside the
epic and is not acceptable in a release: Phase 1 must not reach users without Phase 4.
