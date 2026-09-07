/**
 * The drum-grid library: one entry per authored rhythm, keyed by a library id.
 *
 * ONE table, and this is the only one. It used to be two — the sequencer's
 * genre grids here and the Instant Vibes' grids in `vibeDrumGrids.ts` — under
 * near-identical names, so a vibe could reference only its own eight and the
 * sequencer's genre menu could offer only its own fourteen. Merging them cost
 * no sound: the two obstacles the old note claimed turned out to be weaker than
 * written. Cells: `VIBE_DRUM_GRIDS` was typed `number[]` but only ever held 0
 * and 1, so `boolean[]` is the same content with the unused headroom removed.
 * Rows: `replaceDrumPattern` looks a row up by the sequencer track's instrument
 * name; a track no row names is cleared, so the two row sets never had to
 * agree — they are keyed, not positional.
 *
 * What did NOT merge is the CONTENT, and that is deliberate. No vibe grid is
 * the same rhythm as its own genre's grid (Jaccard over hit cells:
 * `synthwave-four-on-floor` is closest to `trap` at 81%, not `synthwave` at
 * 58%; `ambient-sparse-drift` peaks at 26% against anything; nothing matches at
 * 100%). That measurement is why the merge kept both sides instead of
 * collapsing a pair — collapsing one would change what a vibe sounds like.
 *
 * The table holds 30 entries in three origin groups, in file order: the
 * sequencer's fourteen genre grids, the seven Instant Vibe grids, and the nine
 * sourced genre variants from survey Part 3. It was 22 (14 + 8) until the
 * variants were authored; `edm-offbeat-pump` then went, because house and
 * trance/festival EDM are literally the same 16-step boolean grid and sources
 * separate them by sound design and sidechain, neither of which this schema
 * holds. Its `lowtom` and `crash` rows folded into `house` and `cyber-edm` was
 * repointed there, which is why `house` is the one grid with eight rows.
 *
 * One entry carries everything the app needs to apply a rhythm, so adding a
 * grid is an edit to this table and nothing else. `meter` was a sidecar map
 * (`VIBE_DRUM_GRID_METERS`) and `kit` was a second table (`GENRE_TO_KIT`);
 * both are fields now.
 *
 * The `rows` wrapper exists because bar length alone is not a sufficient tag:
 * 3/4 and 6/8 are both 12 steps and differ only in accent grouping.
 *
 * NOTE — every row here plays. `INITIAL_SEQUENCER_TRACKS` has eleven tracks
 * (kick, snare, rimshot, clap, hihat, openhat, hitom, lowtom, ride, crash,
 * bell) and every row below names one of them. The table used to carry a
 * `bass` row in 23 entries — 53 authored hits that could never sound, because
 * `bass` is not a drum voice at all: no `DRUM_KITS` field, no `triggerDrum`
 * case, no track. It was deleted
 * rather than kept as authored intent, because a row that cannot sound is not
 * a rhythm, and `drumGrids.test.ts` now rejects any row name a track cannot
 * play.
 *
 * A grid MAY omit a voice: `replaceDrumPattern` clears every track no row
 * names, so an omitted row and an all-false row are identical in effect. That
 * does not make omission the way to say "silent" — a row of `false` states the
 * genre plays nothing there, an omitted row states the question was not asked.
 *
 * `replaceDrumPattern` REPLACES: it looks a row up by the sequencer track's
 * instrument name and CLEARS every track no row names. So a grid determines
 * the whole kit, and an omitted row is not a leak any more. Write every row
 * your origin group defines anyway, even where the source is silent — a grid
 * should state what it plays, including where it plays nothing.
 *
 * The eight `crash` rows (the eight grids the vibe chips point at, and the
 * only ones with a crash row at all) used to hit step 0 and nowhere else.
 * That was a song gesture — a section opening — borrowed into a one-bar loop
 * that repeats it on every pass, which no drummer plays; it was also standing
 * in for `ride`/`bell`, which did not exist yet, as the only way to get
 * metallic colour into a grid. Both rows exist now, so the crash rows went
 * all-false rather than being deleted: the genre still asks the question
 * (see the omission rule above), it just no longer answers it for the user.
 *
 * Library ids are internal: projects persist the resolved grid, not the id, so
 * these ids are safe to rename (unlike Instant Vibe ids).
 *
 * Layering: this file imports nothing at runtime — src/data/ files never do —
 * so it can be read, reviewed or copied into a fixture in isolation.
 */
