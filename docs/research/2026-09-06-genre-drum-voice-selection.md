# Genre drum-voice selection — which pieces of the kit, and which kit

Written 2026-09-06 against `src/data/drumGrids.ts` (30 grids) and `src/data/drumKits.ts` (12 kits).

**Scope.** This document is about *instrument selection* — which voices a genre plays and with
what sound. Step positions are already covered by
`docs/research/2026-09-06-drum-grid-genre-survey.md`; where a voice choice implies a rhythm that
survey did not capture, this one says so in one line and points there rather than re-deriving it.

**Method and honesty.** Every genre claim carries a URL. Sources are production/pedagogy pages,
not primary musicology, except where noted (Smithsonian Folkways, Zildjian education, Wikipedia).
Evidence was gathered from search-result extracts of the cited pages, not always a full read of
each page — where a claim rests on one weakly-specific page, it is labelled. Claims with no source
are written as **unsourced — engineering judgement**, never dressed up. All statements about
solna's own data were produced by evaluating `DRUM_GRIDS` and reading `DRUM_KITS`.

---

## Part 0 — the table as it stands today

Voice rows in use, per the data: `kick`, `snare`, `clap`, `hihat`, `openhat`, `tom`, plus `bass`
in 22 grids and `crash` in 8. The two are mutually exclusive across the library — no grid has both.

**The `crash` row carries one bit of information in the whole library.** All 8 grids that have it
(`house`, `lofi-half-time-brush`, `synthwave-four-on-floor`, `ambient-sparse-drift`,
`boombap-swung-break`, `zen-bamboo-pulse`, `waltz-brush-three`, `afro-six-eight-bell`) fire it at
**step 0 and nowhere else**. Replacing `crash` with a real `ride` therefore costs exactly one
authored gesture, repeated eight times — the downbeat accent. That is the strongest argument for
the swap, and also the thing that must be re-homed (see Part 6).

Current kit assignment, read from the `kit` field:

| kit | grids assigned |
| --- | --- |
| Retro Drive | synthwave, synthwave-four-on-floor, synthwave-attack |
| 909 Modern | house |
| Trap Beat | trap, trap-quarter-hat |
| 808 Vintage | boom-bap, boombap-swung-break, boombap-8th-hat, lofi-half-time-brush |
| Chrome Pulse | cyberpunk |
| Velocity Breaks | dnb |
| Sub Weight | dubstep, dubstep-halftime |
| Warehouse | techno, techno-rolling, ambient-sparse-drift |
| Tight Pocket | funk, funky-drummer |
| Acoustic Studio | rock, rock-driving-8th, waltz, zen-bamboo-pulse, afro-six-eight-bell |
| Warm Riddim | reggae, reggae-rockers, afro-6-8 |
| Lo-Fi Vinyl | lofi-hip-hop, lofi-ghost-kick, waltz-brush-three |

---

## Part 1 — the genre × voice matrix

Legend: **●** essential (the genre is not itself without it) · **○** optional colour ·
**✗** wrong for the style · **(–)** voice does not exist yet in solna.

| genre | kick | snare | clap | closed hat | open hat | ride (–) | bell (–) | toms | crash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **synthwave** | ● | ● gated | ● layered | ● | ○ | ✗ | ✗ | ● Simmons fill | ○ |
| **house** | ● | ○ | ● often *instead* | ● | ● identity | ○ | ✗ | ○ filtered perc | ○ section starts |
| **trap** | ● 808 | ● | ● layered | ● identity | ○ | ✗ | ✗ | ○ | ○ |
| **boom bap** | ● | ● sampled acoustic | ✗ | ● | ○ | ○ | ✗ | ○ fills | ○ |
| **cyberpunk / industrial** | ● distorted | ● metallic | ○ | ● glitchy | ○ | ○ | ○ as metal hit | ● metallic | ○ |
| **drum & bass** | ● | ● + ghosts | ✗ | ● | ○ | ● (in the break) | ✗ | ○ | ● on 1 |
| **dubstep** | ● | ● layered w/ clap | ○ top layer only | ● | ○ | ○ as noise tail | ✗ | ○ | ○ |
| **techno** | ● | ○ | ● | ● rolling 16ths | ● offbeat | ○ shimmer | ✗ | ○ filtered rolls | ○ |
| **funk** | ● | ● + ghosts/rimshot | ✗ | ● 16ths | ● accents | ○ | ○ cowbell | ○ | ○ |
| **rock** | ● | ● | ✗ | ● | ○ | ● chorus | ○ ride bell | ● fills | ● downbeat |
| **reggae (one drop)** | ● on 3 | ● *as cross-stick* | ✗ | ● | ○ | ○ | ○ steppers | ○ fills | ○ |
| **lo-fi hip-hop** | ● muffled | ● soft / rimshot | ○ finger snap | ● tape hat | ○ | ○ | ✗ | ○ | ✗ too loud |
| **jazz waltz** | ○ feathered on 1 | ● *as cross-stick* | ✗ | ● foot, on 2 | ✗ | ● **the timekeeper** | ○ | ○ | ○ |
| **afro 6/8 (bembé)** | ○ | ● cross-stick | ✗ | ○ foot | ✗ | ○ (played on its bell) | ● **the timekeeper** | ● the drum parts | ✗ |
| **ambient** | ○ | ○ | ✗ | ○ | ○ | ○ | ○ | ○ | ● as a wash |
| **zen** | — | — | — | — | — | — | — | — | — |

