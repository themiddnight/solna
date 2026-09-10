# Focus Track — one "what am I working on" value

Status: approved design, not yet implemented. **Executes as five sequenced plans, not one branch —
see Scope.** Completion gate: `bun run verify`, per plan, not only at the end.

## Problem

Solna holds two independent "what am I working on" values and **neither of them drives what you
hear**:

- `controlTarget` (`SynthControlTarget` in `src/utils/synthControl.ts`, defaulted and written in
  `src/store/synthSlice.ts`) — which synth channel the Sound page's panels edit.
- `patternSegment` (`PatternSegment` in `src/types.ts`, defaulted and written in
  `src/store/uiSlice.ts`) — which grid the Pattern page shows.

Everything that makes a *sound* is pinned to a constant instead:

- The keyboard is pinned by `KEYBOARD_AUDITION_TARGET` in `src/components/useInputDeck.ts`, a
  module constant of `'synth'`, threaded into `synthPlaybackNoteOn`, `synthPlaybackNoteOff`,
  `releaseSynthPlaybackVoices`, and `arpStateRef.controlTarget`.
- Rec is pinned to lead by construction: `src/store/leadRecord.ts` reads the scalar
  `leadRecording` and writes through the lead track's fields only.
- MIDI (`src/store/midiInput.ts`) plays melodic notes on the same pinned channel and never plays a
  drum at all.

Two user-visible symptoms traced this session, both of which are that pinning showing through:

**(a) Selecting FX on Sound and playing the keyboard sounds Lead.** The chip is lit, the panel
edits `fxSynthParams`, and the note you play comes out of the `'synth'` bus with the Lead patch.
Nothing on screen explains why, and nothing ever will while the two values are independent — the
user has correctly told the app what they are working on and the app is correctly ignoring them.

**(b) The FX melody grid's note preview is silent.** Measured live **in a session with a vibe
applied**: the FX track was carrying "Noise Riser FX" (`attack` 1.2 s), and `previewNote` in
`src/components/loop/lead/LeadMelodyGrid.tsx` passes a fixed `holdSec: 0.22` into
`previewSequencerNote` (`src/audio/playback/presetPreview.ts`), so note-off cancels the attack at
roughly -67 dBFS.

**That patch is not the factory default, and the first draft of this document said it was.**
`fxSynthParams` starts at `INITIAL_SYNTH_PARAMS` — `'Cosmic Lead'`, `attack` 0.02 s — in both
places that build a fresh FX track (`src/store/fxSlice.ts` and `defaultFxState()` in
`src/store/initialState.ts`); there is no `FX_DEFAULT_PRESET_ID`. What puts a slow patch on the
track is `applyVibeToStore`, and it does so **every time**: all eight entries in
`src/data/vibes.ts` set an `fxPresetId`, and every one of the three ids they draw from is
slow-attack — `factory-noise-riser-fx` 1.2 s (×4), `factory-cyber-drone` 0.8 s (×3),
`factory-laser-fx` 0.3 s (×1). So the symptom fires for **every vibe**, which is the ordinary way
into this app, not for an unusual default. That makes the preview-length fix worth shipping on its
own, and it is why the FX-default change below is dropped rather than merely deferred.

The root cause is **unchanged by that correction: the magic constant, not FX.** Any slow-attack
patch on Lead is equally silent today, and tuning `0.22` upward only moves the attack time at
which it breaks.

The fix for (a) is not "make the keyboard read `controlTarget`". Two values that mean the same
thing and are written by different surfaces will drift again; and merging them is what makes the
Pattern segment row and the Sound target row stop being two separate vocabularies for one idea.

## Decisions

These are approved. This document records them; it does not re-open them.

### The state model

**One state, `focusTrack`.** It replaces **both** `controlTarget` and `patternSegment`. Its id type
is **`MixLayerId`** from `src/components/mixLayers.ts` — `synth | fx | chord | bass | pad | drum`.

Reusing the mixer's roster is the point of the decision, not a convenience. The app already has
four vocabularies for "a track": `MixLayerId`, `SynthControlTarget`, `PatternSegment`, and
`SoloTrack`/`SourceBusId`. Inventing a fifth to be the focus id would guarantee a fifth translation
table, and the failure that produces is silent: a track that exists in one roster and not another
gets a chip that lights up and a surface that does nothing. `MixLayerId` is the only roster that
already covers all six things a user can work on, already carries each one's label and colour
(`MIX_LAYERS`), and is already what the mixer rows are keyed by — which is what makes the
per-surface table's "clicking a mixer row sets focus" a one-line binding rather than a mapping.

