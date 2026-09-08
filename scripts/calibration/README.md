# Calibration harness (DEV-387)

Regenerates `src/data/trimTable.ts` — the committed, measured trim every drum kit
and every synth preset ships with, so all of them land within 3 dB of −18 dBFS
instead of wherever they happened to be tuned by ear.

The table does **not** rewrite `src/data/drumKits.ts` or `src/data/synthPresets.ts`.
Those numbers stay as authored, so the diff of a retune is still readable; the
measured trim multiplies on top, in `src/audio/trims.ts`.

## When to re-run

- A drum-kit voice's `gain`, envelope, pitch or filter changed.
- A synth preset's params changed, or `INITIAL_SYNTH_PARAMS` / `DEFAULT_DRUM_KIT` did.
- A kit, a voice or a preset was added or removed.
- `bun run check:levels` failed — it means one of the above happened without a re-run.

You do **not** need to re-run for a rename, a colour, a description, a `provenance`,
a `reference`, an arpeggiator default, or a `reverbSend`. Those are excluded from the
config hash on purpose: an over-broad hash fires on cosmetic edits and trains people
to regenerate without thinking. See `loudnessConfig.ts` for the exact field lists and
the reasoning.

## What a flag means

A flagged entry — a trim past ±12 dB, the fader's own range (`FADER_MAX_DB`) — is
**not a failure**. It is not clamped and the run is not blocked; the generator writes
the honest number and moves on. Today there is exactly one: the synth preset
`factory-cyber-drone` needs +13.3 dB. That says the patch is unusually quiet, not that
the harness is wrong — its trim is applied at the engine, not through a physical
fader, so a value past what a fader could give is still honoured. Investigate every
flagged entry before shipping a run: it is either a genuine outlier (its own product
decision, possibly its own issue) or a harness artefact, and the difference is a
judgement call a human makes, not a threshold the generator can decide on your behalf.

## Why the drum trim is per kit, not per voice

`DRUM_TRIMS` is keyed by kit name and holds one trim for the whole kit, not one per
voice. This was a mid-branch reversal, and the measurement that settled it is worth
repeating here because someone will eventually propose changing it back: Trap Beat
renders kick −13.7, snare −19.7, hihat −47.5, ride −45.9 dBFS — a 33.8 dB span
*inside one kit*. That span is the kit's identity, not noise to remove. A per-voice
normalisation pass wanted +29.5 dB on that hihat, and applying it would have closed
the 34 dB gap to roughly zero on all thirteen kits, flattening every one of them into
sounding the same. Per-voice normalisation is the right model for independent
instruments — which is why the acceptance criterion was originally written that way,
by analogy with synth presets — but a drum kit's voices are not independent: their
relative levels against each other *are* the instrument. The kit-level model instead
measures and trims the kit as a listener hears it, leaving every voice's internal
balance untouched; see the measured result below.

## The reference pattern and its known limit

Every kit is measured against the same fixed pattern (`DRUM_KIT_BAR` in
`renderOffline.ts`): a plain backbeat — kick on 1 and 3, snare on 2 and 4, closed
hihat on every 8th note — at 120 BPM over two bars, identical for all thirteen kits.
One shared pattern, deliberately, because comparability *between* kits is the whole
point of this table; measuring each kit against a pattern of its own would make "kit
A is quieter than kit B" ambiguous between "quieter kit" and "quieter pattern".

The choice of hihat density is not load-bearing: halving it moved kits by only −0.10
to −0.40 dB, against a ±3 dB tolerance. The kit this pattern represents least well is
**Warm Riddim**, a reggae one-drop whose identity is a rimshot on 3 with no kick on
beat 1 — the backbeat plays it in a shape it isn't voiced for and never sounds the
hit that actually carries it. That is tolerable only because the trim this produces
is a single scale factor applied to the whole kit: Warm Riddim's own internal balance
(rimshot vs. everything else) stays exactly as authored regardless of what shape it
was measured in.

## Render duration is load-bearing for the median, not just the gate

