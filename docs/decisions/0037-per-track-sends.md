# ADR-0037: Per-track sends into the shared master effects

**Status:** Accepted — 2026-09-22. DEV-423

## Context

The structure README's A1 finding and its "Per-track FX" deferred item both named the same gap:
the Beat (`sequencer`) bus never reached master delay, reverb or distortion — first by accident of
`setupMasterChain`'s construction order, then, once that was made explicit, by the
`SOURCES_WITHOUT_MASTER_SENDS` exclusion set stating it as a rule. Every other bus fed all three
send gates at one fixed, unadjustable unity amount: a track could only be all-in or all-out of the
shared reverb, delay and distortion, with no per-track control and no way for drums to reach delay
or distortion at all.

## Decision

1. Per-track **send levels** into the existing shared master reverb, delay and distortion; no
   effect instance per track.
2. Six tracks = `SOURCE_BUSES`; stored as `trackSends: TrackSends`, keyed by engine source id
   (never the mixer id `'drum'` or a solo id), levels linear 0..1, fields
   `reverb`/`delay`/`distortion`.
3. **Per loop**, in `LOOP_FLAT_KEYS` and the `mix` copy group; flows through undo, duplicate, copy,
   save and export like every other per-loop mix field.
4. Defaults 1/1/1 on every track except the Beat track's delay and distortion, both 0 — chosen so
   the golden mixdown stays byte-identical to before this change.
5. Validated in `sanitizeLoops` via `sanitizeTrackSends`: no migration, no version bump.
6. Routing: each bus, after its own fader and mute, feeds its own three send nodes, which feed the
   existing shared gates; `SOURCES_WITHOUT_MASTER_SENDS` is removed, since every bus now has its
   own send nodes instead of being excluded wholesale. The master wet knobs remain the one global
   amount downstream of every track's send.
7. Beat reverb keeps no bus→reverb edge. The per-voice path (`wireDrumVoice`'s `reverbSend`) goes
   through `drumSendGate` and then, in series, into the Beat track's own reverb send node; that
   feed is connected as the convolver's second input, after `reverbSendGate` (C1) — the same sum
   order the golden pinned before this change.
8. Per-voice `reverbSend` is unchanged in data and UI (the knob still reads "Reverb", no tooltip)
   and is redefined as a **multiplier of the Beat track's reverb send**, not a direct master-reverb
   send.
9. Engine: `setSourceSends(source, sends, time?, mode?)` is a separate method from
   `setSourceState` (C2); send nodes are seeded at 0 until told a level; the node code
   (`SourceSendNodes`, `clampSendLevels`, `createSourceSendNodes`, `applySourceSendLevels`) lives
   in the new `audio/sourceSends.ts`, not inline in `masterRack.ts`.
10. `engineSync`: one `trackSends` subscription per bus, plus a settle push in `applySliceState`
    and at transport start (`settleSourceBuses`); solo and mute need nothing extra — sends read no
    audibility (R160), only the bus they tap, which is already zeroed by mute/solo/fader.
11. Mixdown: `MixdownBusState` gains `sends: TrackSendLevels`. `applyMasterState` settles every
    bus's sends at time 0, unconditionally, alongside its bus state. `applyLoopAudioState` pushes a
    loop's sends at that pass's first sample **only when they differ from the previous pass**: an
    always-on push at every boundary changed the golden WAV's bytes even where a same-value
    automation event produced no audible change (a ramp held at an already-reached value is not a
    no-op on the rendered signal). Time-zero passes still always push, so the arrangement's first
    sample is always settled explicitly.
12. UI: Rev/Dly/Dist `xs` knobs in each Mixer row, with a local draft and an engine preview,
    committed once on release (`useTrackSendsDraft`).
13. DEV-429 stems (decided in that design, not here): dry, tapped at the bus after its fader;
    sends are ignored for the stem output.

One addition the spec's decision list did not carry explicitly: the audition bus `'preview'`
reaches `getSourceBus` (through `presetPreview.ts` → `audioSession.ts`'s `getSourceTap`) exactly
like a track's bus does, but it is not a track and has no store row. `beginPreview()` therefore
tells the engine `setSourceSends('preview', { reverb: 1, delay: 1, distortion: 1 })` once, so every
audition sounds exactly as it did before this change.

**Rejected alternatives:**
- Keying `TrackSends` by mixer id `'drum'` — the store's per-loop mix fields, and every consumer
  that reads them, are keyed by engine source id (`SOURCE_BUSES`); a second id space for one field
  would be its own bug surface.
- `send[sequencer].reverb → reverbSendGate` (routing the Beat track's reverb send through the
  shared gate instead of straight to the convolver) — that reorders the sum the convolver receives
  (C1); float addition is not associative, so it risks changing the golden's rendered bytes for no
  behavioural gain.
- A bus→reverb send for Beat in addition to the per-voice path — double reverb on every voice, and
  a behaviour change for every existing project the moment it opens.
- Seeding send nodes at 1 inside `audio/` for a store-driven track — that duplicates the store's
  own defaults as a second copy inside the engine, the exact shape `createDefaultLoopContent`
  exists to own alone.
- Copying the fader's write-on-every-drag-frame behaviour for the new knobs — that would put a
  knob's mid-drag value in a slice, which R016 forbids; the fader's behaviour is legacy, not a
  pattern to extend.

## Consequences

Existing projects open and export byte-identically: the golden `renderMixdownGolden.wav.sha256`
and `.calls.json` did not change on this branch. The Beat track can now feed delay and distortion,
a capability it never had before. `getSourceBus` throws when its three send gates are not yet
built, so the send-gates-before-buses construction order in `setupMasterChain` is a checked
precondition, not an implicit assumption. Node-building code for per-source sends lives in
`sourceSends.ts` rather than inline in `masterRack.ts`, which keeps that file under the `max-lines`
cap this change would otherwise have pushed past.

## Rules this implies

- **R301** — `trackSends` is per-loop content: in `LOOP_FLAT_KEYS` and the `mix` copy group, keyed
  by engine source id, levels linear 0..1; its default is written only in
  `createDefaultLoopContent` (the mixdown fixture is the one test copy).
- **R302** — `sanitizeTrackSends` validates `trackSends` on every loop read, row by row and field
  by field, with no version gate.
- **R303** — Each source bus reaches the three send gates only through its own three send nodes,
  taken after the fader and mute; there is no per-source exclusion set — the one exception is R304.
- **R304** — Beat has no bus→reverb send; its reverb is the per-voice path through `drumSendGate`
  into the Beat track's own reverb send node, connected as the convolver's second input after
  `reverbSendGate`.
- **R305** — A Beat voice's `reverbSend` multiplies the Beat track's reverb send; it is not a
  direct send to the master reverb.
- **R306** — Sends reach the engine only through `engineSync`'s per-bus subscription and settle
  pushes, the drag preview module, and the mixdown's per-pass `setSourceSends`; never through
  `setSourceState`, and never keyed on solo or audibility.

## Sources

DEV-423; `docs/superpowers/specs/2026-09-22-dev-423-per-track-sends-design.md`;
`docs/superpowers/plans/2026-09-22-dev-423-per-track-sends.md`.
