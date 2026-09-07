# Drum-grid genre survey — what the library holds vs. what the genres are

Measured 2026-09-06 against `src/data/drumGrids.ts` at `00a61f1` (22 grids).
Web research covered 16 genres; every pattern below carries a source.

Format: step index lists, 0-based. 4/4 bars are 16 steps, 3/4 and 6/8 are 12.

## Part 1 — the library's own shape

Distinct patterns are counted by hit-index list, so the same hit positions in a 12-step and a
16-step bar count as one. Counting by array value instead gives kick 13 and openhat 10; every
other row is unchanged. The design spec uses array value and records why.

| row | distinct patterns across 22 grids |
| --- | --- |
| kick | 12 |
| hihat | 11 |
| openhat | 8 |
| snare | 7 |

- `clap` is a byte-exact copy of `snare` in **16 of 22** grids.
- `hihat 2,6,10,14` is shared by 6 grids: house, dnb, dubstep, techno, reggae, edm-offbeat-pump.
- `hihat 0,2,4,6,8,10,12,14` is shared by 3: synthwave, funk, rock.
- `hihat 0,2,4,6,8,10` is shared by all 4 twelve-step grids.
- `trap` and `synthwave-four-on-floor` both have all 16 hihat steps on.

## Part 2 — app grid vs. sourced canonical pattern

Matches: **house, dnb, rock, edm-offbeat-pump** (4 of 12 checked).

| grid | row | app | sourced canonical |
| --- | --- | --- | --- |
| techno | hihat | 2,6,10,14 | 0-15 (rolling 16ths) |
| techno | openhat | 14 | 2,6,10,14 |
| synthwave | kick | 0,4,8,12 | 0,8,15 |
| synthwave | hihat | 0,2,4,6,8,10,12,14 | 0-15 |
| dubstep | kick | 0,12 | 0 |
| trap | kick | 0,8,10 | 0,6,10 |
| trap | hihat | 0-15 | 0,4,8,12 (rolls layered on top) |
| trap | openhat | 2,10 | 6 |
| boom-bap | kick | 0,6,10 | 0,6,8 |
| boom-bap | hihat | 0,2,3,4,6,7,8,10,11,12,14,15 | 0,2,4,6,8,10,12,14 |
| lofi-hip-hop | kick | 0,10 | 0,8 |
| lofi-hip-hop | hihat | 0,2,4,6,8,10,12,14,15 | 0,2,4,6,8,10,12,14 |
| funk | hihat | 0,2,4,6,8,10,12,14 | 0-15 |
| funk | openhat | 14 | 5,13 (the "e" of beats 2 and 4) |
| reggae | hihat | 2,6,10,14 | 0,2,4,6,8,10,12,14 |
| reggae | openhat | – | 14 |
| waltz | hihat | 0,2,4,6,8,10 | 0,4,6,8 (jazz-waltz ride figure) |
| afro-6-8 | snare | 4,10 | 1,4,7,10 (cross-stick) |
| afro-6-8 | hihat | 0,2,4,6,8,10 | 0,2,4,5,7,9,11 (standard bembé bell) |

## Part 3 — sourced patterns worth authoring as new grids

Each is expressible at the current resolution and distinguishable from what exists.

