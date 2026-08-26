# Automation Player Transport — Design

Date: 2026-08-26
Status: Approved, not yet implemented
Scope: Project A of three (B = Vibe Variation Engine, C = Keyboard Chord Mode — both out of scope here)

## Problem

Stopping the Chords player leaves sound hanging until the current bar ends,
while the Beat player appears to stop instantly. This is not a difference in
stop logic — `useChordPlayback` schedules a whole chord ahead of time at
absolute `AudioContext` times, so clearing `isChordsPlaying` merely
unsubscribes the clock and the already-queued voices keep ringing. Drums only
seem better behaved because they are one-shots that have already decayed.

Three consequences follow from the same root cause:

1. There is no way to cut a player immediately.
2. There is no way to stop musically (finish the bar, then stop) on purpose.
3. Switching Instant Vibe mid-playback overlaps the old progression with the
   new one, because nothing silences the queued voices before the swap.

Separately, playback can only be driven from inside the owning tab, and the
tab bar does not distinguish the two automation players (Beat, Chords) from
the two non-automation views (Synth, Master FX).

## Goals

- Two distinct stop semantics per player: **soft** (stop at the next bar line)
  and **hard** (cut now).
- Beat and Chords behave identically. No asymmetry.
- Drive either player from the header, without switching tabs.
- Changing Instant Vibe mid-playback swaps cleanly, never overlaps.
- Beat and Chords stay on one shared bar grid.

## Non-goals

- Phrase alignment (entering at bar 1 of a 4-bar phrase). Players align to the
  next **bar** line, not to a phrase boundary.
- Cancelling a pending soft stop. Once `stopping`, the only exits are the bar
  line or a hard stop.
- Tracking drum nodes so hard stop can cut them (see Accepted limitations).

## Architecture

### Player state machine

Replaces the two transient booleans in `transportSlice`:

```ts
type PlayerState = 'stopped' | 'playing' | 'stopping'
// sequencerPlayer: PlayerState
// chordsPlayer:    PlayerState
```

Both fields stay transient (excluded from `partialize`), so no store version
bump and no migration.

| action | stopped | playing | stopping |
| --- | --- | --- | --- |
| `play(m)` | → playing | — | — |
| `softStop(m)` | — | → stopping | — |
| `hardStop(m)` | — | → stopped | → stopped |

Master actions `playAll()` / `softStopAll()` / `hardStopAll()` apply the
per-module action to both players.

### Derived UI state

```
isActive(m)        = player(m) !== 'stopped'
aggregate          = any playing            -> 'playing'
                     any stopping, none playing -> 'stopping'
                     otherwise              -> 'stopped'
hardStopEnabled    = isActive('sequencer') || isActive('chords')
```

`hardStopEnabled` is deliberately **not** derived from `aggregate`: whenever
any sound is still scheduled — playing or stopping — hard stop is available.

Known corner case, accepted: when exactly one player is `stopping` and the
other is `stopped`, `aggregate` is `stopping`, so the TransportBar's left
button is disabled. Starting the other player during that window is done from
the header.

### Audio layer

Two small additions; no new DSP.

1. `engine.ts` — `stopSource(source, releaseTime = 0.1, time?: number)` gains
   an optional `time`, defaulting to `ctx.currentTime`. The existing method
   already silences both sounding and future-scheduled voices of a source, and
   `releaseVoice` already handles a `now` in the future.
2. `playback/playbackEngine.ts` — export `playbackStopSource(source,
   releaseTime, time)`, following the same bridge pattern as
   `playbackNoteOn` / `playbackNoteOff`.

Engine calls stay out of components: the playback hooks reach the engine only
through `playbackEngine.ts`, exactly as they already do for note events.
`engineSync.ts` remains reserved for store-state -> engine-setting sync.

### Who executes a stop

Each playback hook owns every engine call for its own player.

- **Hard** — an effect observing the transition to `stopped` calls
  `stopSource` at `currentTime` with a short release (~0.02s).
- **Soft** — while the player is `stopping`, the clock callback waits for
  `step % STEPS_PER_BAR === 0`, calls `stopSource(source, release, time)` with
  the clock's scheduled `time`, then sets the player to `stopped`.

Release times are not interchangeable. Hard stop passes a fixed `0.02`s so the
cut is immediate without clicking. Soft stop passes the player's own configured
release — `chordSynthParams.release` for `'chord'` and `bassSynthParams.release`
for `'bass'` — so the last chord decays the way it would have anyway.

Because the soft path also lands on `stopped`, the hard-path effect would fire
a second, immediate `stopSource` and clip the tail. The hook guards this with a
`pendingSoftStopRef` that the effect checks and clears.

The Chords player stops **two** sources: `'chord'` and `'bass'` (the bass line
is driven by the chord player). The Beat player calls `stopSource` for nothing
— it only stops scheduling.

### Shared bar grid