`MixLayerId`'s `'synth'` means Lead, exactly as `SynthControlTarget`'s does and for the same reason
(`MIX_LAYERS`' comment: the ids track the STORE fields, `synthVolume`/`synthMuted`, not the label).
Do not rename it to `'lead'` as part of this change — that is a rename of a dozen persisted store
fields wearing a focus-track change as cover.

`focusTrack` lives in the **ui slice** (`src/store/uiSlice.ts`), beside `patternSegment`, with a
`setFocusTrack` action. It is persisted **top-level exactly as `controlTarget` is today** — one
entry in `partializeAppState` (`src/store/store.ts`) replacing the `controlTarget` entry. It is
**not** project content: verified against `PROJECT_CONTENT_KEYS` / `applyProjectContent` in
`src/store/projectFormat.ts`, whose docblock already states that `controlTarget` is deliberately
absent because it is a user preference, not project state. `patternSegment` is not persisted today
and gains no persistence here — the merged value inherits `controlTarget`'s persistence, not the
union of both.

### The two projections

`PatternSegment` and `SynthControlTarget` **survive as types and as pure projections, not as
state.** Neither union is deleted; both stop being fields on the store.

```
segmentForFocus(focus: MixLayerId): PatternSegment
controlTargetForFocus(focus: MelodicFocus): SynthControlTarget
```

- `segmentForFocus` is total: `synth → 'lead'`, `fx → 'fx'`, `chord | bass | pad →
  'accompaniment'`, `drum → 'beat'`.
- `controlTargetForFocus` is **partial by type, not by fallback**. Its parameter is
  `MelodicFocus = Exclude<MixLayerId, 'drum'>`, so "what is the synth channel for the drum focus"
  is a question the compiler refuses to let a caller ask. A total function returning
  `'synth'` for `'drum'` is the trap: it would make the drum focus edit the Lead patch through
  every knob on the Sound page, consistently and invisibly.

  **The runtime fallback downstream is what makes the typing non-negotiable.**
  `resolveSynthControlChannel` (`src/utils/synthControl.ts:127`) ends in `channels[target] ??
  channels.synth`. That fallback is **load-bearing today**: `controlTarget` is persisted with no
  sanitize clause at all (see Persistence), so a garbage persisted value has to land somewhere and
  Lead is the sane somewhere. After this change it becomes a **trap**, because a `'drum'` value
  that reaches it does not throw, does not warn and does not render wrong — it edits the Lead
  patch. The two halves of the answer are therefore both required and neither alone is enough:
  **sanitize `focusTrack` at the persistence boundary** so a bad value never exists at runtime,
  and **type `controlTargetForFocus` over `MelodicFocus`** so the one bad value that can legally
  exist — `'drum'` — cannot be passed. Do not remove the `??` as part of this change: it still
  guards the other callers of `resolveSynthControlChannel`, and removing it converts a swallowed
  mistake into a crash without making the mistake any less possible.

Both projections are pure and both are **independently tested** — not tested only through the
surfaces that call them. They live in `src/store/focusTrack.ts`, beside `melodyTracks.ts` and
`sourceBuses.ts`: they name store vocabulary, they declare functions (so `src/data/` is out under
the data-layer purity rule), and they import nothing at runtime, so `src/components/` may read them
under layering rule 4.

`focusTrack.ts` also exports the melodic-track narrowing the rest of the change needs:
`MelodicFocus`, `isMelodicFocus(focus)`, and `melodyTrackForFocus(focus): MelodyTrackId | null`
(`synth → 'lead'`, `fx → 'fx'`, everything else `null`) — the bridge into `MELODY_TRACKS`
(`src/store/melodyTracks.ts`) that Rec and the melody grids read.

### What follows focus

Sound's synth panels and Target chip row; Pattern's visible grid and its segment row; keyboard
note-on/off; the arpeggiator; MIDI melodic notes; Rec; the Mixer row (clicking a row **sets**
focus); and a new always-visible focus chip in the input dock
(`src/components/ui/BottomInputDock.tsx`) that both shows and sets focus **on every tab**.

The dock chip is what makes the whole thing honest. Every tab view and every Pattern segment stays
mounted (CLAUDE.md, Architecture), and the dock is the one surface visible from all of them — so
"which track will the keyboard play" is answerable without navigating. Symptom (a) is not fixed by
routing the keyboard through focus alone; it is fixed by routing it through focus **and** putting
focus on screen wherever a key can be pressed.

### Per-surface behaviour

| Surface | Today | After |
|---|---|---|
| Sound — synth panel + Pro/Simple cards | reads `controlTarget` via `useSynthChannel` (`src/components/loop/synth/useSynthChannel.ts`) | reads `controlTargetForFocus(focus)`; the whole Synth section is hidden when focus is `drum` |
| Sound — Target chip row | writes `setControlTarget` (5 chips: synth/fx/chord/bass/pad) | writes `setFocusTrack` (6 chips, `drum` included); styling still `SYNTH_TARGET_STYLES` for the five, `MIX_LAYERS`' `drum` row for the sixth |
| Sound — Drum Sound section | always shown | shown only when focus is `drum`; the Synth section is hidden in that state |
| Sound — mixer rows (`loop/SoundMixer.tsx`) | fader + mute only | fader + mute unchanged, and clicking the row body sets focus to that row's `idPrefix` |
| Pattern — visible segment | `patternSegment` in the ui slice | `segmentForFocus(focus)`; `PatternView.tsx`'s `block`/`hidden` gate reads the projection |
| Pattern — segment row (`components/viewMeta.ts` `PATTERN_SEGMENTS`) | 4 buttons, one active | 4 buttons; `accompaniment` is active when focus is any of chord/bass/pad; clicking a button calls `setFocusTrack` with that segment's focus, and `accompaniment` always sends `chord` |
| Pattern — Accompaniment segment | one screen, chord+bass+pad | unchanged: one screen showing all three, with one of the three focused and marked as such |
| QWERTY / on-screen keyboard note-on/off | `KEYBOARD_AUDITION_TARGET` (`'synth'`) | the focused melodic track; **silent when focus is `drum`** |
| Arpeggiator | same pinned constant via `arpStateRef.controlTarget` | follows focus; see Voice safety |
| MIDI melodic note | pinned constant | the focused melodic track |
| MIDI drum note | not handled at all | `midiRoutesToDrums(channel, focus)` then `drumVoiceForMidi(note)`; see MIDI drums |
| Rec | pinned to lead; hidden on the FX grid | armed per melody track; hidden when focus is not a melody track |
| Input dock panel | user-chosen `keyboard`/`drums` tab | switches to Drums when focus becomes `drum`, to Keyboard when focus becomes melodic; the tabs stay clickable |
| Input dock — focus chip | does not exist | always visible, shows the focused track, opens a menu that sets it |
| Track solo | cleared by a `patternSegment` change | never cleared by a focus change; see Solo |
| Melody-grid preview length | fixed `holdSec: 0.22` | one beat at the current BPM, or the note's own `len`; see Preview length |

**Focus = `drum`.** Sound hides the Synth section and shows Drum Sound; the input dock switches to
its Drums panel; the melodic keyboard has nothing to play and plays nothing. QWERTY **drum-pad**
shortcuts are unchanged — `DEFAULT_PADS` in `src/components/ui/DrumPadGrid.tsx` uses `KeyZ`..`Slash`,
a disjoint key set from the melodic map, and `scripts/check-key-bindings.ts` (`bun run check:keys`)
is unaffected because neither set changes.

**Accompaniment stays one screen, and its button always focuses `chord`.** Pattern's
`accompaniment` button is active when focus is any of `chord`, `bass`, `pad`; clicking it sets
focus to **`chord`, unconditionally**. There is **no memory of which of the three was last used**,
and adding one is explicitly rejected — see Open risks.

The reason it buys almost nothing is worth stating, because "remember the last one" sounds free.
A memory only ever changes what happens when focus **leaves** the accompaniment group and comes
back **through the segment button**. It does nothing for the case that actually occurs constantly:
crossing between Sound and Pattern does not move focus at all — `focusTrack` is one value read by
both surfaces — so a user editing the pad on Sound and hopping to Pattern is still on `pad`, with
`accompaniment` lit, with no button press and no memory involved. What the memory would cost is a
**second invisible navigation state**, which is the exact class of thing this spec exists to
delete. One state that says what it means beats two states that mostly agree.

Consequence, stated so it is not later reported as a bug: focus `pad`, go to Beat, then press
Accompaniment — you land on `chord`, not `pad`. That is one click to get back, and the three grids
are all on screen either way; only which one is marked focused differs.

## Voice safety

This is the load-bearing part of the change. A synth target that can change **mid-hold** is exactly
what `KEYBOARD_AUDITION_TARGET`'s docblock was written to prevent — its stated reason is that
pinning "keeps every audio call site (note-on, note-off, arp playback, voice release) agreeing on
one engine, so a mode/target switch can never strand voices on an engine nothing points at
anymore". This change makes the target vary, so every one of those call sites needs the guarantee
re-established explicitly rather than by construction.

**1. Note-off releases on the target captured at note-on.** `useInputDeck` keeps a per-note
`Map<string, SynthControlTarget>` populated in `handleNoteOn` and read (and deleted) in
`handleNoteOff`; the target is **never recomputed at release time**. This is the same precedent as
the existing `chordKeyNotesRef`, whose comment already states the rule for chord mode: "key-up
releases those notes even if key/scale/octave changed while the key was held — never recompute the
chord at release time." Same failure, different axis: recomputing gives note-off a target the voice
was never on, so the release lands on a silent bus and the held voice drones until the same key is
pressed again on the same track. The blur/visibilitychange backstop and the keyboard-mode-change
cleanup both go through `handleNoteOffRef.current`, so both inherit the captured target for free —
but the map must be cleared in the same cleanup that clears `chordKeyNotesRef`, or a note released
by the backstop leaves a stale entry.

The equal-power rebalance is a second reader of the same fact, and it has **two halves that must
both be done**. Doing only one leaves the bug in place with a different shape.

- **Half one — the held-note COUNT becomes per target.** `useInputDeck` computes
  `equalPowerVelocityScale(held.size)` from a single global held set (`held` is
  `arpStateRef.current.activeNotes`, read in both `handleNoteOn` and `handleNoteOff`). That set
  becomes keyed by target — one held set per `SynthControlTarget` — and the scale for a note is
  computed from the count on **that** bus. The failure this prevents is audible on the second
  track a user touches: two notes held on Lead and two on FX are two buses running two voices
  each, not one bus running four, so a global count would apply a four-voice attenuation to both
  and **every note gets quieter the moment a second track is played**. Equal-power exists to keep
  a chord's total level flat as keys are added to one instrument; applying it across instruments
  turns it into a duck.
- **Half two — the ENGINE call becomes source-scoped.** `applySynthPlaybackVelocityScale` and
  `applySynthVelocityScale` gain the source parameter; see point 3 below, which is the same fix
  seen from the engine end.

Note the coupling to the arp: the per-target held set and `ArpStateRef`'s per-target trigger record
(point 2) are the same ref. `arpStateRef.current.activeNotes` is shared by the arp branch and the
plain-note branch of `handleNoteOn`, so the shape change lands once and both readers must be
updated together.

**2. `arpPlayback.ts`'s "known limitation" becomes reachable — close it and rewrite the docblock.**
`src/audio/playback/arpPlayback.ts` (the cleanup branch of `useArpPlayback`) documents that if
`controlTarget` changes after the last tick but before cleanup, it releases the wrong bus, and
states: "Unreachable today because the only caller (SoundView) pins controlTarget to a constant
(KEYBOARD_AUDITION_TARGET) for the lifetime of the hook; a future caller that varies controlTarget
mid-hold would need to close this gap." **This change is that caller.**

Closing it: **`ArpStateRef` stops carrying a single `controlTarget` and carries a SET of targets** —
`triggeredTargets: Set<SynthControlTarget>` — and the cleanup calls
`audioEngine.releaseSoundingVoices` **once per member**, not once. Three details, each of which is
the difference between the fix working and looking like it works:

- **The set is written at TRIGGER time, in the clock callback**, at the same place the tick reads
  the target off the ref and calls into the engine — not at render time and not when focus
  changes. A target the arp never actually reached must not be released (harmless but misleading),
  and a target it did reach must be in the set even if focus moved away one tick later. Trigger
  time is the only moment that is exactly "a voice now exists on this bus".
- **A single scalar cannot express the true state.** A user arpeggiating on Lead who focuses FX
  mid-hold has sounding voices on **both** buses. One captured target releases exactly one of them
  and the other drones — the same stranded-voice failure the original docblock was written to
  prevent, just reached by a different route.
- **The cleanup iterates the whole set**, and the set is cleared with it, so a later hold starts
  from an empty record rather than releasing buses it never touched.

The docblock must be rewritten to state the new rule (release every target that has been triggered,
because a focus change mid-hold leaves voices on more than one bus) and must **not** keep the
"unreachable today" sentence, which this change falsifies.

**3. `applySynthVelocityScale` must be scoped to its source.** In `src/audio/engine.ts`,
`applySynthVelocityScale(scale)` calls `this.reshapeableVoices()` **with no source argument**
although the parameter exists — and `reshapeableVoices(undefined)` walks every entry of
`sourceVoices`. So a keyboard press today rescales sounding **chord, bass and pad** voices as well
as the synth's. This is pre-existing and independent of focus, but the feature makes it audible in a
way it currently is not: hold a Lead note, focus FX, add notes, and the Lead voices get re-shaped by
FX's polyphony count.

The fix is to give `applySynthVelocityScale` a `source` parameter and thread it from
`applySynthPlaybackVelocityScale` and both `useInputDeck` call sites.

**Name the existing-behaviour change this implies, on the record:** today, holding keys on the
keyboard quietly ducks the sounding chord/bass/pad voices through equal-power rebalancing. After
this change it does not, so **the accompaniment sits slightly louder relative to a held keyboard
chord than it does today**. That is the correct behaviour — the accompaniment's level is the user's
fader decision, not something a keyboard press may renegotiate — but it is a change a listener can
hear, and it must not be reported later as a regression introduced by focus tracking.

## Rec

**Rec becomes per melody track.** `src/store/leadRecord.ts` becomes a **factory over
`MELODY_TRACKS`**, which is the precedent `leadSlice` already follows (one factory instantiated
twice, per CLAUDE.md and the `melodyTracks.ts` docblock).

`leadRecording: boolean` becomes **`recordingTrack: MelodyTrackId | null`** — one value, so two
tracks cannot be armed at once. A pair of booleans is the shape to avoid: nothing would stop both
being true, one live-capture clock would write two grids from one keypress, and the state is not
reachable through the UI, so no test would find it. `leadClockActive` and `leadMarkerFollowsClock`
take the track id and compare `recordingTrack === id`.

Rec is **hidden when focus is not a melody track** — there is nothing to arm on chord, bass, pad or
drum, and a Rec button that arms an invisible track is the same invisible-state failure this whole
spec removes. Arming is implicitly scoped to focus: pressing Rec sets `recordingTrack` to
`melodyTrackForFocus(focus)`, and a focus change away from the armed track disarms it (a recorder
left armed on a track the user has navigated away from writes notes the user cannot see).

**CLAUDE.md's statement that FX has no live recorder is superseded by this spec and must be
edited, not left standing.** Two places say it:

- CLAUDE.md, the FX-track paragraph: "**FX has no live recorder** — `leadRecording` and
  `store/leadRecord.ts` stay lead-only".
- `src/store/melodyTracks.ts`'s docblock: "There is no `recording` column: live capture is
  lead-only (store/leadRecord.ts, and the one note-input dispatcher behind it), so the FX grid
  renders no Rec button and its step publisher's gate is just its own player state."

Both were true and deliberate; both are false after this change. The `melodyTracks.ts` docblock's
paragraph is replaced with the reason there is still **no `recording` column** — the armed track is
one store scalar, not a per-track field, precisely so two cannot be armed — and the FX grid's step
publisher gate gains the recording term the lead's already has.

The note-input rules in `.claude/rules/note-input.md` are unchanged and constrain the
implementation: the recorder is a **parallel observer of the note-input bus**, so it must keep
reading `noteInputBus` rather than being wired into the keyboard per track; previews still must not
announce; and both note edges must still be announced, since live capture reads the on/off gap.

## Solo

**Drop `patternSegment` from `SOLO_NAV_SOURCES`** in `src/store/soloNav.ts`, leaving `layer` and
`activeLoopId`. **A focus change never clears the solo set.**

This is forced, not chosen. `soloNav.ts`'s docblock currently argues two things that a merged value
makes contradictory:

- "A Pattern-segment change is a different kind of navigation … so moving between them is a change
  of subject and still clears."
- "Changing the Sound view's control target does NOT clear the solo set, deliberately … clearing on
  a target change would make a two-track solo set unbuildable on that surface."

With one `focusTrack`, "segment change" and "target change" are the same event. Keeping the clear
would make a multi-track solo set unbuildable anywhere, which is the failure the second paragraph
exists to prevent; and the second paragraph's argument is the stronger one, because solo is a
monitoring gesture whose entire purpose is comparing tracks.

What still clears: a layer change (Loop ↔ Song, via `layerForTab`), an `activeLoopId` change, and a
project swap. Those are the rule CLAUDE.md states — a control that can silence a track must not keep
doing so once the user has left the loop it was set in.

Files that must change:

- `src/store/soloNav.ts` — the table, and the docblock, which argues at length for a clear this
  change removes. Rewrite it to state the new rule and **why the segment clear went away** (the two
  values merged; keeping it would contradict the target rule in the same paragraph). Keep the
  paragraphs on why one subscription beats a per-writer clear and why the emptiness test lives in
  the listener — neither is affected.
- `src/store/soloNav.test.ts` — asserts the source list exhaustively
  (`expect([...SOLO_NAV_KEYS]).toEqual(['layer', 'patternSegment', 'activeLoopId'])`, plus a second
  test binding `soloNavSignature`'s keys to the same list). Both must be updated, and that is the
  point of writing them exhaustively: this is a decision, not a silent drift.
- CLAUDE.md's solo paragraph, which currently reads "It is **cleared by a Pattern-segment change**,
  by leaving the Loop layer, or by changing the active loop" and then spells out the
  Sound↔Pattern-survives consequence in terms of "the control target". Rewrite both sentences
  against `focusTrack`. Keep the standing instruction that the clearing rule is the feature and must
  not be "fixed" into stickiness — it still applies to the two axes that remain.

## Persistence

**No migration chain**, per CLAUDE.md's rule. Concretely:

- `focusTrack` is added to `partializeAppState` (`src/store/store.ts`) in `controlTarget`'s place.
- `sanitizePersistedState` gains a clause: a `focusTrack` that is **missing, not a string, or not a
  member of `MIX_LAYER_IDS`** becomes `'synth'`.

  **This is a NEW clause, written from nothing — it is not an edit to an existing one.** Verified:
  `partializeAppState` (`src/store/store.ts:191`) writes `controlTarget`, and **nothing validates
  it on read**; there is no `controlTarget` line in `sanitizePersistedState` to modify. An
  implementer looking for one to rename will not find it, and the risk if they conclude the
  validation is "already handled" is that the new field ships unvalidated too.

  What has been standing in for validation is `resolveSynthControlChannel`'s trailing
  `?? channels.synth` (`src/utils/synthControl.ts:127`) — a runtime fallback that quietly absorbs
  any out-of-roster persisted value. **That fallback is load-bearing today and becomes a trap after
  this change**: once `focusTrack` includes `'drum'`, a drum focus that leaks into the synth path
  is not an error, not a warning and not a visible mis-render — it silently routes every Sound-page
  knob into the Lead patch. Sanitizing at the boundary is what removes the bad-value case
  altogether; typing `controlTargetForFocus` over `MelodicFocus` is what removes the legal-but-wrong
  `'drum'` case. Both, or the `??` goes on swallowing the mistake.
- `controlTarget` and `patternSegment` appearing in an old payload are **simply ignored**. They are
  not read, not translated, and not carried forward. A user who had FX selected on Sound reopens on
  Lead; that is one click, and it is cheaper than the version-gated branch CLAUDE.md rejects.
- **No `PERSIST_VERSION` bump and no `.solna` `formatVersion` change.** `focusTrack` is not project
  content, so `PROJECT_CONTENT_KEYS` and `sanitizeContent` (`src/store/projectFile.ts`) are
  untouched; and the persist version drives no read-time transform, so bumping it would express
  nothing.

The precondition CLAUDE.md names still holds: solna has no real users yet, so a preference reset on
one reload is acceptable. If that changes, the thing to bring back is a chain, not a special case
here.

## MIDI drums

`src/store/midiInput.ts`'s `handleMessage` currently computes `const command = status & 0xF0`
(line 146) and **discards the channel entirely**. It gains channel awareness, expressed as **two
pure testable functions** — a routing predicate and a table lookup, kept apart for the reason under
"Two different `null`s" below:

```
midiRoutesToDrums(channel: number, focus: MixLayerId): boolean   // channel is the wire value
drumVoiceForMidi(note: number): DrumType | null                  // pure table lookup
```

**`channel` here is the WIRE value, `status & 0x0F`, in the range 0..15** — not the 1-based number
printed on a controller's front panel. Every mention below says so explicitly, because this is the
one place a correct-sounding sentence compiles into a wrong program.

Policy, in order:

1. **GM channel 10 (wire value 9) is always drums, regardless of focus.** GM convention; an
   electric kit sends there unconditionally. An e-kit that goes silent because the app happens to
   be focused on Lead is the same invisible-state failure this entire spec removes — the user did
   nothing wrong and there is nothing on screen to explain the silence.
2. **Any channel other than wire value 9, with `focus === 'drum'`, is drums.** A controller without
   a channel-10 mode still has to be able to play the kit, and focus is the user saying so.
3. **Otherwise it is a melodic note on the focused track** — `midiRoutesToDrums` returns `false`
   and the caller routes through the melodic path.

**Trap worth stating because the code invites it:** GM "channel 10" is 1-based, and every piece of
prose about MIDI drums says "10". The wire value is `status & 0x0F`, so the comparison in code is
`channel === 9` — a spec sentence implemented literally as `channel === 10` is silently one
channel off, and the symptom (drums on channel 11, nothing on channel 10) reads as a device fault.
Write the extraction and the comparison in the same place, with the constant named
(`GM_DRUM_CHANNEL = 9 // GM channel 10, zero-based on the wire`), so a reader sees both at once.
The tests assert against the wire value too — see the testing plan.

`drumVoiceForMidi` returning `null` (not throwing, not defaulting to a voice) is what keeps an
unmapped number silent: a function that returned `'kick'` for a number it did not recognise would
put a kick under every unmapped e-kit pad.

**Two different `null`s, which is why the routing decision is a separate predicate.** A single
combined function would return `null` for both "this message does not route to drums at all"
(policy 3 — play it melodically, e.g. GM channel 4 / wire `3` with focus on Lead) and "this message
routes to drums but the number is unmapped" (policy 1 or 2 with a number not in the table — play
**nothing**). Collapsing them makes an unmapped pad on GM channel 10 emit a melodic note on the
Lead patch, which is a worse symptom than silence and reads as a synth bug rather than a mapping
gap. `handleMessage` therefore asks `midiRoutesToDrums` **first** and only then looks the note up,
so "drums or nothing" is expressed by the control flow rather than inferred from a `null`. Both
functions are pure and both are tested directly.

### `src/data/drumGmNotes.ts`

A new data-layer file: a `Record<DrumType, { note: number; alsoAccepts: readonly number[] }>`
literal. It satisfies the data-layer purity rule by construction — no runtime imports (only
`import type { DrumType }` from `src/data/drumKits.ts`, erased at compile), no function
declarations, no `new`, no impure global, no module-scope `let`.

Canonical GM numbers, canonical voice first and the row's alternates after:

| voice | note | alsoAccepts |
|---|---|---|
| kick | 36 | 35 |
| snare | 38 | 40 |
| rimshot | 37 | — |
| clap | 39 | — |
| hihat | 42 | 44 |
| openhat | 46 | — |
| hitom | 48 | 50, 47 |
| lowtom | 45 | 41, 43 |
| ride | 51 | 59 |
| crash | 49 | 57 |
| bell | 53 | 56 |

`alsoAccepts` is the field that stops "some pads on my e-kit are silent": 40 is Electric Snare, 44
is Pedal Hat, and tom numbering is per-brand (41/43/45 low, 47/48/50 high) with no agreement across
manufacturers. Without it the table is technically correct GM and practically broken on real
hardware, and the user-visible symptom — *some* pads work — reads as a hardware fault rather than a
mapping gap.

Tests (in `src/data/`, per the testing rule that a test asserting only what is in a table lives
there):

- Keys `toEqual` `DRUM_TYPES` **exhaustively** — the `DRUM_ALIASES` precedent in
  `src/audio/engine.test.ts`, which uses `toEqual` rather than a subset check for the stated reason
  that a subset check passes vacuously. A voice missing from this table is a voice no MIDI pad can
  reach, with nothing failing.
- **No GM number appears twice across rows**, counting `note` and every `alsoAccepts` entry
  together. A duplicate silently shadows a voice: whichever row the lookup reaches first wins and
  the other becomes unreachable, with both rows still looking right in review. (This is what rules
  out putting 40 on both snare and a tom, and why 47 sits on hitom rather than being listed twice.)

**The reverse direction (`DrumType` → GM note) is data-only.** The table already carries it in the
`note` field; **no reverse function is exported until a caller exists.** Verified: solna has no MIDI
out and no `.mid` export. An exported function with no caller has no test forcing it to stay honest
— exactly the shape CLAUDE.md rejects for version-gated branches, and exactly what
`melodyTracks.ts`'s docblock describes happening to the dead `controlTarget` column, which "got a
real assertion once and then got deleted instead of kept."

### MIDI drum velocity

**`velocity / 127` directly**, not multiplied by `DrumPad.volume`.

`DrumPad.volume` is doing two jobs — `DrumPadGrid.tsx`'s DEV-386 note already flags the naming
("`volume` here is a VELOCITY, not a level"): it is a per-voice balance **and** a default strike
strength. Multiplying would make a fortissimo hihat (0.75 × 1.0) unable to reach a mezzo kick
(0.9 × 0.8), so a drummer's dynamics would be re-ranked by a table they never edited. The pad's
authored value stays the default strike for QWERTY and touch, where there is no velocity to read.

**`bell` has no pad, and that is settled, not a gap.** `DEFAULT_PADS`
(`src/components/ui/DrumPadGrid.tsx`) has **ten** entries and `DRUM_TYPES` has **eleven**; the
omission is deliberate and already named in code as `PADLESS_VOICES = ['bell']`, with the pad
grid's docblock stating that it frees `KeyQ`. Two consequences, both of which this spec relies on
rather than fixes:

- **`drumGmNotes.ts` is keyed off `DRUM_TYPES`, never off `DEFAULT_PADS`**, so `bell` is in the
  MIDI map like every other voice. Keying it off the pads would drop `bell` with nothing failing —
  which is exactly what the exhaustive `toEqual(DRUM_TYPES)` key test above exists to catch. MIDI
  therefore reaches a voice the pad grid cannot, which is already true of the sequencer.
- **The velocity decision above simply has no bearing on `bell`.** "The pad's authored value stays
  the default strike for QWERTY and touch" describes a `DrumPad.volume` that `bell` does not have;
  `bell` is reachable only by MIDI (which carries its own velocity) and by the sequencer (which
  carries the step's). There is no padless-voice default strike to decide, and **this spec does not
  add a pad for `bell`** — doing so would move `check:keys`, which Out of scope forbids.

### Recording drums from MIDI into the sequencer grid — deferred on purpose

Out of scope, deliberately. Drums are **not on `noteInputBus` today** (the bus is the melodic
dispatcher; `triggerPad`/`triggerDrum` do not announce), and writing hits into `sequencerTracks`
needs a quantiser that does not exist. Doing it inside this change would mean adding a second kind
of event to the bus and a new write path to the sequencer in the same commit that merges two
navigation states — three unrelated risks in one diff.

**This mapping table is that feature's prerequisite**, which is the reason it is built now rather
than when drum recording lands: a drum recorder needs a note→voice map before it needs anything
else, and building it here means the deferred feature starts from a tested table.

## Preview length

**Replace the `0.22` constant with a musical length.** In
`src/components/loop/lead/LeadMelodyGrid.tsx`'s `previewNote`:

- A **row-label** preview (clicking a pitch label to hear the row) sounds **one beat at the current
  BPM** — `60 / bpm` seconds, i.e. four times `stepDurationSec(bpm)` from
  `src/utils/musicTheory.ts`.
- Clicking a **cell that holds a note** sounds **that note's own `len`**, converted from ticks
  through the track's active stride (`src/utils/stepResolution.ts`).

Why this is more explicable than tuning the constant: `0.22` is silent for any patch whose attack
exceeds it, and the only way to pick a "safe" value is to measure it against the slowest patch in
the library — which makes the number a hidden dependency on the preset table, re-broken by every
preset added. A musical length has no such dependency and answers a question the user is actually
asking. A cell preview that lasts the note's own length is *literally* what the grid is showing;
a row preview that lasts a beat is the shortest length that is a musical unit rather than an
arbitrary one. Both still get slower at slower tempos, which is the direction that helps — a slow
patch is usually in a slow piece.

This does not make every patch audible at every tempo (a 1.2 s attack at 140 BPM still only reaches
part-way through a 0.43 s beat), and it is not supposed to: the point is that the length is now a
stated musical rule that a reader can predict, instead of a constant that happens to work for the
patches someone tried. The slow-patch case that remains is **accepted, not handed to the next
section** — see *FX default patch — dropped* for why the patch end of it is not being touched.

`previewSequencerNote`'s own `holdSec = 0.5` default is unchanged — it serves other callers, and
this change is about the melody grid's call site passing something meaningful.

## FX default patch — dropped

**This change is dropped. It was written against a false premise: that the FX track defaults to
"Noise Riser FX."** It does not. Verified in the code:

- `src/store/fxSlice.ts` and `defaultFxState()` in `src/store/initialState.ts` both set
  `fxSynthParams: INITIAL_SYNTH_PARAMS`, and `INITIAL_SYNTH_PARAMS.preset` is `'Cosmic Lead'` with
  `attack: 0.02`. There is no `FX_DEFAULT_PRESET_ID` in the codebase.
- The factory default therefore **already satisfies** the constraint this section wanted to impose
  — 0.02 s is five times under the 0.1 s ceiling, and Cosmic Lead is an oscillator patch, not a
  noise source. There is nothing here to fix.
- The only way a user gets a slow-attack FX patch is `applyVibeToStore`, and **all eight vibes set
  an `fxPresetId`, every one of them slow**: `factory-noise-riser-fx` 1.2 s (×4),
  `factory-cyber-drone` 0.8 s (×3), `factory-laser-fx` 0.3 s (×1).

So the real exposure is through vibes, and **vibes are curated content that is not retuned by a bug
fix.** A vibe's FX voice is authored — the lo-fi tape-hiss riser under the turnaround is the point
of it — and re-voicing four (or eight) of them is a taste decision, one that moves the Instant
Vibes golden fixtures and belongs to a vibes retune with its own listening pass. The preview-length
fix above closes symptom (b) for all eight vibes on its own, which is the whole of the bug.

**What is deliberately not smuggled in:** making FX ship sounding *different from Lead*. Today the
two melody tracks start on the same patch, and whether that is right is a taste question — a real
one, worth asking on its own terms — not a corollary of a preview bug. Changing a default is a
change every new session feels; it does not ride along with a fix.

**Rejected alternative, kept so it can be revived deliberately.** If FX should get its own default
patch, the shape of that change is already worked out and needs no re-derivation:

- The constraint, stated as a test rather than a preset name, because a name goes stale the first
  time the library is retuned: **`attack` ≤ 0.1 s** (under a quarter of a beat at 120 BPM, so the
  patch is at full level well inside the one-beat row preview decided above and inside a 16th at
  any tempo the app offers — a ceiling, not a target) and **a definite pitch**, an oscillator-based
  patch rather than a noise source, so that playing two grid rows demonstrably plays two different
  notes.
- The concrete pick: **`factory-glocken-bell` — "Glocken Bell", `attack` 0.002 s,
  `oscType: 'sine'`, `noiseVolume: 0.0`.** It clears both bullets by the widest margin in the
  library and is maximally unlike the Lead default's sawtooth, so the two melody tracks would be
  distinguishable on the first note.
- **No FX-category preset passes the attack bar** — Laser FX 0.3 s, Cyber Drone 0.8 s, Noise Riser
  FX 1.2 s — so an FX default that clears it must come from another category. That is a fact about
  the library, not about the FX track, and it is the reason the pick above is a "Keys" preset.
- Implementation shape, if revived: an id constant plus a `presetById`-resolved params constant in
  `src/store/initialState.ts`, following the existing Pad precedent exactly, consumed by both
  places that build a fresh FX track.

Risers stay available as presets either way and lose nothing.

## What gets deleted

- `controlTarget` and `setControlTarget` from `src/store/synthSlice.ts` and from `AppStore` /
  `PersistedState` in `src/store/types.ts`.
- `patternSegment` and `setPatternSegment` from `src/store/uiSlice.ts` and from the store types.
- `KEYBOARD_AUDITION_TARGET` from `src/components/useInputDeck.ts`, and every comment that cites it
  as the reason a call site is pinned (there are four in that file plus one in `arpPlayback.ts`).
- `patternSegment` from `SOLO_NAV_SOURCES` in `src/store/soloNav.ts`.
- `leadRecording` from the store, replaced by `recordingTrack`.
- The `0.22` literal in `LeadMelodyGrid.tsx`.
- `focusSynthTarget` / `SynthTargetNavigation` in `src/utils/synthControl.ts` keep their shape but
  swap `setControlTarget` for `setFocusTrack`; the "target first, then tab" ordering comment stays
  true and stays.

**Not deleted:** the `SynthControlTarget` and `PatternSegment` types, `SYNTH_TARGET_STYLES`,
`PATTERN_SEGMENTS` in `src/components/viewMeta.ts`, and `PATTERN_SEGMENT_IDS` in `src/types.ts`.
`PATTERN_SEGMENT_IDS`'s docblock calls the segment "a second axis (`patternSegment` in the ui
slice)" — that sentence is now false and must be rewritten to say the segment is **derived** from
`focusTrack` and remains a within-tab position rather than a route. `viewMeta.test.ts`'s check that
`PATTERN_SEGMENTS`' ids match `PATTERN_SEGMENT_IDS` is unaffected and still earns its keep.

### Docblocks that must be rewritten because this change falsifies them

Each of these asserts something that stops being true. Leaving one standing is worse than having no
comment: it tells the next reader a rule the code no longer follows.

1. `src/components/useInputDeck.ts` — the `KEYBOARD_AUDITION_TARGET` comment ("pinning it here …
   so a mode/target switch can never strand voices on an engine nothing points at anymore"). Replace
   with the per-note captured-target rule and the failure it prevents.
2. `src/audio/playback/arpPlayback.ts` — the "Known limitation … Unreachable today because the only
   caller (SoundView) pins controlTarget to a constant" paragraph, plus the `ArpStateRef` interface
   comment above it that describes `controlTarget` as a single value read off the ref. Both are
   replaced by the multi-target rule: the ref records **every** target the hook has triggered on,
   written at trigger time, and the cleanup releases all of them — because a focus change mid-hold
   leaves sounding voices on more than one bus and a single captured target releases only one.
   Delete the "unreachable today" sentence outright rather than softening it; this change is the
   caller it names.
3. `src/store/soloNav.ts` — the paragraph arguing a segment change must clear and a target change
   must not.
4. `src/store/melodyTracks.ts` — "There is no `recording` column: live capture is lead-only".
5. `src/components/loop/SoundView.test.tsx` — the `describe('keyboard audition channel is always the
   main synth', …)` block and its comment. The block's *subject* is exactly the behaviour being
   removed; it must be replaced by tests that the keyboard follows focus, not renamed around the
   old assertions.
6. `src/types.ts` — `PATTERN_SEGMENT_IDS`' docblock ("a SECOND axis (`patternSegment` in the ui
   slice)").
7. `CLAUDE.md` — the FX-has-no-live-recorder sentence in the FX paragraph, and the solo-clearing
   paragraph's "cleared by a Pattern-segment change" plus its "via the control target" consequence
   note.

## Scope — this is five sequenced plans, not one

**Assessed and decided: it must be split.** As written this document changes a store field's
identity, six UI surfaces, the keyboard and arp voice lifecycle, the engine's velocity-scaling
signature, the recorder's shape, the solo-clearing table, the persistence boundary, the MIDI input
path, a new data table and a preview length. Landing that as one diff means a
review that cannot separate "the state model is right" from "the arp still releases correctly",
and a bisect that cannot separate an audible regression from a navigation one. The split below is
the order to execute in; each numbered plan is a branch that ends green on `bun run verify` and
leaves the app usable.

**0. Preview length.** Independent of everything else here — it reads no `focusTrack` and touches
no store field. It closes symptom (b) on its own, for every vibe, so it ships first rather than
waiting behind the state model. Sections: *Preview length*. **The FX default patch is not part of
it** — that change is dropped; see *FX default patch — dropped*.

**1. The state model and the surfaces that only READ it.** `src/store/focusTrack.ts` and its
projections; `focusTrack` in the ui slice; persistence (`partializeAppState` + the new sanitize
clause); deleting `controlTarget` and `patternSegment` and rewiring Sound's panels and Target row,
`PatternView`'s gate, Pattern's segment row, the mixer row click, the dock chip and its panel
auto-switch; `soloNav`'s table and docblock; the `PATTERN_SEGMENT_IDS` and `soloNav` docblock
rewrites. Sections: *The state model*, *The two projections*, *Per-surface behaviour* (all rows
except keyboard/arp/MIDI/Rec), *Solo*, *Persistence*.

**This plan deliberately leaves symptom (a) in place**, and that is what makes it shippable on its
own: `KEYBOARD_AUDITION_TARGET` is a module constant of `'synth'` that reads no store field, so
deleting `controlTarget` does not disturb it. At the end of plan 1 the app has one honest
navigation state and a keyboard that still plays Lead — visibly incomplete, never broken.

**2. Voice routing and voice safety.** The keyboard and arp follow focus: the per-note captured
target map, the per-target held set, `applySynthVelocityScale`'s `source` parameter threaded from
both call sites, `ArpStateRef`'s target set and multi-target cleanup, and the `useInputDeck` /
`arpPlayback` / `SoundView.test.tsx` docblock and test rewrites. This is the plan that closes
symptom (a) and the only one that can strand a voice. Sections: *Voice safety*, the keyboard and
arp rows of the table, Open risks 1 and 4.

**3. Rec per melody track.** `leadRecord.ts` as a factory over `MELODY_TRACKS`, `leadRecording` →
`recordingTrack`, Rec hidden off a melody focus, the `melodyTracks.ts` docblock and the CLAUDE.md
FX-recorder sentence. Depends on plan 1 for `melodyTrackForFocus`; independent of plan 2.
Sections: *Rec*.

**4. MIDI.** `src/data/drumGmNotes.ts` and its tests, `midiRoutesToDrums` / `drumVoiceForMidi`,
`handleMessage`'s channel awareness, and MIDI melodic notes following focus. Depends on plan 1 for
the focus value; independent of 2 and 3. Sections: *MIDI drums* and its subsections.

**Ordering constraints, explicitly:** 0 is unordered against everything (do it first because it is
smallest). 1 blocks 2, 3 and 4. 2, 3 and 4 are mutually independent and may land in any order or in
parallel. Nothing in 2, 3 or 4 blocks 1.

**CLAUDE.md edits go with the plan that falsifies them**, not in a documentation pass at the end —
the solo paragraph with plan 1, the FX-recorder sentence with plan 3. A doc-sync commit after the
fact is how a false sentence survives a review that had the code in front of it.

## Testing plan

Per `.claude/rules/testing.md`: **no DOM, no testing-library**, and any behaviour that can be a pure
function is extracted and tested as one rather than rendered.

**Pure helpers (the bulk of the coverage) — `src/store/focusTrack.test.ts`:**

- `segmentForFocus` over **every** `MIX_LAYER_IDS` member, asserted against a literal expected map
  rather than by re-deriving — the `DRUM_ALIASES` `toEqual` discipline. A `for` loop that
  recomputes the mapping proves only that the function equals itself.
- `controlTargetForFocus` over every `MelodicFocus`. The `'drum'` case is a **compile-time**
  assertion, using the `Assert<T extends true>` pattern already in `melodyTracks.ts` — a bare
  conditional type alias resolves to `never` with nothing consuming it and no error at all.
- `melodyTrackForFocus` — the two melody rows map to `MELODY_TRACKS` ids, the other four to `null`,
  and the returned ids are cross-checked against `MELODY_TRACKS` so a renamed track fails here.
- `isMelodicFocus` is total over `MIX_LAYER_IDS` and its `true` set is exactly
  `MIX_LAYER_IDS` minus `'drum'`.

**MIDI — `src/store/midiInput.test.ts`:**

- `midiRoutesToDrums` as a table test over the three policy branches, **written against wire values
  throughout**: wire `9` (GM channel 10) with a melodic focus is `true`; wire `0` with
  `focus === 'drum'` is `true`; wire `0` with a melodic focus is `false`. Include wire `10`
  (GM channel 11) with a melodic focus returning `false` — that is the case a literal
  `channel === 10` implementation gets wrong, and without it the off-by-one passes the suite.
- Every `note` and every `alsoAccepts` entry in `drumGmNotes.ts` resolves to its own row, driven
  from the table itself so a row added later is covered without editing the test.
- An unmapped drum number on wire channel `9` produces **no sound at all** — assert on
  `handleMessage`, not just on `drumVoiceForMidi` returning `null`, because the fall-through is a
  property of the caller's control flow (predicate first, lookup second) and that is where it can
  go wrong. GM channel 10 is drums or nothing.

**Drum GM table — `src/data/drumGmNotes.test.ts`:** the exhaustive-keys and no-duplicate-number
tests described under MIDI drums, plus the data-layer purity suite in
`src/data/dataLayerPurity.test.ts` picking the new file up automatically.

**Persistence — `src/store/store.test.ts`:** `partializeAppState` includes `focusTrack` and no
longer includes `controlTarget`; `sanitizePersistedState` maps missing / non-string / out-of-roster
`focusTrack` to `'synth'` and leaves a valid one untouched; a payload carrying the old
`controlTarget` and `patternSegment` keys produces a state with neither and with `focusTrack ===
'synth'`. Because storage lags the store by up to one idle window, any assertion that reads
`localStorage` calls `flushPersistedWrites()` first.

**Solo — `src/store/soloNav.test.ts`:** update both exhaustive assertions to
`['layer', 'activeLoopId']`, and **add** a test that a `focusTrack` change with a non-empty
`soloTracks` leaves the set intact — the assertion that the removed clear stays removed. The
existing "never watches soloTracks itself" test is unaffected.

**Rec — `src/store/leadRecord.test.ts`:** the factory produces two independent bridges;
`recordingTrack` admits exactly one armed track (arming FX while Lead is armed leaves
`recordingTrack === 'fx'`, not both); `leadClockActive` / `leadMarkerFollowsClock` gate on the
matching id only; and a focus change away from the armed track disarms it. The note-input-bus
observer contract is exercised by emitting on the bus, not by simulating a keypress.

**Voice safety — `src/components/useInputDeck.test.ts` + `src/audio/*.test.ts`:**

- The per-note target map is exercised through an exported pure helper over
  `(heldMap, note) → target | undefined`, not through a rendered hook. If the map has to stay
  internal, the test drives `handleNoteOn`/`handleNoteOff` against the fake engine
  (`src/audio/testFakes.ts` `freshEngine()`) and asserts the note-off landed on the note-on's
  source, with the focus changed in between.
- `applySynthVelocityScale(scale, source)` rescales only that source's voices: build voices on two
  sources through `freshEngine()`, rescale one, and assert the other's recorded param events are
  untouched. Assert on `fakeParam`'s recorded `events`/`targets`, **not** on a computed value —
  `valueAt` refuses timelines containing `setTargetAtTime`, and this path uses it.
- The arp cleanup releases every triggered target: tick on one target, change focus, tick on
  another, unmount, and assert **both** got a release. Also assert the negative — a target that was
  focused but never ticked on gets **no** release — since a cleanup that simply released every
  known target would pass the first assertion while releasing buses it never touched.
- The held-note count is per target: hold two notes with focus on Lead, change focus to FX, hold
  two more, and assert the scale applied to the FX notes is `equalPowerVelocityScale(2)`, not
  `(4)`, and that no further scale event lands on the Lead voices. This is the assertion that
  fails if only the engine-side `source` parameter is threaded and the count is left global — the
  two halves of the fix are tested separately on purpose, because either alone leaves an audible
  bug and a green suite.

**Rendered markup (only where markup is the behaviour), `renderToString` substring assertions:**

- The Sound target row renders six chips and the focused one carries its active class list, checked
  as a single literal substring so the classes are proven to sit on the same element.
- With focus `drum`, the Sound page's markup contains the Drum Sound heading and not the Synth
  section's.
- `PatternView` renders exactly one segment un-`hidden` for a given focus.
- The dock's focus chip renders the focused track's label.

**The zustand `getServerSnapshot` trap applies to every one of those.** `useAppStore.setState(...)`
before a `renderToString` has no effect on a plain `useAppStore((s) => …)` selector — zustand serves
`api.getInitialState()`, captured at store creation, and the test silently asserts against
creation-time state with nothing in `bun run verify` catching it. `focusTrack` is precisely a value
tests will want to set before rendering, so **any component whose markup must reflect a
test-set focus reads the store through the `useLiveStore` helper** in
`src/components/ui/BottomInputDock.tsx` (which serves `getState()` for both snapshots), or the case
is tested as a pure helper instead. Prefer the pure helper: the projections exist so that most of
these questions never need a render.

**`bun run verify` is the completion gate** — `bun test`, `bun run lint`, `bun run eslint` (which
must still report nothing at all, no errors and no warnings), `check:keys`, `check:drums`,
`check:contrast`, `check:levels`, and `build`.

## Out of scope

- **Recording drums from MIDI into the sequencer grid** — deferred on purpose; see MIDI drums.
- **MIDI out and `.mid` export**, and with them any exported `DrumType → GM note` function.
- **Renaming `'synth'` to `'lead'`** anywhere in the store, the mixer or the persisted fields.
- **FX's two known engine limits** — no pitch riser (the filter envelope ramps `filter.frequency`
  only) and an LFO that restarts per note. Both are already deferred to their own spec and this
  change does not touch them. Nor does it touch the FX **default patch**, which stays
  `INITIAL_SYNTH_PARAMS` — see *FX default patch — dropped*.