| id | steps | pattern | source |
| --- | --- | --- | --- |
| `techno-rolling` | 16 | kick 0,4,8,12 \| hihat 0-15 \| openhat 2,6,10,14 | attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/ |
| `synthwave-attack` | 16 | kick 0,8,15 \| snare 4,12 \| hihat 0-15 | attackmagazine.com/technique/beat-dissected/synthwave-drums/ |
| `dubstep-halftime` | 16 | kick 0 \| snare 8 | unison.audio/how-to-make-dubstep/ |
| `trap-quarter-hat` | 16 | kick 0,6,10 \| clap 8 \| hihat 0,4,8,12 \| openhat 6 | reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet |
| `boombap-8th-hat` | 16 | kick 0,6,8 \| snare 4,12 \| hihat 0,2,4,6,8,10,12,14 | attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/ |
| `lofi-ghost-kick` | 16 | kick 0,8,14 \| snare 4,12 \| hihat 0,2,4,6,8,10,12,14 | blog.native-instruments.com/lo-fi-hip-hop-beats/ |
| `funky-drummer` | 16 | kick 0,7,10 \| snare 4,12 \| hihat 0-15 \| openhat 5,13 | articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/ |
| `rock-driving-8th` | 16 | kick 0,2,4,6,8,10,12,14 \| snare 4,12 \| hihat 0,2,4,6,8,10,12,14 | fundamental-changes.com/learn-to-play-backbeat-on-drums/ |
| `reggae-rockers` | 16 | kick 0,4,8,12 \| snare 8 \| hihat 0,2,4,6,8,10,12,14 \| openhat 14 | soundbrenner.com/blogs/articles/rockers-rhythm |
| `bembe-standard-bell` | 12 | snare 1,4,7,10 \| hihat 0,2,4,5,7,9,11 | Jerry Leake, "Perspectives on the Standard African Bell" (uvic.ca) |
| `jazz-waltz-ride` | 12 | hihat 0,4,6,8 | studydrums.com/hsid/jzwalz01.html |

## Part 4 — what this grid structurally cannot hold

Ordered by how much of the genre is lost.

- **Zen garden** — not a documented percussion tradition at all. Searches surface karesansui
  gardens, ambient playlists and Midori Takada; nothing with canonical patterns. The nearest real
  East Asian idioms with notatable patterns (Miyake, Yatai-bayashi taiko) are dense ensemble
  music, the opposite of sparse. `zen-bamboo-pulse` is an invention, and should be labelled one.
- **Funk (Purdie/Stubblefield)** — ghost-note velocity IS the groove; the Purdie shuffle is
  8th-note triplets, not 16ths. A boolean straight grid turns a shuffle into something that is
  not a shuffle.
- **Trap** — the headline gesture is 32nd/triplet hat rolls. `0-15` is the ceiling of what 16
  steps can say, and it is not what trap's base hat actually plays.
- **Jazz waltz and Afro 6/8** — doubly blocked: the identity instrument (ride cymbal; bell)
  has **no row in the schema**, so the rhythm has to be smuggled onto `hihat`, and in real
  drum-set arrangements the bell and the hihat play *simultaneously*.
- **Boom bap / lo-fi** — swing is the distinction from generic straight hip-hop. Attack
  Magazine cites MPC swing at 57% (8ths) / 74% (16ths). Not storable.
- **Rockers vs steppers reggae** — identical on this grid; sources describe the difference as
  feel, not hit placement.
- **House vs trance/festival EDM** — literally identical (kick 0,4,8,12 / backbeat 4,12 /
  openhat 2,6,10,14). Sources separate them only by sound design and sidechain. This is the
  independent explanation for `edm-offbeat-pump` == `house` in the library today.
- **Survives intact**: Rock. Its identity really is a kick/snare row.

## Part 5 — implications for the schema

1. **A free row exists.** `clap` duplicates `snare` in 16 of 22 grids, so it carries almost no
   information today.
2. **Two identity instruments are missing**: ride and bell. Both are needed by idioms already in
   the library (jazz waltz, Afro 6/8), and both would need a `DRUM_KITS` voice — `check:drums`
   enforces audible separation between voices.
3. **`tom` and `crash` are authored but unplayable** — no sequencer track (see DEV-382 comment).
4. **Resolution is the ceiling for trap and funk specifically.** 12/8 already gives 24 steps per
   bar, so the clock and grid render 24 columns today; what does not exist is a drum grid finer
   than its transport meter — the axis the lead melody already has via `LEAD_TICKS_PER_BAR`.
