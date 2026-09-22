# ADR-0038: Dry stems: one render, bus taps, one ZIP

**Status:** Accepted — 2026-09-22. DEV-429

## Context

Users mixing a song outside Solna want each track as its own audio file, not just the finished
mix. ADR-0037 item 13 already fixed the tap point for this future export: "dry, tapped at the bus
after its fader; sends are ignored for the stem output." The export feature is kinds-as-data
(ADR-0035) and downloads exactly one `Blob` per job; the renderer is shared between the live graph
and offline mixdown (ADR-0021), and its golden hash and call log must not move for any reason —
stems are additive, never a rewrite of what already ships.

## Decision

1. A stem is its source bus's output after the fader and mute, per loop, exactly as the mixdown
   automates them. Beat's stem includes the per-voice track faders and the drum filter bank. A
   stem carries no send (delay, reverb, distortion), no Beat per-voice reverb feed, no master-rack
   stage (EQ, compressor, limiter, reverb, delay, distortion, master gain) and no solo.
2. One `STEM_CHANNELS`-channel offline render, not one render per bus: a stereo `'speakers'` tap
   per bus lands on channels `2i`/`2i+1`, and the master is built identically (so its seeded reverb
   impulse still draws from the RNG stream) but connected to an unconnected sink instead of the
   destination.
3. Same seed, walk, sample rate, bit depth and length as the mixdown, so a stem dropped at 0:00 in
   a DAW lines up with the mixdown sample for sample.
4. A stem is written iff a walk event targets its bus during the render: a muted track with content
   is still written (near-silent); a track with no content anywhere is omitted; if no track has any
   content the export fails `empty-arrangement`.
5. No normalisation. The encoder hard-clips each sample at ±1, same as every other WAV export — a
   stem above 0 dBFS can clip where the limited mixdown does not, because the fader is the user's
   mix decision, not the renderer's to correct.
6. One `<slug>-stems.zip` holding `<slug>-{chord,bass,pad,lead,fx,beat}.wav`, in that order — the
   same track order the MIDI export already uses.
7. An in-house, store-only ZIP encoder (`zipStore.ts`): CRC-32, a UTF-8 name flag, DOS time set to
   the export time, no ZIP64, and a `RangeError` past any 32-bit size or offset limit.
8. Kind id `stems`, label "Export stems (WAV, .zip)", incident operation `'stems-export'`, MIME
   `application/zip`.
9. Two render-only engine opt-ins, neither of which the mixdown passes:
   `createRenderEngine(ctx, { masterOutput })`, which detaches the master rack's last stage from
   `ctx.destination`, and `connectSourceStem`, one more edge off a bus output beside the dry and
   send edges.
10. `renderSongBuffer` becomes the shared body of `renderMixdown` and `renderStems`: the seeded
    build-and-walk that today's mixdown already performs, now taking a channel count and the two
    opt-ins as arguments instead of hard-coding stereo and the realtime call sequence.

## Rejected alternatives

- **Six renders, one bus each** — six times the CPU of a mixdown on every export, including six
  separately seeded reverb impulses. Kept as the recorded fallback: if incidents under
  `'stems-export'` show allocation failures on long songs, this is the next thing tried, since it
  trades memory for CPU instead of the other way around.
- **Skipping a stem by audibility** (the MIDI export's `eventAudible` rule) — not clean for audio: a
  note triggered while its bus is muted still has a release tail that sounds once a later pass
  unmutes it, so "no audible event" does not mean "no non-silent audio."
- **Skipping a stem by sample content** (write it only if every rendered sample is exactly 0) — a
  later-pass mute is a `setTargetAtTime` ramp, so a muted-with-content bus approaches zero and never
  exactly reaches it; the rule would depend on float underflow.
- **Always writing all six files** — a store-only ZIP pays full, uncompressed size for a silent
  track for no benefit.
- **Six separate downloads** — the export runner already owns one download per job; a kind returns
  one `Blob`, never several.
- **An npm ZIP dependency, or a shared `src/utils/zip.ts`** — `zipStore.ts` has exactly one
  consumer today; it stays with the feature until a second layer needs it, the same placement rule
  that keeps `smfWriter.ts` beside the MIDI export.

## Consequences

The mixdown's golden hash and call log are unchanged: every opt-in `renderSongBuffer` takes is
omitted by `renderMixdown`, so its call sequence is exactly what the golden already recorded. Peak
memory for a stems export holds three things at once until `renderStems` returns: the 12-ch
float32 buffer (≈ 127 MB per minute of song), the six encoded WAVs held in `entries` (≈ 63.5
MB/min), and `new Blob(encodeZipStore(entries, modified))`, which copies that same WAV payload
again in a browser (another ≈ 63.5 MB/min) — about 254 MB per minute of song (≈ 0.76 GB for a
3-minute song). A song long enough to exhaust that allocation fails as `render-failed` with an
incident, never a corrupt or partial file. Stems share the mixdown's length rule, so a `reverbDecay` change moves both — it sets
the render's tail length and reseeds the reverb impulse before the walk, shifting every later random
draw. `renderStems.ts` joins the list of walk consumers R287 already names for `renderMidi.ts`.

## Rules this implies

- **R307** — A stem is its source bus's output, after the fader, mute and (Beat) drum filter bank
  and voice faders, tapped by `connectSourceStem`; it contains no send, no Beat per-voice reverb
  feed, no master-rack stage and no solo.
- **R308** — Stems are one offline render: a `STEM_CHANNELS`-channel context, stem *i* on channels
  `2i`/`2i+1`, the master rack's output detached, with the mixdown's seed, walk, sample rate, bit
  depth and length.
- **R309** — Stem wiring is opt-in: `createRenderEngine(ctx)` without options and `renderMixdown`
  keep the call sequence the golden records; the golden is never re-recorded for stems.
- **R310** — A stem is written iff a walk event targets its bus; mute never decides it; none at all
  is `empty-arrangement`. No normalisation; samples clamp at ±1.
- **R311** — Stems download as one store-only ZIP from `zipStore.ts` (method 0, CRC-32, no ZIP64,
  throws past 32-bit limits), `<slug>-stems.zip` with `<slug>-<track>.wav` in `STEM_TRACKS` order;
  no npm ZIP dependency.

**Amends [ADR-0034](0034-pure-song-event-timeline.md): R287** — the "one place an arrangement
becomes timed events, no lane planner" guarantee now also names `renderStems.ts`, which consumes
the walk only through `renderSongBuffer`.

## Sources

DEV-429; `docs/superpowers/specs/2026-09-22-dev-429-dry-stems-design.md`;
`docs/superpowers/plans/2026-09-22-dev-429-dry-stems.md`; ADR-0035, ADR-0036, ADR-0037.