`ebur128`'s short-term (`S:`) reading is a rolling 3-second window: ffmpeg reports a
fixed ~−120.7 LUFS sentinel for every frame until 3 s of audio has accumulated,
whatever the real level. That sentinel is filtered **on value** (`> -100 LUFS`),
never on the frame's `t:` timestamp — ffmpeg's frames land at 0.0999792, 0.1999792,
… 2.99998, never on an exact boundary, so a `t >= 3` cutoff would clip early and lose
a valid frame.

Beyond clearing that gate, the render length is chosen so the median lands inside the
loud plateau with a few frames of margin, not by how long feels sufficient. The kit
render (`DRUM_KIT_RENDER_SECONDS = 5`) yields 21 valid short-term frames; the pattern
plateau covers 13 of them, and the median index (`sorted[floor(21/2)]` = index 10)
lands three frames inside that plateau. Shortening the render "to save time" moves how
many tail frames survive the gate and would move every committed number by roughly a
dB with nothing failing to say so.

## Why renders are seeded

The engine randomises noise on every render (the noise buffer fill and
`noiseStartOffset()` both draw from `Math.random()`). Measured over five unseeded
runs, hihat's level spanned 0.7 dB — against a table that rounds to 0.01 dB, 70x the
granularity. Without seeding, regenerating an unchanged catalogue would silently
rewrite `measuredDbfs`/`trimDb` for every noise-using voice, and the lock test would
never object, because it compares config *hashes*, not measurements. `src/audio/rng.ts`
seeds the harness's RNG stream (`CALIBRATION_SEED` + `mulberry32`) so a re-run of an
unchanged catalogue reproduces byte-identical audio, proven by the smoke checks.

## Why the render runs with headroom

A drum kit's reference pattern sums up to nine simultaneous voices (kick, snare and
hihat overlapping by the pattern's own design) and, uncalibrated, peaked at a float
value of 1.55–2.02 before this was fixed — well past the WAV encoder's ±1.0 clamp. A
calibration harness quietly distorting the signal it measures is exactly the failure
this issue exists to prevent, so the kit render runs `CALIBRATION_HEADROOM_DB` (12 dB)
below unity and the measure functions add the same amount back onto the measured
reading before computing the trim — `ebur128` reports the loudness of what was
rendered, so subtracting headroom pre-render and adding it back post-measurement
recovers the true level exactly. Synth presets play one voice at a time and cannot
clip this way, which is why only kits carry this compensation. It was got wrong once —
an earlier version returned the raw attenuated measurement and left every call site to
remember to add the headroom back, and the first real `verifyApplied` run measured
every kit ~12 dB low as a result — so the compensation now lives inside
`measureDrumKit`/`measurePreset` themselves, and no call site imports the headroom
constant or ever holds a raw attenuated value.

## Positive trims move kits closer to full scale on live playback

The harness needs `CALIBRATION_HEADROOM_DB` (12 dB) because a *trimmed* kit reference
render peaks at a float 2.02 — but that headroom exists only inside the harness. Live
playback has no such headroom. As of DEV-383, `limiterEnabled` defaults to `true` and
`compressorEnabled` stays `false` (`src/store/initialState.ts`) — but the limiter's
-3 dB threshold, paired with the -6 dB source-bus default, is tuned to catch occasional
peaks, not compress continuously, so a kit with a positive trim — Tight Pocket at
+3.7 dB, Lo-Fi Vinyl at +3.2, Warm Riddim at +2.7 — can still push a dense groove into
the limiter more than it did before calibration. This is a consequence of calibration
doing its job, not a defect: those kits were quietly too quiet before, and the trim
raises them. Pre-existing in kind — Retro Drive already peaked at a float 1.55
uncalibrated — but calibration moves several kits further in that direction at once,
and it is worth knowing before assuming a dense-groove clip is a new bug. The harness
itself always renders with both dynamics stages forced off (see `renderOffline.ts`), so
this observation is about live playback only and does not affect the committed trim
table.

## `node-web-audio-api` is pinned, not ranged

Every other devDependency in `package.json` uses a `^` range; this one is pinned to
an exact version on purpose. It is the only dependency whose version can silently
change *committed measured numbers*, because the trim table is this package's render
output — a routine `bun update` could shift every measurement in a regenerated table
with nothing in the diff explaining why. Leave the pin as-is when updating other
dependencies; bumping it is its own deliberate, reviewed change.

## "No valid LUFS readings" is not always a duration bug