Sourcing, row by row:

- **synthwave** — the 80s palette is LinnDrum / Oberheim DMX / Simmons SDS / TR-909, with gated
  reverb on **snare and toms** specifically, and the LM-1 clap as the "instant 80s" layer.
  ([drumloopai](https://www.drumloopai.com/blog/80-s-drum-kit/),
  [waves](https://www.waves.com/tricks-for-big-80s-drum-sounds),
  [loops de la crème](https://www.loopsdelacreme.com/blog/create-the-perfect-80s-snares),
  [Orpheus](https://www.orpheusaudioacademy.com/synthwavedrums/)) The descending electronic tom
  fill is a first-class gesture in this style, not a garnish — which is why `tom` is **●** here and
  optional almost everywhere else, and why the `hitom`/`lowtom` split matters most to synthwave.
- **house** — "bass drum on every beat, a **clap** on 2 and 4, an open hi-hat on the off-beat
  between each kick"; closed hats, rimshots and ghost snares fill around them.
  ([Amped Studio](https://ampedstudio.com/blog/how-tomake-a-house-beat/),
  [Ben Rainey](https://www.benrainey.co.uk/blog/drum-programming-house-music))
- **trap** — hi-hats are "probably the most defining feature"; the backbeat is "the snare **or**
  clap" on 2 and 4, and "trap snares tend to be bright, punchy, and **layered with claps**".
  ([eMastered](https://emastered.com/blog/trap-drum-patterns),
  [WTMH](https://wtmhstudio.com/how-to-make-hard-hitting-trap-beats-from-scratch/),
  [Reason Studios](https://www.reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet))
- **boom bap** — the reference instrument is the SP-1200 sampling acoustic breaks; its own factory
  drums are a "pseudo-acoustic, Linn-esque" kit. The genre's backbeat is a *sampled acoustic snare*,
  never a drum-machine clap.
  ([LANDR](https://blog.landr.com/sp-1200/),
  [Levels](https://levelsmusicproduction.medium.com/classic-drum-machines-the-sp-1200-fa2da0c951c2),
  [Attack](https://www.attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/))
- **cyberpunk / industrial** — "bitcrushed drums, metallic hits, granular noise… gated reverbs";
  snares should carry "reverb tails or **metallic elements**", hi-hats "glitchy with staggered
  patterns or triplet rhythms rather than clean, straight patterns"; EBM percussion is "clanks,
  hits, distorted elements".
  ([Melodigging](https://www.melodigging.com/genre/cyberpunk),
  [Cedar Sound](https://www.cedarsoundstudios.com/blogs/news/cyberpunk-drum-samples-for-your-music),
  [Studio Tronnic](https://studiotronnic.com/products/ebm-techno-essentials))
- **drum & bass** — the genre is built on the Amen break, an *acoustic* six-second drum solo; a
  high-energy break is "snappy main snares, driving ghost notes, and a **steady ride cymbal**".
  ([Wikipedia](https://en.wikipedia.org/wiki/Amen_break),
  [Elephant Drums](https://www.elephantdrums.co.uk/blog/guides-and-resources/amen-break-drum-groove/),
  [KAN Samples](https://kansamples.com/blogs/learn/how-to-chop-amen-break))
- **dubstep** — "layer a snare sample… **with a clap**"; the clap is high-passed above ~500 Hz as
  the top layer, and rides/noise supply the tail.
  ([Sound on Sound](https://www.soundonsound.com/techniques/dubstep-drums),
  [Soundbridge](https://www.soundbridge.io/designing-dubstep-drums),
  [Unison](https://unison.audio/how-to-make-dubstep/))
- **techno** — "hi-hat on every 16th note at low velocity with accents on the off-beats"; open hats
  on the "and" of 2 and 4; a ride on the offbeats for "shimmer and width", deliberately a different
  tonal character from the hat; filtered toms used to build 16th-note rolls, and *ghosted* claps.
  ([Studio Brootle](https://www.studiobrootle.com/techno-drum-patterns-and-drum-programming-tips/),
  [Attack — Rolling Techno](https://www.attackmagazine.com/technique/beat-dissected/rolling-techno/))
- **funk** — one-handed 16th-note hat with an accent on the offbeats, snare ghost notes as the
  actual groove, opened/closed hat "in spots".
  ([DRUM! 16th-note feel](https://drummagazine.com/lesson-how-to-get-that-tasty-16th-note-hi-hat-feel/),
  [PAS](https://pas.org/pas-blog/groove-of-the-month-ghost-note-funk/),
  [Roland — Funky Drummer](https://articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/))
- **rock** — "the hi-hat (or ride cymbal, in heavier or more open-sounding rock) plays a steady
  stream of eighth notes"; a chorus "often opens up with a crash cymbal and sometimes a switch from
  hi-hat to ride"; toms are "most often used in drum fills".
  ([Rhythm Notes](https://rhythmnotes.net/rock-drum-beats/),
  [Drum Beats Online](https://drumbeatsonline.com/blog/rock-drum-beats-essential-patterns-every-drummer-should-know),
  [OnlineDrummer](https://www.onlinedrummer.com/blogs/drum-lessons/six-hard-rock-drum-fills))
- **reggae** — the one drop "places the **cross stick** with the kick drum on beat 3"; the
  accent is achieved "through cross-stick strikes… or rimshots… for a dry, woody sound"; "the
  hi-hat becomes the groove engine".
  ([Tunable](https://tunableapp.com/rhythm/reggae-one-drop/),
  [Bass Culture](https://bassculture.substack.com/p/the-one-drop-understanding-reggaes),
  [MusicRadar](https://www.musicradar.com/how-to/how-to-program-a-typical-one-drop-reggae-beat-and-add-fills),
  [DrumHelper](https://drumhelper.com/learning-drums/reggae-drum-beats-and-patterns/))
- **lo-fi hip-hop** — "muffled kicks, gentle snares & **rimshots**, crispy snaps & claps, tape hats
  and cymbals… crackly vinyl noises"; shakers, bongos and tambourines are the usual additions.
  ([Mondo Loops](https://mondoloops.com/blogs/blog/best-lofi-drum-samples),
  [Transmission](https://www.transmissionsamples.com/lofi-drum-patterns),
  [Native Instruments](https://blog.native-instruments.com/lo-fi-hip-hop-beats/))
- **jazz waltz** — "one, two, and-of-two, three… on the **ride cymbal**, with the hi-hat on two";
  the ride pattern is triplet-based; the snare part is a cross-stick variation.
  ([On Jazz Drumming](http://www.onjazzdrumming.com/jazz-drumming/how-to-play-jazz-drums-in-3-4.html),
  [Drumeo](https://www.drumeo.com/beat/a-drummers-guide-to-jazz/),
  [Zildjian](https://ae.zildjian.com/education/evolution-of-the-ride-pattern/evolution-of-the-ride-pattern-installment-3/))
- **afro 6/8 (bembé)** — "bembé refers to one specific rhythmic pattern traditionally played on a
  **bell**"; on drum set the bell pattern goes "on the cymbal, cowbell, or shell of a drum, and the
  drum parts are played on the **toms**"; the 6/8 clave sits on "the cowbell, **ride bell**, or
  hi-hats". The gankogui/agogo is the traditional double bell.
  ([Sunhouse](https://sunhou.se/blog/the-rhythmic-worlds-of-bembe),
  [Drum Set Tips](https://drumsettips.org/bembe-drum-style-latin-drum-set-beats/),
  [Reverb](https://reverb.com/news/latin-beats-the-afro-cuban-6-slash-8-on-the-congas-and-the-drums),
  [Smithsonian Folkways](https://folkways.si.edu/braiding-rhythms-the-role-of-bell-patterns-in-west-african-and-afro-caribbean-music/tools-for-teaching/smithsonian),
  [Wikipedia — agogô](https://en.wikipedia.org/wiki/Agog%C3%B4))
- **ambient** — **unsourced — engineering judgement.** There is no canonical ambient drum voicing;
  the row above records what the existing `ambient-sparse-drift` grid does (sparse kick, one snare,
  a downbeat wash), not a documented practice.
- **zen** — **unsourced — engineering judgement, and an invention.** The prior survey already
  established that "zen" is not a documented percussion tradition; nothing found here changes that.
  Its voice selection cannot be right or wrong, only consistent.

**Two rhythm consequences the step-position survey did not record** (pointers only, not re-derived):

1. Afro 6/8's toms are not fills — the drum parts *are* the toms
   ([Drum Set Tips](https://drumsettips.org/bembe-drum-style-latin-drum-set-beats/)). The existing
   survey's Part 2 corrects `afro-6-8`'s snare to the cross-stick `1,4,7,10`; the tom row it leaves
   at `11` is a different omission, not a placement error.
2. Techno's tom row is a *timekeeping* device (filtered 16th-note rolls), not a fill
   ([Attack](https://www.attackmagazine.com/technique/beat-dissected/rolling-techno/)). Today
   `techno` has `tom 14,15` and `techno-rolling` has none.

---

## Part 2 — clap versus snare, per genre

Measured state of the library: `clap` is byte-identical to `snare` in **14 of 30** grids, all-false
in **11**, and genuinely different in **5** (`cyberpunk`, `waltz`, `afro-6-8`, `waltz-brush-three`,
`trap-quarter-hat`).

| genre | correct relationship | source | current state | verdict |
| --- | --- | --- | --- | --- |
| house | clap **instead of** snare (or clap dominant) | [Amped](https://ampedstudio.com/blog/how-tomake-a-house-beat/) | clap == snare, both 4,12 | drop the snare row, keep clap |
| techno | clap carries the backbeat; ghosted claps as texture | [Studio Brootle](https://www.studiobrootle.com/techno-drum-patterns-and-drum-programming-tips/), [Attack](https://www.attackmagazine.com/technique/beat-dissected/rolling-techno/) | `techno` clap == snare; `techno-rolling` has **neither** | keep clap only; give `techno-rolling` a clap |
| trap | clap **layered with** snare | [eMastered](https://emastered.com/blog/trap-drum-patterns) | clap == snare (correct layer) | keep |
| dubstep | clap **layered**, as the high-passed top of the snare | [SOS](https://www.soundonsound.com/techniques/dubstep-drums) | clap == snare | keep |
| synthwave | clap **layered** (LM-1 clap over gated snare) | [loops de la crème](https://www.loopsdelacreme.com/blog/create-the-perfect-80s-snares) | clap == snare | keep |
| cyberpunk | clap optional; snare is the metallic voice | [Cedar Sound](https://www.cedarsoundstudios.com/blogs/news/cyberpunk-drum-samples-for-your-music) | already distinct (snare 4,12,14 / clap 4,12) | keep |
| lo-fi hip-hop | snap/clap is a **thin colour**, never the backbeat | [Mondo Loops](https://mondoloops.com/blogs/blog/best-lofi-drum-samples) | clap == snare in `lofi-hip-hop`, `lofi-half-time-brush` | thin it or remove |
| boom bap | **no clap** — sampled acoustic snare | [LANDR](https://blog.landr.com/sp-1200/) | clap == snare in `boom-bap`, `boombap-swung-break` | **remove** |
| funk | **no clap** | [PAS](https://pas.org/pas-blog/groove-of-the-month-ghost-note-funk/) | clap == snare in `funk` | **remove** |
| rock | **no clap** | [Rhythm Notes](https://rhythmnotes.net/rock-drum-beats/) | clap == snare in `rock` | **remove** |
| drum & bass | **no clap** — the Amen break is an acoustic kit | [Wikipedia](https://en.wikipedia.org/wiki/Amen_break) | clap == snare in `dnb` | **remove** |
| reggae | **no clap** — the backbeat is a cross-stick | [Tunable](https://tunableapp.com/rhythm/reggae-one-drop/) | already silent | correct |
| jazz waltz | **no clap** | [Drumeo](https://www.drumeo.com/beat/a-drummers-guide-to-jazz/) | `waltz` has clap 8, `waltz-brush-three` clap 8 | **remove** (it is a stray) |
| afro 6/8 | **no clap** — cross-stick and bell | [Sunhouse](https://sunhou.se/blog/the-rhythmic-worlds-of-bembe) | `afro-six-eight-bell` clap == snare; `afro-6-8` clap 4,10 | **remove from both** |
| ambient / zen | judgement — no clap | unsourced | silent | correct |

**Net:** of the 14 duplicate rows, 6 should be deleted outright (`boom-bap`, `boombap-swung-break`,
`funk`, `rock`, `dnb`, `afro-six-eight-bell`), 2 should become clap-only with the snare dropped
(`house`, `techno`), 4 are correct layers (`trap`, `dubstep`, `synthwave`,
`synthwave-four-on-floor`), and 2 are lo-fi judgement calls. The remaining duplicate,
`lofi-half-time-brush`, is a lo-fi grid and follows the lo-fi row.

---

## Part 3 — the time-keeper, per genre

The question each row answers: **which single voice, if muted, makes the genre unrecognisable.**

| genre | time-keeper | what it plays | what changes if it moves |
| --- | --- | --- | --- |
| **trap** | closed hat | quarters/8ths as the *base*, with 32nd and triplet **rolls layered on top** ([eMastered](https://emastered.com/blog/trap-drum-patterns)) | The rolls, not the base, are the identity. A flat 16-step `0-15` reads as a hat wash, not trap — the existing survey's Part 4 records this as a resolution ceiling, and the voice answer is the same: the hat is right, the grid cannot say what it does. |
| **techno** | closed hat + open hat as a pair | closed hat on all 16 at low velocity, **open hat on the offbeat** ([Studio Brootle](https://www.studiobrootle.com/techno-drum-patterns-and-drum-programming-tips/)) | Move the pattern to the ride and it becomes shimmer, not drive — sources treat the ride as an *addition* with a deliberately different tonal character, never a replacement. |
| **house** | **open hat** | offbeat between every kick ([Amped](https://ampedstudio.com/blog/how-tomake-a-house-beat/)) | This is the one genre where the *open* hat, not the closed one, is the identity. Closing it turns house into generic four-on-the-floor. |
| **jazz waltz** | **ride cymbal** | "1, 2, and-of-2, 3", triplet-based; hi-hat (foot) on 2 only ([On Jazz Drumming](http://www.onjazzdrumming.com/jazz-drumming/how-to-play-jazz-drums-in-3-4.html)) | Playing this figure on a closed hat — which is what `waltz` does today, `hihat 0,4,6,8` — states the rhythm but not the instrument. The ride and the hi-hat play **simultaneously and differently**; one row cannot hold both. |
| **afro 6/8** | **bell** | the bembé/6/8-clave bell pattern, on cowbell, ride bell or hi-hat ([Sunhouse](https://sunhou.se/blog/the-rhythmic-worlds-of-bembe), [Reverb](https://reverb.com/news/latin-beats-the-afro-cuban-6-slash-8-on-the-congas-and-the-drums)) | Same structural problem as jazz waltz, one degree worse: the bell and the hi-hat are separate players in the source tradition. The hat is a *foot* part here, not the timekeeper. |
| **reggae** | closed hat, with the cross-stick as its counterpart | hat is "the groove engine"; the rim/cross-stick lands with the kick on 3 ([Bass Culture](https://bassculture.substack.com/p/the-one-drop-understanding-reggaes), [Tunable](https://tunableapp.com/rhythm/reggae-one-drop/)) | The relationship is hat-continuous / rim-sparse. Today's `reggae` grid puts a full `snare` on 8 — right position, wrong voice: it should be a dry woody cross-stick, and no such voice exists. |
| **funk** | closed hat at 16ths, **open hat as the accent** | one-handed 16ths; accents on offbeats; opened hat "in spots" ([DRUM!](https://drummagazine.com/lesson-how-to-get-that-tasty-16th-note-hi-hat-feel/)) | The open hat is doing *accent* work, not sustain work — a functionally different job from house's open hat, on the same row. `funky-drummer`'s `openhat 5,13` is the correct reading of it. |
| **rock** | closed hat in verses, **ride in choruses** | 8ths on either ([Rhythm Notes](https://rhythmnotes.net/rock-drum-beats/), [Drum Beats Online](https://drumbeatsonline.com/blog/rock-drum-beats-essential-patterns-every-drummer-should-know)) | The switch itself is the arrangement device. A one-bar grid cannot express it; two grids (hat version, ride version) can. |
| **drum & bass** | ride/hat inherited from the break | "a steady ride cymbal to keep the momentum going" ([Elephant Drums](https://www.elephantdrums.co.uk/blog/guides-and-resources/amen-break-drum-groove/)) | The Amen's timekeeper is a ride, not a hi-hat. Today's `dnb` grid keeps time on `hihat 2,6,10,14`, which is a house-style offbeat hat — the right *positions* for a chopped break, on the wrong instrument. |
| **boom bap** | closed hat at 8ths | ([Attack](https://www.attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/)) | Correct today. Ride is period-plausible colour, not the timekeeper. |
| **lo-fi hip-hop** | closed "tape" hat at 8ths | ([Mondo Loops](https://mondoloops.com/blogs/blog/best-lofi-drum-samples)) | Correct today. The distinguishing variable is timbre and swing, not which voice. |
| **synthwave** | closed hat, straight | ([Orpheus](https://www.orpheusaudioacademy.com/synthwavedrums/)) | Correct today. |
| **dubstep** | closed hat, sparse; often the only sustained voice | ([SOS](https://www.soundonsound.com/techniques/dubstep-basics)) | `dubstep-halftime` currently has **no hat at all** — a kick on 0 and a snare on 8 and nothing else. Defensible as a drop skeleton, not as a groove. |
| **cyberpunk** | closed hat, deliberately irregular | "glitchy with staggered patterns or triplet rhythms rather than clean, straight" ([Cedar Sound](https://www.cedarsoundstudios.com/blogs/news/cyberpunk-drum-samples-for-your-music)) | Today's `hihat 0,1,3,4,6,7,9,10,12,13,15` is a genuine staggered pattern and matches the sourced description — one of the better-voiced grids in the library. |
| **ambient / zen** | none | unsourced — engineering judgement | No time-keeper is the point. |

**The single structural finding:** four genres in this library (jazz waltz, afro 6/8, drum & bass,
rock-in-chorus) name a timekeeper that has no row, and three of them need it to sound *at the same
time as* the hi-hat. Adding `ride` and `bell` is not a colour upgrade — it is the difference
between stating a rhythm and playing an idiom.

---

## Part 4 — kit fit, and where the current assignment is wrong

Kit character below is read from the parameters in `src/data/drumKits.ts` (hat cut-off, decays,
reverb sends, kick pitch envelope), not from the names.

| grid(s) | kit today | verdict | reason |
| --- | --- | --- | --- |
| house | 909 Modern | **correct** | The TR-909's kick, clap and hats *are* the house palette ([Perfect Circuit](https://www.perfectcircuit.com/signal/roland-tr-909), [MusicRadar](https://www.musicradar.com/how-to/tips-for-processing-roland-tr-909-drum-sounds)). The kit's clicky 1200 Hz transient kick matches. |
| techno, techno-rolling | Warehouse | **correct** | 9000 Hz hat / 0.03 s decay and a 1500 Hz click kick is exactly the "rigid hi-hats, crushing kick" description. |
| trap, trap-quarter-hat | Trap Beat | **correct** | 0.3 s pitch time and 0.65 s decay on the kick is the sustained 808 with glide the sources describe. |
| dubstep, dubstep-halftime | Sub Weight | **correct** | Longest kick pitch envelope (0.35 s) and the highest snare reverb send (0.5) — matches the layered, reverberant dubstep snare. |
| dnb | Velocity Breaks | **correct** | Shortest kick (0.16 s) and snare body decay (0.08 s) of the twelve — right for chopped breaks. |
| cyberpunk | Chrome Pulse | **correct** | Brightest hats (9500 Hz), highest snare noise content and reverb send — the "metallic elements + reverb tail" prescription. |
| funk, funky-drummer | Tight Pocket | **correct** | Driest kit (reverb sends 0.15), short decays. Ghost-note funk needs exactly this. |
| rock, rock-driving-8th | Acoustic Studio | **correct** | Only kit with a long crash (1.7 s) and a full-bodied tom (0.45 s decay) — the fill instrument rock actually needs. |
| reggae, reggae-rockers | Warm Riddim | **correct** | Dark hats (4500 Hz) and the *lowest* snare noise gain (0.4) of the twelve — the closest this library gets to a dry, woody cross-stick without having the voice. |
| synthwave ×3 | Retro Drive | **correct** | Snare pitch barely drops (210→175 Hz) with a 0.4 reverb send — a plausible gated-reverb stand-in; clap gain 0.65 is the highest, matching the LM-1-forward 80s balance. |
| waltz | Acoustic Studio | **correct** | Only acoustic-leaning kit; a jazz waltz on any drum-machine kit is a category error. |
| lofi-hip-hop, lofi-ghost-kick | Lo-Fi Vinyl | **correct** | 3500 Hz hats and a 700 Hz snare filter is the muffled/tape prescription. |
| **boom-bap, boombap-swung-break, boombap-8th-hat** | 808 Vintage | **wrong — the strongest case in the table** | Boom bap's instrument is the **SP-1200 sampling acoustic breaks**, not the TR-808 ([LANDR](https://blog.landr.com/sp-1200/), [Levels](https://levelsmusicproduction.medium.com/classic-drum-machines-the-sp-1200-fa2da0c951c2)). 808 Vintage's snare is synthetic (190→160 Hz body, 900 Hz noise) and its hat is 5000 Hz — an 808 hat, not a sampled acoustic one. **Tight Pocket** is the closer fit for snare and hat; the only thing 808 Vintage wins is kick weight (0.45 s decay). Best fix is a 13th kit ("SP Break" — acoustic-sampled snare, dark filtered hat, long-ish kick); second best is Tight Pocket. |
| **ambient-sparse-drift** | Warehouse | **wrong** | Warehouse is a techno kit: 0.03 s hats, 0.3 s kick, and the *lowest* decays in the library. Ambient needs long tails and high reverb sends. **Acoustic Studio** (crash 1.7 s, tom 0.45 s) or **Sub Weight** (snare reverb send 0.5) both fit better; Acoustic Studio is the better of the two because ambient wants the wash on the cymbal, not the snare. |
| **afro-6-8** vs **afro-six-eight-bell** | Warm Riddim vs Acoustic Studio | **inconsistent — pick one** | Two grids of the same idiom disagree on kit. Warm Riddim's 4500 Hz hat is the second-darkest in the library, and a bembé bell is a bright, pitched, cutting sound. **Acoustic Studio for both**, until the `bell` voice exists and earns a kit of its own. |
| lofi-half-time-brush | 808 Vintage | **questionable** | The name says brushes; the kit is a drum machine. It matches its vibe (`lofi-chill` also names `808 Vintage`), so this is a deliberate blend rather than an error — but nothing in it is brush-like. Rename the grid or move it to Lo-Fi Vinyl. |
| waltz-brush-three | Lo-Fi Vinyl | **acceptable, by intent** | Same reasoning inverted: this is the `lofi-waltz` vibe's grid, and the vibe names Lo-Fi Vinyl. For a *pure* jazz-waltz reading Acoustic Studio would be right; as a lo-fi waltz this is the intended blend. Not a bug. |
| zen-bamboo-pulse | Acoustic Studio | **acceptable** | The grid is an acknowledged invention, so no source can adjudicate. Acoustic Studio's long crash is the most woody/resonant option available. **Unsourced — engineering judgement.** |

**Separate defect found while reading the kit field.** `mergeDrumKit` in `src/audio/drumKits.ts`
takes `DRUM_KITS[name]` as a `Partial<DrumKit>` and spreads it over `DEFAULT_DRUM_KIT`, so an
unknown name silently yields the default kit. Three vibes in `src/data/vibes.ts` name `soundKit`
values that are **not keys of `DRUM_KITS`**: `cyber-edm` → `'Hyperpop 2000'`, `deep-ambient` and
`zen-garden` → `'Minimal Glitch'`. Those three vibes therefore play the default kit, not a chosen
one. This is outside the voice question but belongs in the same implementation pass.

---

## Part 5 — voices we do not have and a genre genuinely needs

Ranked by how many of solna's genres would use them.

| rank | voice | genres that need it | what it does | evidence |
| --- | --- | --- | --- | --- |
| **1** | **rimshot / cross-stick** | reggae ●, jazz waltz ●, afro 6/8 ●, lo-fi hip-hop ●, funk ○, boom bap ○, house ○ (ghost/rim fills) — **7** | A dry, woody, low-level backbeat that is *not* a snare hit. In three of those genres it **is** the backbeat, so today the grid smuggles it onto `snare` and gets a loud crack where the idiom wants a click. | reggae: [Tunable](https://tunableapp.com/rhythm/reggae-one-drop/), [Bass Culture](https://bassculture.substack.com/p/the-one-drop-understanding-reggaes) · jazz: [Drumeo](https://www.drumeo.com/beat/a-drummers-guide-to-jazz/) · afro 6/8: [Reverb](https://reverb.com/news/latin-beats-the-afro-cuban-6-slash-8-on-the-congas-and-the-drums) · lo-fi: [Mondo Loops](https://mondoloops.com/blogs/blog/best-lofi-drum-samples) · house: [Ben Rainey](https://www.benrainey.co.uk/blog/drum-programming-house-music) |
| **2** | **shaker / tambourine** | house ●, funk ○, lo-fi hip-hop ○, reggae ○, afro 6/8 ○, boom bap ○ — **6** | High-frequency energy *between* the hat hits; carries 8th/16th continuity at low level so the hat can be sparse. It is the one addition that changes perceived groove density without touching the hat row. | [Point Blank](https://www.pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats/), [House of Loop](https://houseofloop.com/how-to-use-latin-and-afro-percussion-loops-in-electronic-music/), [Transmission](https://www.transmissionsamples.com/lofi-drum-patterns) |
| **3** | **bell / cowbell** (already planned) | afro 6/8 ●, funk ○, reggae ○ (steppers), house ○ (disco house), rock ○ (ride bell) — **5**, one of them essential | The 6/8 timekeeper. Afro 6/8 alone justifies it: without a bell the genre's defining pattern has to ride on the hi-hat row, and the hi-hat is separately occupied. | [Sunhouse](https://sunhou.se/blog/the-rhythmic-worlds-of-bembe), [Drum Set Tips](https://drumsettips.org/bembe-drum-style-latin-drum-set-beats/), [Folkways](https://folkways.si.edu/braiding-rhythms-the-role-of-bell-patterns-in-west-african-and-afro-caribbean-music/tools-for-teaching/smithsonian), [House of Loop](https://houseofloop.com/how-to-use-latin-and-afro-percussion-loops-in-electronic-music/) |
| **4** | **conga / bongo** | house ●(disco house), afro 6/8 ●, lo-fi hip-hop ○, reggae ○ — **4** | Pitched hand-drum syncopation; "always something organic moving" under the kick and hat. In bembé the congas are a *separate voice from* the toms, which the `hitom`/`lowtom` split does not supply. | [Point Blank](https://www.pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats/), [House of Loop](https://houseofloop.com/how-to-use-latin-and-afro-percussion-loops-in-electronic-music/), [Reverb](https://reverb.com/news/latin-beats-the-afro-cuban-6-slash-8-on-the-congas-and-the-drums) |
| **5** | **rototom** | techno ○, synthwave ○ — **2** | Pitched, filtered tom rolls used as timekeeping in techno and as the descending Simmons fill in synthwave. **Largely redundant once `tom` becomes `hitom`/`lowtom`** — two pitches cover most of what these two genres ask for. Lowest priority. | [Attack](https://www.attackmagazine.com/technique/beat-dissected/rolling-techno/), [drumloopai](https://www.drumloopai.com/blog/80-s-drum-kit/) |

**Ranking note.** Rimshot beats shaker on *severity*, not only count: the shaker's absence makes a
groove thinner, whereas the rimshot's absence makes three genres play the wrong instrument on their
own signature beat.

---

## Part 6 — implications for the planned voice change

| change | supported by this research? | caveat |
| --- | --- | --- |
| delete `bass` row | yes — it is not a drum voice and, per the prior survey, never sounded | none |
| `crash` → `ride` | yes | The whole `crash` row is `step 0` in all 8 grids that have it. But rock and drum & bass genuinely want a crash accent on the downbeat *and* a ride for timekeeping ([Drum Beats Online](https://drumbeatsonline.com/blog/rock-drum-beats-essential-patterns-every-drummer-should-know), [Wikipedia — ride](https://en.wikipedia.org/wiki/Ride_cymbal)) — the ride "maintains a steady pattern, rather than provides the accent of a crash". Dropping crash entirely trades one accent for one timekeeper; consider keeping crash as a ninth voice rather than a substitution. |
| `tom` → `hitom` + `lowtom` | yes | Highest value in synthwave (descending Simmons fill), rock (fills), afro 6/8 (the drum parts themselves) and techno (filtered rolls). Note that in afro 6/8 the toms substitute for **congas**, which is a different timbre — the split helps but does not close that gap. |
| add `bell` | yes — essential for one genre, colour for four | Needs a `DRUM_KITS` entry per kit and must pass `check:drums` audible separation against `hihat` and `openhat`, which are its nearest neighbours in brightness. |
| **not yet planned: `rimshot`** | **this is the highest-value missing voice by both counts and severity** | Recommend adding it in the same pass as `bell`; it is what reggae, jazz waltz, afro 6/8 and lo-fi hip-hop all currently fake on the `snare` row. |

---

## Sources

Genre and technique (43 distinct URLs, all cited inline above):

Trap — [eMastered](https://emastered.com/blog/trap-drum-patterns) ·
[WTMH](https://wtmhstudio.com/how-to-make-hard-hitting-trap-beats-from-scratch/) ·
[Reason Studios](https://www.reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet).
House / techno / EDM — [Amped Studio](https://ampedstudio.com/blog/how-tomake-a-house-beat/) ·
[Ben Rainey](https://www.benrainey.co.uk/blog/drum-programming-house-music) ·
[Perfect Circuit — TR-909](https://www.perfectcircuit.com/signal/roland-tr-909) ·
[MusicRadar — 909 processing](https://www.musicradar.com/how-to/tips-for-processing-roland-tr-909-drum-sounds) ·
[MusicRadar — four-to-the-floor grooves](https://www.musicradar.com/how-to/how-to-program-6-different-four-to-the-floor-grooves) ·
[Studio Brootle — techno](https://www.studiobrootle.com/techno-drum-patterns-and-drum-programming-tips/) ·
[Attack — Rolling Techno](https://www.attackmagazine.com/technique/beat-dissected/rolling-techno/) ·
[drum-patterns.com — TR-909](https://drum-patterns.com/drumkit/roland-tr-909/).
Hi-hat / ride programming — [MusicRadar — hi-hat parts](https://www.musicradar.com/tuition/tech/how-to-program-realistic-sounding-hi-hat-parts-630716) ·
[MusicRadar — ride parts](https://www.musicradar.com/tuition/tech/how-to-program-useful-and-realistic-sounding-ride-cymbal-parts-628373) ·
[Production Expert](https://www.production-expert.com/production-expert-1/6-killer-hi-hat-programmingnbsptipsnbspfor-musicnbspproducers) ·
[MasterClass](https://www.masterclass.com/articles/hi-hat-drumming) ·
[Wikipedia — ride cymbal](https://en.wikipedia.org/wiki/Ride_cymbal).
Jazz / waltz — [On Jazz Drumming](http://www.onjazzdrumming.com/jazz-drumming/how-to-play-jazz-drums-in-3-4.html) ·
[Drumeo](https://www.drumeo.com/beat/a-drummers-guide-to-jazz/) ·
[Zildjian](https://ae.zildjian.com/education/evolution-of-the-ride-pattern/evolution-of-the-ride-pattern-installment-3/) ·
[ArtistWorks](https://blog.artistworks.com/jazz-drums-a-beginners-guide-to-patterns-grooves-and-practice/) ·
[studydrums.com](https://studydrums.com/hsid/jzwalz01.html).
Reggae — [Tunable](https://tunableapp.com/rhythm/reggae-one-drop/) ·
[Bass Culture](https://bassculture.substack.com/p/the-one-drop-understanding-reggaes) ·
[MusicRadar](https://www.musicradar.com/how-to/how-to-program-a-typical-one-drop-reggae-beat-and-add-fills) ·
[DrumHelper](https://drumhelper.com/learning-drums/reggae-drum-beats-and-patterns/) ·
[Rhythm Notes](https://rhythmnotes.net/reggae-drum-beats/).
Afro 6/8 — [Sunhouse](https://sunhou.se/blog/the-rhythmic-worlds-of-bembe) ·
[Drum Set Tips](https://drumsettips.org/bembe-drum-style-latin-drum-set-beats/) ·
[Reverb](https://reverb.com/news/latin-beats-the-afro-cuban-6-slash-8-on-the-congas-and-the-drums) ·
[Smithsonian Folkways](https://folkways.si.edu/braiding-rhythms-the-role-of-bell-patterns-in-west-african-and-afro-caribbean-music/tools-for-teaching/smithsonian) ·
[Wikipedia — agogô](https://en.wikipedia.org/wiki/Agog%C3%B4).
Funk — [DRUM! 16th-note hat](https://drummagazine.com/lesson-how-to-get-that-tasty-16th-note-hi-hat-feel/) ·
[PAS ghost-note funk](https://pas.org/pas-blog/groove-of-the-month-ghost-note-funk/) ·
[DRUM! ghost notes](https://drummagazine.com/lesson-ghost-note-style-and-placement/) ·
[Roland — Funky Drummer](https://articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/).
Rock — [Rhythm Notes](https://rhythmnotes.net/rock-drum-beats/) ·
[Drum Beats Online](https://drumbeatsonline.com/blog/rock-drum-beats-essential-patterns-every-drummer-should-know) ·
[OnlineDrummer](https://www.onlinedrummer.com/blogs/drum-lessons/six-hard-rock-drum-fills).
Boom bap / lo-fi — [LANDR — SP-1200](https://blog.landr.com/sp-1200/) ·
[Levels — SP-1200](https://levelsmusicproduction.medium.com/classic-drum-machines-the-sp-1200-fa2da0c951c2) ·
[Attack — 90s boom bap](https://www.attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/) ·
[Mondo Loops](https://mondoloops.com/blogs/blog/best-lofi-drum-samples) ·
[Transmission Samples](https://www.transmissionsamples.com/lofi-drum-patterns) ·
[Native Instruments](https://blog.native-instruments.com/lo-fi-hip-hop-beats/).
DnB / dubstep — [Wikipedia — Amen break](https://en.wikipedia.org/wiki/Amen_break) ·
[Elephant Drums](https://www.elephantdrums.co.uk/blog/guides-and-resources/amen-break-drum-groove/) ·
[KAN Samples](https://kansamples.com/blogs/learn/how-to-chop-amen-break) ·
[Sound on Sound — dubstep drums](https://www.soundonsound.com/techniques/dubstep-drums) ·
[Sound on Sound — dubstep basics](https://www.soundonsound.com/techniques/dubstep-basics) ·
[Soundbridge](https://www.soundbridge.io/designing-dubstep-drums) ·
[Unison](https://unison.audio/how-to-make-dubstep/).
Synthwave / 80s — [Orpheus](https://www.orpheusaudioacademy.com/synthwavedrums/) ·
[loops de la crème](https://www.loopsdelacreme.com/blog/create-the-perfect-80s-snares) ·
[Waves](https://www.waves.com/tricks-for-big-80s-drum-sounds) ·
[drumloopai](https://www.drumloopai.com/blog/80-s-drum-kit/) ·
[Attack — synthwave drums](https://www.attackmagazine.com/technique/beat-dissected/synthwave-drums/).
Cyberpunk / industrial — [Melodigging](https://www.melodigging.com/genre/cyberpunk) ·
[Cedar Sound Studios](https://www.cedarsoundstudios.com/blogs/news/cyberpunk-drum-samples-for-your-music) ·
[Studio Tronnic](https://studiotronnic.com/products/ebm-techno-essentials).
Percussion layering — [Point Blank](https://www.pointblankmusicschool.com/blog/how-to-master-percussion-layering-for-richer-beats/) ·
[House of Loop](https://houseofloop.com/how-to-use-latin-and-afro-percussion-loops-in-electronic-music/) ·
[Rhythm Notes — adding percussion](https://rhythmnotes.net/adding-percussion/).

**Unsourced by admission:** ambient and zen voice selection; the `zen-bamboo-pulse` kit choice;
the ranking weights in Part 5 (the counts are sourced, the severity ordering is judgement).