- **A per-track keyboard octave or scale lock.** Focus changes which track sounds, not how the
  keyboard is laid out.
- **Any change to the drum-pad QWERTY map**, which would move `check:keys`.

## Open risks

**1. A focus change mid-hold on the arp is the riskiest path in the change.** The multi-target
release closes the documented gap, but the arp's cleanup only runs on unmount or on `active`
flipping — a focus change alone runs neither, so voices from the previous target keep sounding
until they release naturally. Tradeoff: cutting them on every focus change is a hard stop the user
did not ask for (they may be deliberately layering); letting them ring means the previous track can
be audible after the chip says otherwise. **Chosen for now: let them ring**, because they are
finite and the alternative silences a musical gesture. If it reads as a bug in use, the fix is a
release on focus change scoped to the target being left, not a global stop.

**2. The dock's panel auto-switch fights a deliberate user choice.** Focus `drum` switches the dock
to Drums; a user who wants the drum grid focused *while* auditioning melodic notes has to switch
the panel back on every focus change. Keeping the tabs clickable (decided) mitigates it but does not
remove it. The alternative — never auto-switching — leaves a user who focuses `drum` looking at a
keyboard that plays nothing, which is worse and is the symptom this spec exists to remove.

**3. REJECTED ALTERNATIVE — remembering the last-used accompaniment track.** An earlier pass of
this spec carried a session-only ui-slice field, `lastAccompanimentFocus: 'chord' | 'bass' | 'pad'`,
written by `setFocusTrack` whenever the new focus was one of the three, so that Pattern's
Accompaniment button restored the last one instead of always sending `chord`. **It is removed.**
Recorded here with both sides so the call can be flipped later without re-deriving it:

