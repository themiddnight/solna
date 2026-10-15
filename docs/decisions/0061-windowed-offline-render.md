# ADR-0061: The offline render builds its graph in windows

**Status:** Accepted — 2026-10-15

## Context

The WAV export took longer than the song it exported, and the gap grew with the song. Measured in
Chrome on the default project: 14.8 s of audio rendered in 4.2 s, and the same project repeated to
49.1 s rendered in 43.7 s. That is 3.3 times the audio for 10 times the time.

`renderSongBuffer` (`src/audio/export/renderMixdown.ts`) performed the whole song walk, so it built
every synth and drum voice of the song, before `startRendering()`. A voice's chain (sources, drive,
filter, gains, panner) is part of the rendering graph from the moment it is built, and the renderer
processes it on every quantum until it ends. With progress timestamps at every 2% of the render,
the first segment cost 1.6 s and the last 0.3 s: each quantum paid for every note still to come.

Two smaller costs added to it. A finished synth voice was never disconnected offline
(`SynthVoiceManager` rule 3, because teardown ran before sample zero), so dead chains stayed
attached. With the walk windowed, that was the remaining growth: per-segment cost rose from 1.4 s
to 3.1 s over a 49 s render, and was flat once the dead chains were cut.

## Decision

1. `renderSongBuffer` builds the graph in windows. `renderCheckpoints` places a checkpoint every
   `min(1 s, 2% of the render)`, mid-quantum and one per quantum. Before rendering, the walk is
   performed up to the first checkpoint plus `SCHEDULE_LOOKAHEAD_SEC`. Each checkpoint suspends
   the render, publishes progress, cuts ended synth voices, performs the walk up to the next
   checkpoint plus the lookahead, and resumes. One walk generator spans every window, so the item
   order (R288) and the RNG interleaving do not change. A host without `suspend`/`resume` performs
   the whole walk first, as before.
2. The progress checkpoints and the scheduling checkpoints are the same suspends. Two suspends in
   one quantum reject, so they cannot be separate lists.
3. `SCHEDULE_LOOKAHEAD_SEC` is two checkpoint spacings. node-web-audio-api occasionally rejects a
   suspend registered before rendering (once in several hundred renders, cause not found). A lost
   checkpoint costs one progress update: the next checkpoint that lands finds its window already
   built ahead of the render position, even after two lost in a row.
4. One `mulberry32(MIXDOWN_SEED)` generator serves the whole render. `withRandomSource` (`rng.ts`)
   installs it around each window's synchronous performance and restores the default after, so the
   seeded stream is never installed while the render itself awaits.
5. Offline, `SynthVoiceManager` keeps each forgotten group with the instant its sources stop.
   `disconnectEndedOffline(renderedTo)`, reached through `AudioEngine.disconnectEndedVoices`, cuts
   every group that ended at or before `renderedTo`. The renderer calls it at each checkpoint with
   the checkpoint time minus `ENDED_VOICE_MARGIN_SEC` (1 s), so the cut falls after the filter's
   ring has died away and does not depend on which checkpoints landed. No timer cuts an offline
   voice. This amends rule 3 of `voiceManager.ts` and the offline teardown in
   [ADR-0021](0021-shared-live-and-offline-render.md): the group is still forgotten at once; only
   the cut moved.
6. `holdSourceNodes` keeps every oscillator, buffer source and constant source the render creates
   reachable until the render ends. node-web-audio-api frees a node's native half when its JS
   wrapper is collected. Once voices are built mid-render, the collector runs between windows, and
   the golden WAV took a different hash on every run. A browser keeps a scheduled node alive by
   itself, so this costs it only the wrappers.
7. `DrumSynth.wireDrumVoice` seeds a drum's reverb send from the track's last-set level
   (`drumTrackLevels`), not from `track.gain.value`. Built mid-render, `gain.value` reads the
   param at the render position (node-web-audio-api returned NaN there). Before rendering it read
   the level the node was created with, so the export ignored every later loop's drum fader on the
   reverb feed.

### Rejected

- **A worker or chunked renders stitched together.** Several contexts would split the reverb and
  delay tails at every seam, and the master dynamics would restart per chunk.
- **Separate progress and scheduling suspends.** Two suspends in one quantum reject, and the
  quantum each lands on depends on the host's rounding.
- **Registering each suspend inside the previous one's callback.** node-web-audio-api rejects a
  suspend registered while suspended, every time (30 of 30 in a probe).
- **Retaining every voice group in the voice manager and the LFO bank instead of the renderer.**
  Drum voices were collected too, so it would have been three owner-specific lists for one
  render-wide fact.

## Consequences

- Render time now grows with the song's length. Same snapshot, same Chrome tab, warm: 11 s of audio
  took 4.3 s before and 1.7 s after; 35 s took 30.0 s before and 5.9 s after; 131 s took 443.2 s
  before and 25.0 s after.
- The golden WAV changed once, in its own commit. With source nodes held, the windowed render is
  sample-identical to building the whole walk first. The old hash differed because
  node-web-audio-api had freed collected source nodes during that render. The call log did not
  change.
- An export can be cancelled during rendering: a checkpoint that sees the abort stops building,
  the rest renders as silence, and the result is `cancelled`.
- A future engine path that reads `ctx.currentTime` or a param's `.value` while scheduling sees the
  render position, not zero. Every scheduled time stays an argument (R207).

## Rules this implies

- **R374** — The offline render performs the song walk in windows at `renderCheckpoints`, each up
  to the next checkpoint plus `SCHEDULE_LOOKAHEAD_SEC`; only a host without `suspend`/`resume`
  performs it before `startRendering`. Progress is published from the same checkpoints.
- **R375** — One seeded generator spans the whole render and is installed only around each window's
  synchronous performance (`withRandomSource`), never across the render's awaits.
- **R376** — Offline, an ended synth voice is cut only by the renderer
  (`disconnectEndedVoices`), at a checkpoint at least `ENDED_VOICE_MARGIN_SEC` past its end; no
  timer cuts an offline voice.
- **R377** — The offline render holds every source node it creates until the render ends
  (`holdSourceNodes`).
- **R378** — A drum voice's reverb send is seeded from the track's last-set level, never from the
  track node's `gain.value`.

## Sources

Branch `fix/wav-export-windowed-schedule`; the measurements above were taken in the Claude desktop
browser pane against the dev server on 2026-10-15.
