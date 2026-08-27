import type { MeterId } from '../../utils/meter';

// Genre -> { meter, instrument -> boolean pattern }. Moved verbatim from
// SequencerView.tsx (was lines 23-1560).
//
// One line per row, matching the sibling vibeDrumPatterns.ts: a rhythm is only
// readable as a row. The two libraries stay SEPARATE on purpose — see the note
// at vibeDrumPatterns.ts:9-15.
//
// The `{ meter, rows }` wrapper exists because the flat `Record<string,
// boolean[]>` shape had nowhere to hang metadata, and a pattern's bar length
// alone is not a sufficient tag: 3/4 and 6/8 are both 12 steps and differ only
// in accent grouping.
export interface GenrePreset {
  meter: MeterId;
  rows: Record<string, boolean[]>;
}

export const GENRE_PRESETS: Record<string, GenrePreset> = {
  Synthwave: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, true],
      bass: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    },
  },
  House: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    },
  },
  Trap: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, true, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      bass: [true, false, false, false, false, false, false, false, true, false, true, false, false, false, false, false],
    },
  },
  "Boom Bap": {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, false, true, true, true, false, true, true, true, false, true, true, true, false, true, true],
      openhat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
    },
  },
  Cyberpunk: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, true, false],
      hihat: [true, true, false, true, true, false, true, true, false, true, true, false, true, true, false, true],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, true, false, false, false, false, false, false, false, false, true, false, false, false, false],
      bass: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false],
    },
  },
  DnB: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
    },
  },
  Dubstep: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
      snare: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass: [true, false, false, false, false, false, false, false, true, false, false, false, true, false, false, false],
    },
  },
  Techno: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, true],
      bass: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    },
  },
  Funk: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false],
    },
  },
  Rock: {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    },
  },
  Reggae: {
    meter: '4/4',
    rows: {
      kick: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    },
  },
  "Lo-Fi Hip-Hop": {
    meter: '4/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, true],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass: [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
    },
  },
  // --- 3/4, accentGroups [4,4,4]: twelve steps, beats at 0, 4, 8 ---
  Waltz: {
    meter: '3/4',
    rows: {
      kick: [true, false, false, false, false, false, false, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, true, false, false, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false],
      clap: [false, false, false, false, false, false, false, false, true, false, false, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, false, false, false, false, false, true, false, false, false],
    },
  },
  // --- 6/8, accentGroups [6,6]: twelve steps, but only TWO beats, at 0 and 6 ---
  // Same bar length as Waltz above and deliberately unmistakable for it: the
  // kick sits on 0 and 6 rather than 0 alone, and the snare pushes off the last
  // eighth of each beat (4 and 10) rather than landing on beats 2 and 3.
  'Afro 6/8': {
    meter: '6/8',
    rows: {
      kick: [true, false, false, false, false, false, true, false, false, false, false, false],
      snare: [false, false, false, false, true, false, false, false, false, false, true, false],
      hihat: [true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
      clap: [false, false, false, false, true, false, false, false, false, false, true, false],
      tom: [false, false, false, false, false, false, false, false, false, false, false, true],
      bass: [true, false, false, false, false, false, true, false, false, false, true, false],
    },
  },
};