- **What it buys:** returning to Accompaniment via the segment button lands on the track you were
  last editing, saving one click.
- **What it costs:** a second invisible navigation memory, in a change whose entire purpose is
  deleting invisible navigation state. It is state nothing on screen explains, written as a side
  effect of an unrelated action, and unreachable through any control.
- **Why the purchase is small:** the memory only ever fires when focus **leaves** the accompaniment
  group and returns **through the segment button**. The traffic that actually happens all day —
  crossing between Sound and Pattern — does not move focus at all, so it never consults the memory.
  The convenience is real but narrow; the second state is permanent.
- **If it is flipped back:** it stays session-only (persisting it would open a fresh reload on
  whichever of the three was touched days ago, which reads as a bug rather than as memory), and if
  a second grouped segment ever needs the same thing, the answer is one general
  last-focus-per-segment map, not a second field.

**4. The equal-power level change is audible, is a change to EXISTING behaviour, and no test will
fail because of it.** Scoping `applySynthVelocityScale` to its source is correct — today it calls
`reshapeableVoices()` with no argument and therefore rescales sounding chord, bass and pad voices
along with the synth's, so a keyboard press quietly ducks the accompaniment. After this change it
does not, and **the accompaniment sits slightly louder relative to a held keyboard chord than it
does today**. Nobody asked for that difference and no assertion covers it, so it is recorded in two
places on purpose — here and under Voice safety point 3 — and it lands in plan 2. If someone
reports "the backing got louder" after focus tracking ships, this is the answer; it is not a
regression to bisect and not a bug to revert.

**5. Preview length does not guarantee audibility, and the worst case is still shipped.** A
slow-attack patch at a fast tempo is still quiet on a one-beat preview, and every vibe hands FX one
— the riser's 1.2 s attack only reaches part-way through a 0.43 s beat at 140 BPM. Accepted
knowingly: the rule is now predictable and a beat is roughly five times the old 0.22 s hold, so the
preview goes from inaudible to quiet-but-there, while re-voicing curated vibe content to make a
preview louder is the wrong lever (see *FX default patch — dropped*). If this recurs on a
user-authored patch, the fix is a preview-specific attack override in `previewSequencerNote`, not a
longer constant and not a retuned library.