import type { MeterId } from '@/utils/meter';

export interface DrumGrid {
  /** Display name, shown in the sequencer's grid menu. */
  name: string;
  /** The meter this grid was authored in. */
  meter: MeterId;
  /**
   * The drum kit this rhythm was written for, by `DRUM_KITS` name. The
   * sequencer applies it with the grid; a vibe names its own `soundKit` and
   * may disagree, because a vibe chooses a sound as well as a rhythm.
   */
  kit: string;
  /**
   * Where this rhythm came from: a source URL, or the literal `'authored'`.
   *
   * A research pass was spent rediscovering which of the library's grids had a
   * documented basis and which were invented, and the answer was not
   * recoverable from the table — nobody recorded it when the grids were
   * written. The table carries it now, so the next "where did this rhythm come
   * from?" is answered by reading the entry.
   *
   * `'authored'` is an honest answer and an allowlisted one: see the provenance
   * describe-block in drumGrids.test.ts. Never invent a URL to get off that
   * list — a tangentially related source is worse than no source, because it
   * reads as verification.
   */
  provenance: string;
  /**
   * instrument -> one bar of on/off steps, at this entry's own meter. One line
   * per row: a rhythm is only readable as a row.
   */
  rows: Record<string, boolean[]>;
}

export const DRUM_GRIDS: Record<string, DrumGrid> = {
  // --- Sequencer genre grids (were DRUM_GRIDS, keyed by display name) ---
  synthwave: {
    name: 'Synthwave',
    meter: '4/4',
    kit: 'Retro Drive',
    provenance: 'attackmagazine.com/technique/beat-dissected/synthwave-drums/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, true],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, true, true, true, true, true, true, true, true, true, false, true, true, true, true, true],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      // Re-voicing only: hits stay at 13 and 15, sourced and unmoved. The
      // descent is the snare already at 12, then hitom 13, then lowtom 15
      // over the kick that is already at 15 — snare -> hi tom -> low tom ->
      // kick, the four-step shape, with not one step moved in a sourced
      // transcription.
      hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },
  house: {
    name: 'House',
    meter: '4/4',
    kit: 'Club Standard',
    // The survey found house MATCHES a sourced canonical pattern (kick 0,4,8,12,
    // backbeat 4,12, offbeat open hats) but did not record which page. Until
    // someone writes the URL down, 'authored' is the honest label — that is the
    // allowlist working, not a gap in it.
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      // From edm-offbeat-pump, which was deleted because house and
      // trance/festival EDM are literally identical on this grid: sources
      // separate them by sound design and sidechain, never by step position.
      // These two rows are ADDITIVE — nothing in house was replaced — and they
      // are what keeps cyber-edm's sound intact now that it points here.
      //
      // One added hit, and the clap is the first step: house has no snare
      // row by a sourced slice-2 decision, so the clap carries the backbeat
      // and the descent is clap 12 -> hitom 13 -> lowtom 14, with the
      // authored ornament at 7 kept on lowtom.
      hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false],
      lowtom:  [false, false, false, false, false, false, false, true, false, false, false, false, false, false, true, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  trap: {
    name: 'Trap',
    meter: '4/4',
    kit: 'Trap Beat',
    provenance: 'reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
    },
  },
  'boom-bap': {
    name: 'Boom Bap',
    meter: '4/4',
    kit: 'Dusty Break',
    provenance: 'attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    meter: '4/4',
    kit: 'Chrome Pulse',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false],
      // One ghost snare moves, nothing is deleted: the 14 ghost moves back to
      // 13 so the fill starts on it: snare 13 -> hitom 14 -> lowtom 15. Both
      // authored ornaments (2, 11) stay on lowtom.
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
      hihat:   [true, true, false, true, true, false, true, true, false, true, true, false, true, true, false, true],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, true, false, false, false, false, false, false, false, false, true, false, false, false, true],
    },
  },
  dnb: {
    name: 'DnB',
    meter: '4/4',
    kit: 'Velocity Breaks',
    // As with house: the survey verified dnb against a source and recorded the
    // verdict, not the URL.
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },
  dubstep: {
    name: 'Dubstep',
    meter: '4/4',
    kit: 'Sub Weight',
    provenance: 'unison.audio/how-to-make-dubstep/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  techno: {
    name: 'Techno',
    meter: '4/4',
    kit: 'Warehouse',
    provenance: 'attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/',
    // The exception, and it keeps its two hits on one drum. This 14/15 pair
    // is a timekeeping device, a 16th roll into the next bar, not a fill; it
    // has no snare row to start one on (clap-only, sourced); and it is a
    // sourced transcription, so nothing may be added. Both hits stay on
    // lowtom and it gets no hitom row — the row is now audibly a low tom
    // instead of an unnamed "tom", which is the whole change.
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      hihat:   [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, true],
    },
  },
  funk: {
    name: 'Funk',
    meter: '4/4',
    kit: 'Tight Pocket',
    provenance: 'articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/',
    rows: {
      kick:    [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, true, true, true, true, false, true, true, true, true, true, true, true, false, true, true],
      openhat: [false, false, false, false, false, true, false, false, false, false, false, false, false, true, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },
  rock: {
    name: 'Rock',
    meter: '4/4',
    kit: 'Acoustic Studio',
    // The survey checked rock against a sourced transcription and it MATCHED —
    // kick 0,8 with the backbeat at 4,12 and straight 8th hats. It is the only
    // grid whose rows and whose source already agree, which is why it is the
    // only one sourced before Task 3 rewrites anything.
    provenance: 'fundamental-changes.com/learn-to-play-backbeat-on-drums/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },
  reggae: {
    name: 'Reggae',
    meter: '4/4',
    kit: 'Warm Riddim',
    provenance: 'soundbrenner.com/blogs/articles/rockers-rhythm',
    rows: {
      kick:    [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'lofi-hip-hop': {
    name: 'Lo-Fi Hip-Hop',
    meter: '4/4',
    kit: 'Lo-Fi Vinyl',
    provenance: 'blog.native-instruments.com/lo-fi-hip-hop-beats/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  waltz: {
    name: 'Waltz',
    meter: '3/4',
    kit: 'Acoustic Studio',
    // `hihat 0,4,6,8` was the jazz-waltz RIDE figure, written on the hi-hat
    // row because slice 1 had no ride voice. It moves to `ride` unchanged;
    // the cross-stick moves off `snare` onto `rimshot`. Re-voicing only —
    // the source always meant ride and rimshot, so the transcription holds.
    provenance: 'studydrums.com/hsid/jzwalz01.html',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, false, false, false, true, false, false, false, true, false, false, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false],
      ride:    [true, false, false, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },
  'afro-6-8': {
    name: 'Afro 6/8',
    meter: '6/8',
    kit: 'Acoustic Studio',
    // The 7-stroke bembé bell — steps 0,2,4,5,7,9,11 — was written onto `hihat`
    // in slice 1 as the half of the fix that needed no new voice, and it was
    // recorded then that the timbre stayed wrong. It moves to `bell` unchanged,
    // and the cross-stick moves off `snare`. Only now can a bell and a hi-hat
    // sound at the same time, which is what the source arrangement does.
    provenance: 'Jerry Leake, "Perspectives on the Standard African Bell" (uvic.ca)',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, true, false, false, true, false, false, true, false, false, true, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false],
      bell:    [true, false, true, false, true, true, false, true, false, true, false, true],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },

  // --- Instant Vibe grids (were VIBE_DRUM_GRIDS, cells were 0/1) ---
  'lofi-half-time-brush': {
    name: 'Lo-Fi Half-Time Brush',
    meter: '4/4',
    kit: 'Dusty Break',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, false, true, true, false, true, false, true, false, false, true],
      openhat: [false, false, false, false, false, false, true, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'synthwave-four-on-floor': {
    name: 'Synthwave Four-on-Floor',
    meter: '4/4',
    kit: 'Retro Drive',
    provenance: 'authored',
    // One added hit, in two rows: the snare gains 13 and the clap gains 13
    // with it — drumGrids.test.ts pins this grid's clap as byte-identical to
    // its snare (an LM-1 clap over a gated snare), and that layering is right
    // and stays right. Then hitom 14, lowtom 15.
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
      hihat:   [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
      hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'ambient-sparse-drift': {
    name: 'Ambient Sparse Drift',
    meter: '4/4',
    kit: 'Acoustic Studio',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'boombap-swung-break': {
    name: 'Boom Bap Swung Break',
    meter: '4/4',
    kit: 'Dusty Break',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, true, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, true, true, false, true, false, true, false, true, true, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'zen-bamboo-pulse': {
    name: 'Zen Bamboo Pulse',
    meter: '4/4',
    kit: 'Acoustic Studio',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'waltz-brush-three': {
    name: 'Waltz Brush Three',
    meter: '3/4',
    kit: 'Lo-Fi Vinyl',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, true],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'afro-six-eight-bell': {
    name: 'Afro 6/8 Bell',
    meter: '6/8',
    kit: 'Acoustic Studio',
    provenance: 'authored',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, false, false, false, true, false, false, false, false, false, true, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false],
      bell:    [true, false, true, false, true, false, true, false, false, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, true, false, false, false, false, false, false, false, false, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },

  // --- Sourced genre variants (survey Part 3) ---
  //
  // Each of these is ONE source's canonical pattern, transcribed, and nothing
  // else. Where a source is silent about a row, the row is present and empty:
  // a grid should STATE what it plays, including where it plays nothing, so a
  // reviewer reading one entry does not have to know which tracks exist to
  // know what it sounds like. `lowtom` and `bass` are all-false on all nine — no
  // source specifies either, and inventing a low-tom fill is the exact thing
  // this whole change exists to stop.
  //
  // The two twelve-step entries from the same survey table
  // (`bembe-standard-bell`, `jazz-waltz-ride`) are SLICE 2: both are defined by
  // a row the schema does not have yet.
  'techno-rolling': {
    name: 'Techno Rolling 16ths',
    meter: '4/4',
    kit: 'Warehouse',
    provenance: 'attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/',
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      hihat:   [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'synthwave-attack': {
    name: 'Synthwave Attack',
    meter: '4/4',
    kit: 'Retro Drive',
    provenance: 'attackmagazine.com/technique/beat-dissected/synthwave-drums/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, true],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'dubstep-halftime': {
    name: 'Dubstep Half-Time',
    meter: '4/4',
    kit: 'Sub Weight',
    provenance: 'unison.audio/how-to-make-dubstep/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'trap-quarter-hat': {
    name: 'Trap Quarter Hat',
    meter: '4/4',
    kit: 'Trap Beat',
    provenance: 'reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      hihat:   [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'boombap-8th-hat': {
    name: 'Boom Bap 8th Hat',
    meter: '4/4',
    kit: 'Dusty Break',
    provenance: 'attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'lofi-ghost-kick': {
    name: 'Lo-Fi Ghost Kick',
    meter: '4/4',
    kit: 'Lo-Fi Vinyl',
    provenance: 'blog.native-instruments.com/lo-fi-hip-hop-beats/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, true, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'funky-drummer': {
    name: 'Funky Drummer',
    meter: '4/4',
    kit: 'Tight Pocket',
    // MEASURED: this differs from the corrected `funk` entry on CLAP ALONE
    // (funk claps 4,12; this source specifies none). They stay two entries
    // because they came from two places, and the ghost-note velocities that
    // actually separate them are not storable in a boolean grid (survey
    // Part 4). Do not collapse them and do not add a clap to make them differ.
    provenance: 'articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/',
    rows: {
      kick:    [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, true, true, true, true, false, true, true, true, true, true, true, true, false, true, true],
      openhat: [false, false, false, false, false, true, false, false, false, false, false, false, false, true, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'rock-driving-8th': {
    name: 'Rock Driving 8ths',
    meter: '4/4',
    kit: 'Acoustic Studio',
    provenance: 'fundamental-changes.com/learn-to-play-backbeat-on-drums/',
    rows: {
      kick:    [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'reggae-rockers': {
    name: 'Reggae Rockers',
    meter: '4/4',
    kit: 'Warm Riddim',
    provenance: 'soundbrenner.com/blogs/articles/rockers-rhythm',
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
};