It can also mean the voice is genuinely silent in production, not just in the
harness. Before assuming a harness fault, run `bun run dev` and confirm the voice
actually sounds in the app.

## How to re-run

1. `bun run calibration:generate`. 13 kits + 29 presets; expect a couple of minutes —
   each is a real `OfflineAudioContext` render plus an ffmpeg pass. The generator
   collects every failure and refuses to write the table if any occurred, rather than
   writing a partial one.
2. Investigate every `FAILED` line **before** touching the harness.
3. Investigate every flagged entry (see "What a flag means" above). Never clamp the
   number to make the line go away: `check:levels` asserts the ±3 dB guarantee from
   these same numbers, so a clamp would break it silently.
4. `git diff src/data/trimTable.ts` — confirm only the expected entries moved.
5. `bun run calibration:verify` — re-renders representative kits/presets with the
   trim applied and measures them again. This is the end-to-end proof; `check:levels`
   only proves the recorded arithmetic.
6. By-ear A/B a few changed voices in `bun run dev`.
7. `bun run verify`, then commit.

## What runs where

| Command | Renders? | ffmpeg? | Cost | In `verify`? |
|---|---|---|---|---|
| `bun run calibration:generate` | yes | yes | minutes | **never** |
| `bun run calibration:smoke` | yes | no | seconds | no |
| `bun run calibration:verify` | yes | yes | seconds | no |
| `bun run check:levels` | no | no | milliseconds | **yes** |
| `bun test scripts/calibration/trimTable.lock.test.ts` | no | no | milliseconds | yes |

The generator and the two `*.smoke.ts` files are manual and need ffmpeg and the
native addon; `check:levels` and the lock test run in CI in milliseconds and need
neither. The render-driving files are named `*.smoke.ts` rather than `*.test.ts`
precisely so Bun's test globs never pick them up — renaming one to `.test.ts` would
put the native addon and ffmpeg back on the `bun test` critical path.

## Architecture

Two stages.

1. **Render** — `renderOffline.ts` drives the **real** `AudioEngine` against a
   `node-web-audio-api` `OfflineAudioContext`, through the seam `src/audio/testFakes.ts`
   already establishes (`makeEngine()`, then assign the private `ctx`). Measuring a
   model of the engine instead of the engine would measure the model. The three
   parallel sends are zeroed so the measurement is the dry voice; the EQ stays in
   circuit because it is always-on, but the compressor and limiter are both off,
   matching the master chain a fresh session actually starts in.
2. **Measure** — `measureLoudness.ts` shells out to `ffmpeg -af ebur128 -f null -`
   and takes the **median** of every valid short-term (`S:`) reading. Median, not
   mean, so one anomalous frame cannot skew a committed default. ffmpeg comes from
   `PATH`, not a bundled installer package: this epic commits to exactly one new
   devDependency and the harness is manual.

## Patterns

- **Drum kit:** the shared backbeat (`DRUM_KIT_BAR`, see above), two bars at 120 BPM,
  rendered for `DRUM_KIT_RENDER_SECONDS = 5` s with `CALIBRATION_HEADROOM_DB` of
  render headroom.
- **Synth preset:** 6.5 s, four notes on `C3` at velocity 1.0, note-on every 1.5 s
  with a 1.3 s gate. A pad with attack up to ~1.0 s reaches sustain inside the gate,
  and a pluck still puts four attacks inside every 3 s window instead of one attack
  and six seconds of silence.

Both are sized by the EBU gate and median-plateau reasoning above, not by taste.

## Known pitfalls

- **EBU R128's 3-second gate** — see "Render duration is load-bearing" above.
- **"No valid LUFS readings" is not always a duration bug** — see above.
- **`PRESET_TRIMS` is keyed by preset id, but the engine only sees `params.preset`,**
  which `applyPreset` sets to the preset **name**. `src/audio/trims.ts` bridges that
  with an index built over the factory library. A user preset that reuses a factory
  patch's name inherits that patch's trim — bounded, documented, and the reason
  `src/audio/trims.test.ts` asserts factory names are unique.
- **A trim is a default, not live auto-gain.** Turn a preset's cutoff knob and the
  patch keeps its measured trim. That is intentional; live measurement-driven trim is
  a different feature.
