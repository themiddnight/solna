import { describe, expect, test } from 'bun:test';
import { DRUM_GRIDS } from './drumGrids';
import { DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';
import { getMeter, isMeterId } from '@/utils/meter';

// The three origin groups, kept apart in the test even though the table is
// one: 14 sequencer genre grids, 7 Instant Vibe grids, 9 sourced genre
// variants. Where an entry came from is the only thing that explains why the
// row sets differ, and a merge that quietly dropped one group would still pass
// a single 30-long list.
const GENRE_GRID_IDS = [
  'synthwave',
  'house',
  'trap',
  'boom-bap',
  'cyberpunk',
  'dnb',
  'dubstep',
  'techno',
  'funk',
  'rock',
  'reggae',
  'lofi-hip-hop',
  'waltz',
  'afro-6-8',
];

const VIBE_GRID_IDS = [
  'lofi-half-time-brush',
  'synthwave-four-on-floor',
  'ambient-sparse-drift',
  'boombap-swung-break',
  'zen-bamboo-pulse',
  'waltz-brush-three',
  'afro-six-eight-bell',
];

// A third origin, and it earns its own list for the same reason the first two
// have theirs: where an entry came from is what explains its shape. These nine
// are transcriptions — each is one source's canonical pattern and nothing else,
// which is why several have rows the genre would normally fill.
const SOURCED_GRID_IDS = [
  'techno-rolling',
  'synthwave-attack',
  'dubstep-halftime',
  'trap-quarter-hat',
  'boombap-8th-hat',
  'lofi-ghost-kick',
  'funky-drummer',
  'rock-driving-8th',
  'reggae-rockers',
];

const ALL_IDS = [...GENRE_GRID_IDS, ...VIBE_GRID_IDS, ...SOURCED_GRID_IDS];

const METERS: Record<string, string> = {
  synthwave: '4/4',
  house: '4/4',
  trap: '4/4',
  'boom-bap': '4/4',
  cyberpunk: '4/4',
  dnb: '4/4',
  dubstep: '4/4',
  techno: '4/4',
  funk: '4/4',
  rock: '4/4',
  reggae: '4/4',
  'lofi-hip-hop': '4/4',
  waltz: '3/4',
  'afro-6-8': '6/8',
  'lofi-half-time-brush': '4/4',
  'synthwave-four-on-floor': '4/4',
  'ambient-sparse-drift': '4/4',
  'boombap-swung-break': '4/4',
  'zen-bamboo-pulse': '4/4',
  'waltz-brush-three': '3/4',
  'afro-six-eight-bell': '6/8',
  'techno-rolling': '4/4',
  'synthwave-attack': '4/4',
  'dubstep-halftime': '4/4',
  'trap-quarter-hat': '4/4',
  'boombap-8th-hat': '4/4',
  'lofi-ghost-kick': '4/4',
  'funky-drummer': '4/4',
  'rock-driving-8th': '4/4',
  'reggae-rockers': '4/4',
};

// Boolean row -> the step indices that fire. The `?? []` guard makes a row the
// grid does not declare read as silent rather than throwing, so an assertion
// about an absent row states what it means.
const on = (id: string, row: string) =>
  (DRUM_GRIDS[id].rows[row] ?? []).map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

const ALL_SIXTEEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const STRAIGHT_EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
// An open hat and a closed hat are the same instrument (spec decision 20):
// "rolling 16ths with an offbeat open" is one source figure, read correctly
// as the open REPLACING the closed on those steps, not sounding alongside it.
const closedUnder = (all: number[], opens: number[]) => all.filter((i) => !opens.includes(i));

describe('DRUM_GRIDS data sanity', () => {
  test('holds exactly the 30 grid ids — 14 sequencer genres, 7 vibe grids and 9 sourced variants', () => {
    expect(Object.keys(DRUM_GRIDS).sort()).toEqual([...ALL_IDS].sort());
  });

  test('every grid declares a real meter, and the one it was authored in', () => {
    for (const id of ALL_IDS) {
      expect(isMeterId(DRUM_GRIDS[id].meter), `${id} meter`).toBe(true);
      expect(DRUM_GRIDS[id].meter, id).toBe(METERS[id]);
    }
  });

  test('every grid carries a non-empty display name, and no name is used twice', () => {
    const names = ALL_IDS.map((id) => DRUM_GRIDS[id].name);
    for (const [i, name] of names.entries()) {
      expect(name.length, `${ALL_IDS[i]} name`).toBeGreaterThan(0);
    }
    expect(new Set(names).size, 'duplicate display name').toBe(names.length);
  });

  test('every grid names a real drum kit', () => {
    // The sequencer's grid menu writes both in one action: pick "Trap" and it
    // loads the Trap grid AND the Trap Beat kit. A grid naming a kit that does
    // not exist is a menu entry that half-works.
    for (const id of ALL_IDS) {
      const kit = DRUM_GRIDS[id].kit;
      expect(DRUM_KITS[kit], `${id} -> ${kit}`).toBeTruthy();
    }
  });

  test('no grid asks one hi-hat to be open and closed on the same step', () => {
    // A hi-hat is ONE physical instrument: the closure is the damping. Where an
    // open hat sounds, the closed hat is off. "16th hats with an open on the
    // offbeat" means the open REPLACES the closed on that step — writing both
    // rows true was our transcription artefact, not what any source said.
    //
    // This is also a prerequisite for the choke group (spec decision 28): with
    // the choke in place, a colliding step is an open hat killed instantly by
    // its own closed hat, which sounds worse than today's doubled hit.
    const collisions: string[] = [];
    for (const id of ALL_IDS) {
      const hihat = DRUM_GRIDS[id].rows.hihat ?? [];
      const openhat = DRUM_GRIDS[id].rows.openhat ?? [];
      for (let i = 0; i < openhat.length; i++) {
        if (openhat[i] && hihat[i]) collisions.push(`${id}:${i}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  // genre-drum-voice-selection.md §2, one line per verdict. A clap is a drum
  // machine sound; six of these genres have no drum machine in them at all, and
  // two of them have no snare — the clap IS the backbeat. Pinned per grid,
  // because "the clap row is wrong" is not a rule a sweep can state.
  const NO_CLAP_ROW = [
    'boom-bap',            // sampled acoustic snare, never a machine clap (LANDR, SP-1200)
    'boombap-swung-break', // same genre, same reason
    'dnb',                 // the Amen break is an acoustic kit (Wikipedia, Amen break)
    'funk',                // no clap (PAS, ghost-note funk)
    'rock',                // no clap (Rhythm Notes)
    'afro-six-eight-bell', // cross-stick and bell, no clap (Sunhouse, bembe)
    'afro-6-8',            // same idiom, and its clap 4,10 was a stray
    'waltz',               // jazz waltz has no clap (Drumeo); its clap 8 was a stray
    'waltz-brush-three',   // same stray, in the lo-fi waltz reading
  ];

  // House and techno: the clap carries the backbeat and the snare is the one
  // that goes (Amped Studio; Studio Brootle / Attack).
  const NO_SNARE_ROW = ['house', 'techno'];

  test('the grids whose genre has no clap do not declare a clap row', () => {
    for (const id of NO_CLAP_ROW) {
      expect(DRUM_GRIDS[id].rows.clap, `${id} must omit clap`).toBeUndefined();
    }
  });

  test('house and techno are clap-only: the clap carries the backbeat, the snare row goes', () => {
    for (const id of NO_SNARE_ROW) {
      expect(DRUM_GRIDS[id].rows.snare, `${id} must omit snare`).toBeUndefined();
      expect(DRUM_GRIDS[id].rows.clap, `${id} must keep clap`).toBeDefined();
    }
  });

  test('the two lo-fi claps are thinned to a colour, not a backbeat', () => {
    // "Snap/clap is a thin colour, never the backbeat" (Mondo Loops). Both grids
    // clapped 4 AND 12 in unison with the snare; one hit on the second backbeat
    // is the colour, and the snare keeps the beat.
    expect(on('lofi-hip-hop', 'clap')).toEqual([12]);
    expect(on('lofi-half-time-brush', 'clap')).toEqual([12]);
  });

  test('the four correct clap/snare layers are left alone', () => {
    // Trap layers clap with snare (eMastered); dubstep uses the clap as the
    // high-passed top of the snare (SOS); synthwave is an LM-1 clap over a gated
    // snare (loops de la creme). These are right, and stay right.
    const same = (id: string) =>
      JSON.stringify(DRUM_GRIDS[id].rows.clap) === JSON.stringify(DRUM_GRIDS[id].rows.snare);
    for (const id of ['trap', 'dubstep', 'synthwave', 'synthwave-four-on-floor']) {
      expect(same(id), `${id} clap must still layer its snare`).toBe(true);
    }
  });

  test('the four boom-bap-family grids name Dusty Break, not 808 Vintage', () => {
    // Boom bap's instrument is acoustic breaks through a 12-bit SP-1200
    // (LANDR; Levels), the opposite of a bridged-T sine. Moving them off the
    // 808 is also what frees 808 Vintage to be an actual 808.
    for (const id of ['boom-bap', 'boombap-swung-break', 'boombap-8th-hat', 'lofi-half-time-brush']) {
      expect(DRUM_GRIDS[id].kit, id).toBe('Dusty Break');
    }
  });

  test('the two Afro 6/8 grids agree on one kit', () => {
    // They disagreed: Warm Riddim vs Acoustic Studio for the same idiom. Warm
    // Riddim's 4500 Hz hat is the second-darkest in the library and a bembe
    // bell is bright and cutting, so both take Acoustic Studio.
    expect(DRUM_GRIDS['afro-6-8'].kit).toBe('Acoustic Studio');
    expect(DRUM_GRIDS['afro-six-eight-bell'].kit).toBe('Acoustic Studio');
  });

  test('ambient-sparse-drift is on the kit with the long tails, not the techno kit', () => {
    // Warehouse has the shortest decays in the library; ambient wants the wash
    // on the cymbal, and Acoustic Studio is the only kit with a long crash
    // (1.7 s) and a full-bodied tom (0.45 s decay).
    expect(DRUM_GRIDS['ambient-sparse-drift'].kit).toBe('Acoustic Studio');
  });

  test('no grid still names 808 Vintage, which is now free to be an actual 808', () => {
    const stragglers = ALL_IDS.filter((id) => DRUM_GRIDS[id].kit === '808 Vintage');
    expect(stragglers).toEqual([]);
  });

  // The seven voices a sequencer track can actually play today, derived rather
  // than restated: `bass` was never one of them — no DrumKit field, no
  // triggerDrum case, no track — which is why slice 2 deleted the row instead
  // of keeping it as "unplayable but authored". With that gone, a grid row name
  // and a kit voice name are the same set, and this assertion is what says so.
  const KNOWN_ROW_NAMES: readonly string[] = DRUM_TYPES;

  const unknownRows = (rows: Record<string, boolean[]>) =>
    Object.keys(rows).filter((row) => !KNOWN_ROW_NAMES.includes(row));

  test('a grid declares only known voice names, and may omit any of them', () => {
    // ONE assertion where there were three (genre / vibe / sourced), because
    // there is now one rule: replaceDrumPattern clears every track no row names,
    // so an omitted row and an all-false row are identical in effect and the
    // row SET is no longer part of a grid's contract. What is still forbidden is
    // naming something no track can ever play.
    //
    // Omission is legal; it is not the recommended way to say "silent". A row of
    // false states the genre plays nothing there; an omitted row states the
    // question was not asked. See the authoring guidance in drumGrids.ts.
    for (const id of ALL_IDS) {
      expect(unknownRows(DRUM_GRIDS[id].rows), `${id} declares an unknown row`).toEqual([]);
      expect(Object.keys(DRUM_GRIDS[id].rows).length, `${id} declares no rows at all`).toBeGreaterThan(0);
    }
  });

  test('the row-name check can actually fail', () => {
    // Guards the guard. An assertion that has only ever seen good data is not a
    // check — this pins that an unknown name IS rejected, without putting one in
    // the shipped table.
    expect(unknownRows({ ...DRUM_GRIDS.house.rows, banjo: [] })).toEqual(['banjo']);
  });

  test("every row is exactly its own meter's bar length, in booleans", () => {
    for (const id of ALL_IDS) {
      const grid = DRUM_GRIDS[id];
      const expected = getMeter(grid.meter).stepsPerBar;
      for (const [instrument, steps] of Object.entries(grid.rows)) {
        expect(steps.length, `${id}/${instrument} must be ${expected} steps`).toBe(expected);
        expect(
          steps.every((v) => typeof v === 'boolean'),
          `${id}/${instrument} must be booleans`,
        ).toBe(true);
      }
    }
  });

  test('the rows survived the merge byte-for-byte, spot-checked on both origins', () => {
    // Synthwave kick: 1, 3 and the 'a' of 4 (Task 3's sourced correction).
    // Pinned so neither the merge nor the 0/1 -> boolean retype could silently
    // reorder or rewrite a row.
    expect(DRUM_GRIDS.synthwave.rows.kick).toEqual([
      true, false, false, false, false, false, false, false,
      true, false, false, false, false, false, false, true,
    ]);
    expect(DRUM_GRIDS['boom-bap'].rows.snare).toEqual([
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false,
    ]);
    expect(DRUM_GRIDS['lofi-half-time-brush'].rows.kick).toEqual([
      true, false, false, false, false, false, false, false,
      false, false, true, false, false, false, false, false,
    ]);
    // Was the edm-offbeat-pump assertion. The grid is gone; its two authored
    // rows are here, which is the thing worth pinning.
    expect(DRUM_GRIDS.house.rows.lowtom).toEqual([
      false, false, false, false, false, false, false, true,
      false, false, false, false, false, false, true, false,
    ]);
    // The beat-1 crash was zeroed (see drumGrids.ts): all-false, row kept.
    expect(DRUM_GRIDS.house.rows.crash).toEqual([
      false, false, false, false, false, false, false, false,
      false, false, false, false, false, false, false, false,
    ]);
  });
});

describe('the nine sourced variants transcribe one source each', () => {
  test('techno-rolling is four-on-the-floor under rolling 16ths, offbeat opens (Attack Magazine, Motor City)', () => {
    expect(on('techno-rolling', 'kick')).toEqual([0, 4, 8, 12]);
    expect(on('techno-rolling', 'hihat')).toEqual(closedUnder(ALL_SIXTEEN, [2, 6, 10, 14]));
    expect(on('techno-rolling', 'openhat')).toEqual([2, 6, 10, 14]);
    // The source specifies no backbeat. Written as authored, not invented into.
    expect(on('techno-rolling', 'snare')).toEqual([]);
  });

  test('synthwave-attack is the 1-3-and-a kick with a backbeat and 16th hats (Attack Magazine, synthwave drums)', () => {
    expect(on('synthwave-attack', 'kick')).toEqual([0, 8, 15]);
    expect(on('synthwave-attack', 'snare')).toEqual([4, 12]);
    expect(on('synthwave-attack', 'hihat')).toEqual(ALL_SIXTEEN);
  });

  test('dubstep-halftime is one kick and one snare a bar, and nothing else (Unison)', () => {
    expect(on('dubstep-halftime', 'kick')).toEqual([0]);
    expect(on('dubstep-halftime', 'snare')).toEqual([8]);
    expect(on('dubstep-halftime', 'hihat')).toEqual([]);
  });

  test('trap-quarter-hat claps the half-bar over quarter-note hats (Reason Studios trap cheat sheet)', () => {
    expect(on('trap-quarter-hat', 'kick')).toEqual([0, 6, 10]);
    expect(on('trap-quarter-hat', 'clap')).toEqual([8]);
    expect(on('trap-quarter-hat', 'hihat')).toEqual([0, 4, 8, 12]);
    expect(on('trap-quarter-hat', 'openhat')).toEqual([6]);
  });

  test('boombap-8th-hat is the 0-6-8 kick with a backbeat and straight 8ths (Attack Magazine, 90s boom bap)', () => {
    expect(on('boombap-8th-hat', 'kick')).toEqual([0, 6, 8]);
    expect(on('boombap-8th-hat', 'snare')).toEqual([4, 12]);
    expect(on('boombap-8th-hat', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test('lofi-ghost-kick adds a ghost kick on the last 8th (Native Instruments, lo-fi hip hop beats)', () => {
    expect(on('lofi-ghost-kick', 'kick')).toEqual([0, 8, 14]);
    expect(on('lofi-ghost-kick', 'snare')).toEqual([4, 12]);
    expect(on('lofi-ghost-kick', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test('funky-drummer is the Stubblefield kick with 16th hats opening on the e of 2 and 4 (Roland)', () => {
    // Differs from the corrected `funk` on CLAP ALONE — funk claps 4,12, this
    // has no clap because the source has none. Measured, recorded, and left as
    // transcribed: they are two entries because they came from two places.
    expect(on('funky-drummer', 'kick')).toEqual([0, 7, 10]);
    expect(on('funky-drummer', 'snare')).toEqual([4, 12]);
    expect(on('funky-drummer', 'hihat')).toEqual(closedUnder(ALL_SIXTEEN, [5, 13]));
    expect(on('funky-drummer', 'openhat')).toEqual([5, 13]);
  });

  test('rock-driving-8th kicks every 8th under the backbeat (Fundamental Changes, backbeat)', () => {
    expect(on('rock-driving-8th', 'kick')).toEqual(STRAIGHT_EIGHTHS);
    expect(on('rock-driving-8th', 'snare')).toEqual([4, 12]);
    expect(on('rock-driving-8th', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test('reggae-rockers is four-on-the-floor with the cross-stick on 3 (Soundbrenner, rockers rhythm)', () => {
    // Rockers, not one drop: the kick plays all four beats. That is exactly
    // what separates it from the corrected `reggae` entry, which kicks only 3.
    expect(on('reggae-rockers', 'kick')).toEqual([0, 4, 8, 12]);
    expect(on('reggae-rockers', 'rimshot')).toEqual([8]);
    // The cross-stick moved off snare — snare must stay silent there, not
    // merely unmentioned.
    expect(on('reggae-rockers', 'snare')).toEqual([]);
    expect(on('reggae-rockers', 'hihat')).toEqual(closedUnder(STRAIGHT_EIGHTHS, [14]));
    expect(on('reggae-rockers', 'openhat')).toEqual([14]);
  });
});

describe('what the two former tables actually share', () => {
  // This is why the vibe grids survived the merge as their own entries — and it
  // is a MEASUREMENT, not a principle, so it is pinned here rather than
  // asserted in a comment. Merging the two TABLES cost no sound. Merging the
  // CONTENT would: every vibe grid is a different rhythm from its own genre's
  // grid on the rows a sequencer track reaches. There is no longer any pair
  // that plays identically — see SILENT_DUPLICATES below, which is empty.
  //
  // PLAYABLE is the seven voices a sequencer track plays today. It was the
  // pre-`tom`/`crash` five, with a note to widen it "before authoring any new
  // grid that might create one, not after" — and decision 21's sourced clap
  // deletion is exactly that moment: `funk` and `funky-drummer` differed on the
  // CLAP ALONE, so dropping funk's clap made them identical on the old
  // five-row signature. They still differ on `lowtom` (funk 15, funky-drummer
  // none), which is a real audible difference, so the honest fix is a wider
  // signature rather than an exception table.
  const PLAYABLE = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'];

  const playableRowsDiffer = (a: string, b: string) =>
    PLAYABLE.filter((row) => on(a, row).join('/') !== on(b, row).join('/'));

  const GENUINELY_DIFFERENT: Array<[string, string]> = [
    ['synthwave-four-on-floor', 'synthwave'],
    ['boombap-swung-break', 'boom-bap'],
    ['lofi-half-time-brush', 'lofi-hip-hop'],
    ['waltz-brush-three', 'waltz'],
  ];

  for (const [vibeGrid, genreGrid] of GENUINELY_DIFFERENT) {
    test(`${vibeGrid} is a different rhythm from ${genreGrid}`, () => {
      expect(playableRowsDiffer(vibeGrid, genreGrid).length).toBeGreaterThan(0);
    });
  }

  // EMPTY, and that is the strongest form this test has ever had. Both former
  // members are gone for different reasons: edm-offbeat-pump was deleted
  // (house and festival EDM cannot be honestly distinguished on a step grid),
  // and afro-6-8's snare and hihat were corrected to the cross-stick and the
  // standard bembé bell. Any new duplicate is now a failure with no allowlist
  // to hide behind. Never add a member to make a test pass.
  const SILENT_DUPLICATES: Array<[string, string]> = [];

  for (const [vibeGrid, genreGrid] of SILENT_DUPLICATES) {
    test(`${vibeGrid} and ${genreGrid} play identically — they differ only in silent rows`, () => {
      expect(playableRowsDiffer(vibeGrid, genreGrid)).toEqual([]);
      // ...and they are still two entries, because what separates them is real
      // authored content on rows no sequencer track reaches yet.
      expect(Object.keys(DRUM_GRIDS[vibeGrid].rows)).toContain('crash');
      expect(Object.keys(DRUM_GRIDS[genreGrid].rows)).toContain('bass');
    });
  }

  test('no other pair of grids is a silent duplicate', () => {
    // A silent duplicate means these two SOUND the same. That test used to
    // count `kit` as a distinguisher, because picking a grid in the sequencer
    // loaded its kit as well as its rows — the comment then said the predicate
    // "has to narrow again" if the picker ever stopped doing that, and it has:
    // `SequencerView.applyDrumGrid` now calls `replaceDrumPattern(grid.rows)`
    // and writes no kit, so two grids with identical playable rows are
    // identical on screen and in the speakers whatever kit each was authored
    // against. `DRUM_GRIDS[id].kit` survives as provenance — the kit the grid
    // was transcribed with — and nothing in production reads it: the vibe/dice
    // path writes `vibe.soundKit`, never `grid.kit`.
    //
    // The sweep covers every unordered pair of the 30 ids, because a genre x
    // genre collision cannot be expressed by a vibe-only sweep and would sound
    // identical to a vibe/genre-only check.
    const isSilentDuplicate = (a: string, b: string) =>
      DRUM_GRIDS[a].meter === DRUM_GRIDS[b].meter &&
      playableRowsDiffer(a, b).length === 0;

    const found: string[] = [];
    for (let i = 0; i < ALL_IDS.length; i++) {
      for (let j = i + 1; j < ALL_IDS.length; j++) {
        const [a, b] = [ALL_IDS[i], ALL_IDS[j]];
        if (isSilentDuplicate(a, b)) found.push([a, b].sort().join('='));
      }
    }
    expect(found.sort()).toEqual(
      SILENT_DUPLICATES.map(([v, g]) => [v, g].sort().join('=')).sort(),
    );
  });
});

describe('the twelve-step grids state their meter through their accents', () => {
  test('Waltz is oom-pah-pah on the [4,4,4] beat set', () => {
    expect(on('waltz', 'kick')).toEqual([0]);
    expect(on('waltz', 'rimshot')).toEqual([4, 8]);
    // The cross-stick and the ride moved off snare/hihat — both rows must
    // stay silent there, not merely unmentioned.
    expect(on('waltz', 'snare')).toEqual([]);
    expect(on('waltz', 'hihat')).toEqual([]);
  });

  test('Afro 6/8 kicks the two dotted-quarter beats and cross-sticks 1,4,7,10', () => {
    expect(on('afro-6-8', 'kick')).toEqual([0, 6]);
    expect(on('afro-6-8', 'rimshot')).toEqual([1, 4, 7, 10]);
    // The cross-stick and the bembé bell moved off snare/hihat — both rows
    // must stay silent there, not merely unmentioned.
    expect(on('afro-6-8', 'snare')).toEqual([]);
    expect(on('afro-6-8', 'hihat')).toEqual([]);
  });

  test('waltz-brush-three is 3/4: one kick, weak beat at 4', () => {
    // No clap assertion: decision 21 dropped this row — the clap at 8 was a
    // stray in a genre (jazz waltz) that has no clap at all.
    expect(on('waltz-brush-three', 'kick')).toEqual([0]);
    expect(on('waltz-brush-three', 'snare')).toEqual([4]);
  });

  test('afro-six-eight-bell is 6/8: kicks on both beats, cross-stick on the pushes', () => {
    expect(on('afro-six-eight-bell', 'kick')).toEqual([0, 6]);
    expect(on('afro-six-eight-bell', 'rimshot')).toEqual([4, 10]);
    // The cross-stick moved off snare — snare must stay silent there, not
    // merely unmentioned.
    expect(on('afro-six-eight-bell', 'snare')).toEqual([]);
  });

  test('no two twelve-step grids are the same pattern under different names', () => {
    // Bar length cannot tell 3/4 from 6/8, and kick alone no longer
    // disambiguates every pair: `waltz` and `waltz-brush-three` both kick
    // [0], and `afro-6-8` and `afro-six-eight-bell` both kick [0,6]. The
    // signature widens to kick+snare+rimshot+bell so each colliding pair is
    // told apart by whichever of those rows actually differs between them.
    const twelve = ['waltz', 'afro-6-8', 'waltz-brush-three', 'afro-six-eight-bell'];
    const rowsToCheck = ['kick', 'snare', 'rimshot', 'bell'];
    for (const id of twelve) {
      expect(DRUM_GRIDS[id].rows.kick.length, id).toBe(12);
    }
    const signatures = twelve.map((id) =>
      rowsToCheck.map((row) => JSON.stringify(on(id, row))).join('|'),
    );
    expect(new Set(signatures).size).toBe(4);
  });
});

describe('provenance', () => {
  /**
   * Grids that are honestly unsourced.
   *
   * The load-bearing half of this file's provenance rules. Shipping a grid with
   * no source is allowed — some rhythms are inventions that sound good — but it
   * has to be a DELIBERATE act: a name added to a list a reviewer sees, not the
   * default that happens when nobody looked for a source.
   *
   * `zen-bamboo-pulse` is the first member by decision. The survey looked and
   * found that "zen garden" is not a documented percussion tradition at all:
   * searches surface karesansui gardens, ambient playlists and Midori Takada,
   * and the nearest real East Asian idioms with notatable patterns (Miyake,
   * Yatai-bayashi taiko) are dense ensemble music — the opposite of the sparse
   * thing this grid is. Attaching a tangentially related source to it would be
   * the exact failure mode `provenance` exists to prevent.
   *
   * This list SHRINKS as sources land. Never grow it to make a test pass.
   */
  const AUTHORED_ALLOWLIST = [
    'house', 'cyberpunk', 'dnb',
    'lofi-half-time-brush', 'synthwave-four-on-floor',
    'ambient-sparse-drift', 'boombap-swung-break', 'zen-bamboo-pulse',
    'waltz-brush-three', 'afro-six-eight-bell',
  ];

  test('every grid records where its rhythm came from', () => {
    for (const [id, grid] of Object.entries(DRUM_GRIDS)) {
      expect(grid.provenance.length, `${id} provenance`).toBeGreaterThan(0);
    }
  });

  test("every grid claiming 'authored' is on the allowlist, and every allowlisted grid exists", () => {
    const authored = Object.entries(DRUM_GRIDS)
      .filter(([, g]) => g.provenance === 'authored')
      .map(([id]) => id);
    expect(authored.sort()).toEqual([...AUTHORED_ALLOWLIST].sort());
  });

  test('a sourced grid names a source, not a vague gesture at one', () => {
    // The only two shapes allowed: the literal 'authored', or something with a
    // dot in it — a URL or a citation. "from a video", "traditional" and
    // "standard" are the failure mode this catches.
    for (const [id, grid] of Object.entries(DRUM_GRIDS)) {
      if (grid.provenance === 'authored') continue;
      expect(grid.provenance.includes('.'), `${id}: "${grid.provenance}"`).toBe(true);
    }
  });
});

describe('the ten corrected grids match their sourced canonical pattern', () => {
  test("techno's hat is rolling 16ths with an open on every offbeat (Attack Magazine, Motor City Detroit techno)", () => {
    expect(on('techno', 'hihat')).toEqual(closedUnder(ALL_SIXTEEN, [2, 6, 10, 14]));
    expect(on('techno', 'openhat')).toEqual([2, 6, 10, 14]);
  });

  test("synthwave's kick is 1, 3 and the 'a' of 4, under rolling 16th hats (Attack Magazine, synthwave drums)", () => {
    expect(on('synthwave', 'kick')).toEqual([0, 8, 15]);
    expect(on('synthwave', 'hihat')).toEqual(closedUnder(ALL_SIXTEEN, [10]));
  });

  test("dubstep kicks once a bar, on 1 (Unison, how to make dubstep)", () => {
    expect(on('dubstep', 'kick')).toEqual([0]);
  });

  test("trap's kick is 1, the 'and-a' of 2 and the 'and' of 3, over quarter-note hats (Reason Studios trap cheat sheet)", () => {
    // The rolls a real trap hat plays are 32nds and triplets. This grid stores
    // 16ths, so the sourced QUARTER-note hat is what is storable and what is
    // written; the rolls are a documented non-goal (survey Part 4).
    expect(on('trap', 'kick')).toEqual([0, 6, 10]);
    expect(on('trap', 'hihat')).toEqual([0, 4, 8, 12]);
    expect(on('trap', 'openhat')).toEqual([6]);
  });

  test("boom bap kicks 1, the 'and' of 2 and 3, under straight 8th hats (Attack Magazine, 90s boom bap)", () => {
    expect(on('boom-bap', 'kick')).toEqual([0, 6, 8]);
    expect(on('boom-bap', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test("lo-fi hip-hop is a two-kick half-time bar with straight 8th hats (Native Instruments, lo-fi hip hop beats)", () => {
    expect(on('lofi-hip-hop', 'kick')).toEqual([0, 8]);
    expect(on('lofi-hip-hop', 'hihat')).toEqual(closedUnder(STRAIGHT_EIGHTHS, [14]));
  });

  test("funk plays 16th hats with the open on the 'e' of 2 and 4 (Roland, Behind the Beat: Funky Drummer)", () => {
    expect(on('funk', 'hihat')).toEqual(closedUnder(ALL_SIXTEEN, [5, 13]));
    expect(on('funk', 'openhat')).toEqual([5, 13]);
  });

  test("reggae's one drop plays straight 8th hats with an open pickup on the last 8th (Soundbrenner, rockers rhythm)", () => {
    expect(on('reggae', 'hihat')).toEqual(closedUnder(STRAIGHT_EIGHTHS, [14]));
    expect(on('reggae', 'openhat')).toEqual([14]);
  });

  // The two that used to land HALF right, corrected: this task moves both
  // rows onto a real voice.
  test("waltz plays the jazz-waltz ride figure — on the RIDE row now (studydrums.com)", () => {
    expect(on('waltz', 'ride')).toEqual([0, 4, 6, 8]);
    expect(DRUM_GRIDS.waltz.rows.ride.length).toBe(12);
  });

  test("afro 6/8 is a cross-stick and the standard bembé bell — both on real voices now (Jerry Leake, uvic.ca)", () => {
    expect(on('afro-6-8', 'rimshot')).toEqual([1, 4, 7, 10]);
    expect(on('afro-6-8', 'bell')).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  // The five two-hit tom grids, pinned exactly: the whole point of this task
  // was giving each a `hitom` (or, for `techno`, deliberately not), and a
  // mutant that slides a step or drops a hit must fail here, not just leave
  // the suite green.
  test('synthwave is re-voiced only — 13 and 15 stay exactly where the source put them (Attack Magazine, synthwave drums)', () => {
    expect(on('synthwave', 'snare')).toEqual([4, 12]);
    expect(on('synthwave', 'hitom')).toEqual([13]);
    expect(on('synthwave', 'lowtom')).toEqual([15]);
  });

  test("techno's tom stays a two-hit roll on one drum — the sourced exception, no hitom row (Attack Magazine, Motor City Detroit techno)", () => {
    expect(on('techno', 'lowtom')).toEqual([14, 15]);
    expect(DRUM_GRIDS.techno.rows.hitom).toBeUndefined();
  });

  test('house gains one authored hitom hit at 13 — the descent starts on the clap', () => {
    expect(on('house', 'clap')).toEqual([4, 12]);
    expect(on('house', 'hitom')).toEqual([13]);
    expect(on('house', 'lowtom')).toEqual([7, 14]);
  });

  test('cyberpunk gains two authored hits — the 14 ghost snare moves to 13, hitom 14, lowtom 15', () => {
    expect(on('cyberpunk', 'snare')).toEqual([4, 12, 13]);
    expect(on('cyberpunk', 'hitom')).toEqual([14]);
    expect(on('cyberpunk', 'lowtom')).toEqual([2, 11, 15]);
  });

  test('synthwave-four-on-floor gains two authored hits — snare and clap both add 13, then hitom 14, lowtom 15', () => {
    expect(on('synthwave-four-on-floor', 'snare')).toEqual([4, 12, 13]);
    expect(on('synthwave-four-on-floor', 'clap')).toEqual([4, 12, 13]);
    expect(on('synthwave-four-on-floor', 'hitom')).toEqual([14]);
    expect(on('synthwave-four-on-floor', 'lowtom')).toEqual([15]);
  });
});
