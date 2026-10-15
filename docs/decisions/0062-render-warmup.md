# ADR-0062: The offline render warms up before the song

**Status:** Accepted — 2026-10-15

## Context

An exported WAV faded in over its first fraction of a second. Measured in Chrome on the default
project, the first 100 ms of the mixdown had an RMS of 0.070 with the factory limiter on and 0.137
with the master dynamics off. The same window of the loop's second pass was 0.183 and 0.186: the
limiter barely touched it there.

A browser's `DynamicsCompressorNode` starts in a state it releases from with context time, not with
input. In an isolated Chrome probe, a 220 Hz tone 17 dB under a −3 dB threshold, release 0.15 s,
came out 8 dB low in its first 50 ms when it started at context time zero, and at full level from
its first window when it started at 0.5 s or 1 s. With release at its 1 s maximum it took about
1 s. Live playback never shows it, because the context has been running long before the transport
starts. node-web-audio-api does not reproduce it, so no test here can.

A second, smaller artefact had the same cause. Every master parameter (`setMasterVolume`,
`updateEffects`) glides from the node's default to the project's value with a 50 ms time constant
from context time zero. A project whose master volume was below 0 dB started too loud: at half
volume, the first 50 ms measured 0.88 of the unity render instead of 0.5.

## Decision

1. `renderSongBuffer` starts the song `RENDER_WARMUP_SEC` into its context and trims those frames
   off the rendered buffer (`trimWarmup`) before the mixdown encodes it or the stems split it. The
   file starts on the song's first sample and has the same length as before.
2. `RENDER_WARMUP_SEC` is the longest release a project can set
   (`EFFECT_LIMITS.compressorRelease.max`, `EFFECT_LIMITS.limiterRelease.max`), read from the limits
   so it follows them. That also outlasts the 50 ms master glides.
3. Every render-timeline time is offset by it: `planLoopAudioAutomation` takes the song start,
   `performTimelineEvent` adds it to each event, and the scheduler's horizon compares on the render
   timeline. The song-level settle in `applyMasterState` stays at time zero.
4. The first pass settles its source-bus state and sends because it is the first pass
   (`previous === undefined`), no longer because its time is zero.
5. The render holds every node its context creates, not only the sources (`holdRenderNodes`
   replaces `holdSourceNodes`, amending R377 of [ADR-0061](0061-windowed-offline-render.md)). It
   wraps every `create*` factory on the context. With the song moved past the warm-up, the golden
   WAV took a different hash on most runs. That held with every wall-clock timer stubbed out, and
   with no lost checkpoint. It was stable with the cut of ended voices turned off, and stable with
   every node held and the cut on. A cut voice's gains and filters lose their last reference, and
   node-web-audio-api frees a node's native half when its wrapper is collected. Holding them makes
   the cut byte-neutral: the held render matches the uncut one.

### Rejected

- **A silent bar at the start of the file.** It hides the fade only if the bar is long enough for
  the release, it changes the file's length and timing for anyone lining it up in a DAW, and the
  silence is not part of the song.
- **Settling the master parameters at time zero** (`setValueAtTime` instead of `setTargetAtTime`
  for the render). It fixes the volume glide but not the compressor, whose state no parameter
  reaches.
- **A fade-free compressor of our own.** A second dynamics implementation for the render only is
  exactly what R209 forbids.

## Consequences

- The fade is gone in Chrome: the first 100 ms of the default project measure 0.153 with the
  limiter and 0.155 without, against 0.070 before. Master volume holds from the first sample.
- A render costs one more second of audio.
- The golden WAV and its call log changed once, in their own commit: every render-timeline time in
  the log moved by `RENDER_WARMUP_SEC`.
- A test that reads engine-call times reads them on the render timeline, `RENDER_WARMUP_SEC` after
  song time; a test that reads output samples reads song time.

## Rules this implies

- **R377** (amended) — The offline render holds every node it creates until the render ends
  (`holdRenderNodes`, every `create*` factory).
- **R379** — The offline render starts the song `RENDER_WARMUP_SEC` into its context and trims the
  warm-up from the buffer it returns; the warm-up is never shorter than the longest dynamics
  release `EFFECT_LIMITS` allows.

## Sources

Branch `fix/wav-export-windowed-schedule`; the measurements above were taken in the Claude desktop
browser pane against the dev server on 2026-10-15.