`audioEngine` already exposes one clock to all listeners, and `engineSync`
calls `resetClock()` only on the fully-stopped -> playing transition, so a
player joining while another is running lands on the same bar grid.

The 1/2/3-encoded subscription at `engineSync.ts:89` must be ported to the
three-state model with **"fully stopped" defined as both players `stopped`** —
a `stopping` player still counts as active. Getting this wrong would reset the
grid mid-flight when a player is soft-stopped and restarted.

### Instant Vibe swap

`applyInstantVibeToStore` is wrapped so the swap is atomic:

1. Record which players are active.
2. `hardStopAll()`.
3. Apply the vibe (existing body, unchanged).
4. `play()` only the players that were active.

No alignment code is needed — both hooks arm on `step % STEPS_PER_BAR === 0`,
so the restart lands on the next bar by construction.

## UI

### `components/ui/PlayerTransport.tsx` (new)

Props: `state`, `onPlay`, `onSoftStop`, `onHardStop`, `showHardStop`, `size`.

Exports a pure `resolveTransportButtons(state)` returning icon, class, title
and disabled flags, so button behaviour is unit-testable without rendering —
matching the repo convention (`resolveInitialTheme` in `Header.tsx`).

Roles only, no colours: `btn-success` (play), `btn-warning` (soft stop and
`stopping`, the latter with `animate-pulse`), `btn-error` (hard stop).

### Header — per-player, `showHardStop={false}`

```
[Synth]  |  [Beat][play] [Chords][play]  |  [Master FX]
```

- `Synth` moves into its own `tabs-box` group, mirroring `Master FX`, so the
  middle group reads as "the automation players".
- Each automation entry is a daisyUI `join` of the tab button and the play
  button, **side by side**. Nesting a `<button>` inside a `<button>` is invalid
  and breaks assistive technology.
- States: `stopped` -> play (enabled) · `playing` -> soft stop (enabled) ·
  `stopping` -> "Stopping" (pulsing, disabled).
- The separate green ping dot is removed; the play button now carries state.

### TransportBar — aggregate, `showHardStop`

```
[Play / Soft Stop / Stopping…]  [Hard Stop]
```

- States: `stopped` -> [play enabled] [hard stop disabled] · `playing` ->
  [soft stop enabled] [hard stop enabled] · `stopping` -> [stopping, pulsing,
  disabled] [hard stop enabled].
- `hardStopEnabled` follows the rule above, not `aggregate`.
- The existing "Tab Specific Play" button is removed — the header supersedes it.

### ChordView / SequencerView

Unchanged. No in-view transport controls; the header and the TransportBar
cover every case.

## Files touched

| Layer | Files |
| --- | --- |
| audio | `engine.ts`, `playback/playbackEngine.ts` |
| store | `types.ts`, `transportSlice.ts`, `engineSync.ts`, `instantVibes.ts` |
| hooks | `components/chord/useChordPlayback.ts`, `components/useSequencerPlayback.ts` |
| ui | `components/ui/PlayerTransport.tsx` (new), `Header.tsx`, `TransportBar.tsx` |

Existing consumers of `isSequencerPlaying` / `isChordsPlaying` that must be
ported: `SequencerView.tsx:31`, `Header.tsx:89-90`, `useSequencerPlayback.ts:25`,
`TransportBar.tsx:13-14`, `useChordPlayback.ts:50`, `engineSync.ts:89`.

## Testing

Pure-logic `bun:test`, no DOM, per repo convention.

1. **`transportSlice`** — every cell of the transition table for both players;
   master actions; `aggregate` for all nine state pairs; `hardStopEnabled`.
2. **`resolveTransportButtons`** — icon, class and disabled flags per state,
   with and without `showHardStop`.
3. **`engineSync`** — `resetClock` fires on fully-stopped -> playing and does
   **not** fire while a player is `stopping`. This is the shared-bar-grid
   invariant.
4. **`applyInstantVibeToStore`** — hard-stops both players, applies the vibe,
   and restores `playing` only for players that were active beforehand.

`bun run verify` is the gate. `bun run eslint` must also be run, since the
change adds cross-layer imports.

## Accepted limitations

- **One stray drum hit after hard stop.** `triggerDrum` builds fire-and-forget
  nodes that are not tracked in `sourceVoices`, so `stopSource` cannot reach
  them. With `CLOCK_LOOKAHEAD = 0.1`, at most one already-scheduled hit can
  sound, no later than 100ms after the press. Tracking drum nodes or gating a
  drum bus is not worth the complexity for that window.
- **Soft stop truncates multi-bar chords.** A chord with `bars: 2`
  soft-stopped during its first bar ends at that bar line. This follows
  directly from the chosen "stop at the next bar line" semantics.
- **Bar-aligned, not phrase-aligned.** Starting a player mid-loop enters on the
  next bar, which may be any bar of the running phrase.
