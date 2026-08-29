import { SynthParams, InstantVibe } from '../types';
import { audioEngine } from '../audio/engine';
import { applyPreset, presetById } from '../audio/synthPresets';
import { useAppStore } from './store';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';
import { drumPatternById } from '../audio/data/vibeDrumPatterns';
import { requireEffectChain } from '../audio/data/vibeEffectChains';

/**
 * Resolve one of a vibe's three synth voices from a library preset id.
 *
 * The preset supplies the whole sound, and the `preset` display field is
 * stamped from the resolved entry's own name, so the preset select in
 * ChordView points at what is actually playing.
 *
 * Merge order is load-bearing: INITIAL_SYNTH_PARAMS fills the fields presets
 * omit (the four arp fields; `preset` is set here too but immediately
 * overwritten below with the resolved entry's own name), then the preset
 * overrides the 20 timbre fields. No arp field is ever written here — arp is a performance
 * setting the user drives from the UI, and INITIAL_SYNTH_PARAMS.arpActive is
 * already false, so a vibe never switches it on behind the user's back.
 */
export function resolveVibeSynthParams(presetId: string): SynthParams {
  const preset = presetById(presetId);
  if (!preset) {
    throw new Error(`InstantVibe references unknown synth preset id: ${presetId}`);
  }
  return applyPreset(INITIAL_SYNTH_PARAMS, preset);
}

/** Same instant-but-clickless release the hard-stop button uses. */
const VIBE_SWAP_RELEASE = 0.02;

export function applyInstantVibeToStore(vibe: InstantVibe) {
  const store = useAppStore.getState();

  // Resolve all three preset ids first: resolveVibeSynthParams throws on an
  // unknown id, and doing that before any state is touched keeps a typo'd
  // preset id from throwing mid-swap and leaving the transport stopped with
  // the store holding a mix of two vibes.
  const finalChordSynthParams = resolveVibeSynthParams(vibe.chordPresetId);
  const finalBassSynthParams = resolveVibeSynthParams(vibe.bassPresetId);
  const finalSynthParams = resolveVibeSynthParams(vibe.synthPresetId);

  // 0. Atomic swap: cut everything still scheduled BEFORE writing the new
  //    chords and patterns, otherwise the old progression's queued voices
  //    ring on top of the new one. A player that was mid-soft-stop counts as
  //    active and comes back — the user changed vibe, they did not cancel.
  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  store.hardStopAll();
  // The transport transition alone does NOT silence anything: the whole swap
  // runs inside one onClick, React 18 batches it, and the rendered player
  // state goes 'playing' -> 'playing' — so a React effect keyed on it never
  // runs and the queued chord/bass voices sing on over the new vibe.
  // (Measured: React logged a single 'playing' render while the zustand
  // subscription saw 'stopped' then 'playing'.) So cut the sources here,
  // synchronously, where the swap actually happens. store/ -> audio/ is the
  // allowed direction; engineSync.ts reaches the engine the same way.
  // Unconditional: a mid-soft-stop player still has a release pending on the
  // audio clock, and a stopped player may still be ringing out a preview.
  // Drums are fire-and-forget one-shots with no tracked voices — one already
  // scheduled hit can still land, which the spec accepts.
  audioEngine.stopSource('chord', VIBE_SWAP_RELEASE);
  audioEngine.stopSource('bass', VIBE_SWAP_RELEASE);

  // 1. Context & BPM
  store.setBpm(vibe.bpm);
  // MUST precede applyDrumPattern below: that action adapts the incoming rows
  // to whatever meter is active when it runs, so setting the meter afterwards
  // would leave the grid adapted to the OUTGOING vibe's bar length.
  store.setMeter(vibe.meter);
  store.setScaleRoot(vibe.scaleRoot);
  store.setScaleType(vibe.scaleType);
  store.setSelectedVibeId(vibe.id);

  // 2. Drums & Sequencer (Pattern + Sound Kit + Drum Filter)
  store.setSoundKit(vibe.soundKit);
  const boolPattern: Record<string, boolean[]> = {};
  for (const [k, arr] of Object.entries(vibe.drumPattern)) {
    boolPattern[k] = arr.map((val) => val === 1);
  }
  store.applyDrumPattern(boolPattern);

  if (vibe.drumFilterCutoff !== undefined) {
    store.setDrumFilterCutoff(vibe.drumFilterCutoff);
  }
  if (vibe.drumFilterResonance !== undefined) {
    store.setDrumFilterResonance(vibe.drumFilterResonance);
  }
  if (vibe.drumFilterType !== undefined) {
    store.setDrumFilterType(vibe.drumFilterType);
  }

  // 3. Chords & Rhythm Pattern & Feel (Tight/Loose) & Sound Preset
  store.setChords(vibe.chords);
  store.setChordRhythmId(vibe.chordRhythmId);
  store.setChordFeel(vibe.chordFeel);
  store.setChordOctave(vibe.chordOctave);
  store.setChordSynthParams(finalChordSynthParams);

  // 4. Bass Pattern & Feel (Tight/Loose) & Sound Preset
  store.setBassPatternId(vibe.bassPatternId);
  store.setBassFeel(vibe.bassFeel);
  store.setBassOctave(vibe.bassOctave);
  store.setBassSynthParams(finalBassSynthParams);

  // 5. Main Synth Sound Preset
  store.setSynthParams(finalSynthParams);

  // 6. Master Effects
  store.setEffects({
    ...store.effects,
    ...vibe.effects,
  });

  // Restart only what was running. Both playback hooks arm on
  // `step % stepsPerBar === 0` for the ACTIVE meter, which was just set above,
  // so the restart lands on the next bar by construction — no alignment code
  // needed here.
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
  if (wasActive.lead) store.play('lead');
}

export const INSTANT_VIBES: InstantVibe[] = [
  {
    id: 'lofi-chill',
    name: 'Lo-Fi Chill',
    tagline: 'Warm dusty beats & relaxing jazz chords',
    emoji: '☕',
    bpm: 84,
    meter: '4/4',
    scaleRoot: 'C',
    scaleType: 'Major',
    progressionId: 'lofi-morning-turnaround',

    // Beat: 808 Vintage with warm lowpass filter
    soundKit: '808 Vintage',
    drumFilterCutoff: 6200,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'lofi-half-time-brush',
    drumPattern: drumPatternById('lofi-half-time-brush')!,

    // Chords: Dream Keys, relaxed swung feel
    chords: resolveProgression(progressionById('lofi-morning-turnaround')!, 'C', 'Major', 4),
    chordRhythmId: 'lofiSwing',
    chordFeel: 0.78, // Loose swing
    chordOctave: 4,
    chordPresetId: 'factory-mellow-epiano',

    // Bass: Deep sub with Dilla loose swing
    bassPatternId: 'dilla-sub',
    bassFeel: 0.75, // Loose pocket
    bassOctave: 2,
    bassPresetId: 'bass-deep-sine',

    // Main Synth: Warm Keys / Whistle
    synthPresetId: 'factory-dream-keys',

    effectChainId: 'lofi-tape-room',
    effects: requireEffectChain('lofi-tape-room'),

    // lofi-chill
    variation: {
      genre: 'lofi',
      // The jazz/soul record keys lo-fi samples from. Full lower-to-middle
      // span: its bass is filtered at 260 Hz, so a deep half-audible sub is
      // the genre's texture rather than a fault.
      keyPool: ['C', 'D', 'D#', 'F', 'G', 'A'],
      bpmRange: [78, 88],
      progressionIds: ['jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop', 'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround'],
      rhythmIds: ['lofiSwing', 'syncopatedPush', 'bassPlusStrum'],
      bassPatternIds: ['dilla-sub', 'walking-groove', 'half-time-legato'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['lofi16ths', 'eighths', 'swung16ths'],
          openhat: ['off', 'and2and4', 'pickup'],
          tom: ['off', 'pickup', 'fillTail'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'synthwave-80s',
    name: 'Synthwave 80s',
    tagline: 'Neon night driving with retro analog synth & pumping bass',
    emoji: '🏎️',
    bpm: 118,
    meter: '4/4',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    progressionId: 'cine-epic-ostinato',

    // Beat: Retro Drive, tight 80s gate
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'synthwave-four-on-floor',
    drumPattern: drumPatternById('synthwave-four-on-floor')!,

    // Chords: Neon Polysynth, grid-tight 8th pads
    chords: resolveProgression(progressionById('cine-epic-ostinato')!, 'A', 'Natural Minor', 4),
    chordRhythmId: 'eighthPads',
    chordFeel: 0.12, // Strict tight sequencer grid
    chordOctave: 4,
    chordPresetId: 'factory-neon-poly-saw',

    // Bass: Saw Growl / Motorik driving 8ths
    bassPatternId: 'driving-eighths',
    bassFeel: 0.10, // Grid tight
    bassOctave: 2,
    bassPresetId: 'bass-saw-growl',

    // Main Synth: Hyper Saw Lead
    synthPresetId: 'factory-hyper-saw-lead',

    effectChainId: 'synthwave-neon-hall',
    effects: requireEffectChain('synthwave-neon-hall'),

    // synthwave-80s
    variation: {
      genre: 'synthwave',
      // Starts at D so the Saw Growl sub-osc (0.5, one octave down) stays above
      // ~37 Hz. The upper bound is a taste call, not an acoustic one: the pool
      // stops at A to keep every draw inside the darker half of the synthwave
      // key range. (It used to be justified by the lead arp's two octaves of
      // headroom; the arp is gone, and the bound was kept exactly as authored.)
      keyPool: ['D', 'E', 'F', 'F#', 'G', 'A'],
      bpmRange: [108, 118],
      progressionIds: ['pop-club-house', 'cine-epic-ostinato', 'synthwave-midnight-drive', 'synthwave-neon-horizon'],
      rhythmIds: ['eighthPads', 'fourOnFloor', 'popBallad8ths'],
      bassPatternIds: ['driving-eighths', 'offbeat-sub', 'root-fifth-walk'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['sixteenths', 'eighths', 'offbeat8ths'],
          openhat: ['off', 'offbeat8ths', 'pickup'],
          tom: ['off', 'fillTail', 'lateFill'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'cyber-dance',
    name: 'Cyber EDM',
    tagline: 'High-energy 128 BPM festival drop with punchy kicks & stabs',
    emoji: '⚡',
    bpm: 128,
    meter: '4/4',
    scaleRoot: 'F',
    scaleType: 'Natural Minor',
    progressionId: 'edm-cyber-vamp',

    // Beat: Hyperpop 2000 club drums
    soundKit: 'Hyperpop 2000',
    drumFilterCutoff: 14000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'edm-offbeat-pump',
    drumPattern: drumPatternById('edm-offbeat-pump')!,

    // Chords: Upbeat EDM stabs, laser-tight
    chords: resolveProgression(progressionById('edm-cyber-vamp')!, 'F', 'Natural Minor', 4),
    chordRhythmId: 'offbeatStabs',
    chordFeel: 0.05, // Laser tight
    chordOctave: 4,
    chordPresetId: 'factory-trance-pluck',

    // Bass: Punchy Square / Offbeat pumping sub
    bassPatternId: 'offbeat-sub',
    bassFeel: 0.05, // Grid locked
    bassOctave: 2,
    bassPresetId: 'bass-punchy-square',

    // Main Synth: Cyber Pluck Lead
    synthPresetId: 'factory-pluck',

    effectChainId: 'edm-club-drive',
    effects: requireEffectChain('edm-club-drive'),

    // cyber-dance
    variation: {
      genre: 'edm',
      // The club-minor band. Starts at D#, one step above synthwave, because
      // the Punchy Square carries more sub weight (0.7).
      keyPool: ['D#', 'E', 'F', 'F#', 'G', 'A'],
      bpmRange: [126, 130],
      progressionIds: ['pop-club-house', 'edm-cyber-drop', 'edm-neon-rise', 'edm-arena-sweep', 'edm-cyber-vamp'],
      rhythmIds: ['offbeatStabs', 'fourOnFloor', 'eighthPads'],
      bassPatternIds: ['offbeat-sub', 'driving-eighths', 'funk-octaves'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['offbeat8ths', 'sixteenths', 'eighths'],
          openhat: ['off', 'offbeat8ths', 'pickup'],
          tom: ['off', 'lateFill', 'fillTail'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'ambient-chill',
    name: 'Deep Ambient',
    tagline: 'Floating ethereal pads, lush reverbs & meditative chords',
    emoji: '🌌',
    bpm: 72,
    meter: '4/4',
    scaleRoot: 'D',
    scaleType: 'Lydian',
    progressionId: 'ambient-lydian-halo',

    // Beat: Minimal Glitch, soft and spacious
    soundKit: 'Minimal Glitch',
    drumFilterCutoff: 4800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'ambient-sparse-drift',
    drumPattern: drumPatternById('ambient-sparse-drift')!,

    // Chords: Celestial Shimmer, very loose and floating
    chords: resolveProgression(progressionById('ambient-lydian-halo')!, 'D', 'Lydian', 4),
    chordRhythmId: 'sustained',
    chordFeel: 0.88, // Very loose, floating
    chordOctave: 4,
    chordPresetId: 'factory-warm-polypad',

    // Bass: Drone sub, organic long sustain
    bassPatternId: 'whole-note-root',
    bassFeel: 0.85,
    bassOctave: 2,
    bassPresetId: 'bass-deep-sine',

    // Main Synth: Ethereal Bell Pad
    synthPresetId: 'factory-celestial-shimmer',

    effectChainId: 'ambient-cathedral-wash',
    effects: requireEffectChain('ambient-cathedral-wash'),

    // ambient-chill
    variation: {
      genre: 'ambient',
      // Avoids C, C# and D# entirely so a multi-bar drone through a 5.8 s
      // reverb tail keeps a pitched fundamental above ~73 Hz.
      keyPool: ['D', 'E', 'F', 'F#', 'G', 'A'],
      bpmRange: [62, 80],
      progressionIds: ['ambient-still-water', 'ambient-lydian-drift', 'ambient-open-fourths', 'ambient-glass-horizon', 'ambient-lydian-halo'],
      rhythmIds: ['sustained', 'arpRollUp', 'arpDownEighths'],
      bassPatternIds: ['whole-note-root', 'half-time-legato'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['off', 'backbeat', 'halves'],
          openhat: ['off', 'pickup', 'midBar'],
          tom: ['off', 'midBar'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'hiphop-groove',
    name: 'Boom Bap',
    tagline: 'Crisp swing drums, soulful minor keys & groovy bass',
    emoji: '🎙️',
    bpm: 92,
    meter: '4/4',
    scaleRoot: 'E',
    scaleType: 'Dorian',
    progressionId: 'boombap-soul-piano',

    // Beat: 808 Vintage / Boom bap swing
    soundKit: '808 Vintage',
    drumFilterCutoff: 7800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'boombap-swung-break',
    drumPattern: drumPatternById('boombap-swung-break')!,

    // Chords: Mellow E-Piano with syncopated push
    chords: resolveProgression(progressionById('boombap-soul-piano')!, 'E', 'Dorian', 4),
    chordRhythmId: 'syncopatedPush',
    chordFeel: 0.76, // Loose swing pocket
    chordOctave: 4,
    chordPresetId: 'factory-fm-tine-piano',

    // Bass: Round Pluck walking bassline
    bassPatternId: 'walking-groove',
    bassFeel: 0.72, // Swung walking feel
    bassOctave: 2,
    bassPresetId: 'bass-round-pluck',

    // Main Synth: Mellow E-Piano Solo
    synthPresetId: 'factory-mellow-epiano',

    effectChainId: 'boombap-dry-room',
    effects: requireEffectChain('boombap-dry-room'),

    // hiphop-groove
    variation: {
      genre: 'boombap',
      // Lower half only, so the walking line's upper notes stay under ~200 Hz
      // where the Round Pluck's 420 Hz cutoff still shapes them.
      keyPool: ['C', 'D', 'D#', 'E', 'F', 'G'],
      bpmRange: [85, 95],
      progressionIds: ['cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig', 'boombap-head-nod', 'boombap-soul-piano'],
      rhythmIds: ['syncopatedPush', 'lofiSwing', 'funkSyncopation'],
      bassPatternIds: ['walking-groove', 'dilla-sub', 'classic-walk'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['swung16ths', 'eighths', 'lofi16ths'],
          // `and2and4` is authored here because the research calls for open
          // hats on the "and", but this kick hits step 6 and the collision
          // filter drops it at draw time, leaving `off` and `pickup`.
          openhat: ['off', 'pickup', 'and2and4'],
          tom: ['off', 'fillTail', 'pickup'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'asian-zen',
    name: 'Zen Garden',
    tagline: 'Peaceful pentatonic bells, bamboo flute sounds & soothing flow',
    emoji: '🎋',
    bpm: 78,
    meter: '4/4',
    scaleRoot: 'G',
    scaleType: 'Hirajoshi',
    progressionId: 'zen-bamboo-vamp',

    // Beat: Minimal Glitch bamboo acoustic clicks
    soundKit: 'Minimal Glitch',
    drumFilterCutoff: 6500,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'zen-bamboo-pulse',
    drumPattern: drumPatternById('zen-bamboo-pulse')!,

    // Chords: Glocken Bell & peaceful sustained pads
    // zen-bamboo-vamp resolved in G Hirajoshi: i - IV - i - V, two bars each.
    // Uses only degrees 0, 3 and 4, so every note is inside the five-note
    // scale. Same 8-bar length as the progression this replaces.
    chords: resolveProgression(progressionById('zen-bamboo-vamp')!, 'G', 'Hirajoshi', 4),
    chordRhythmId: 'sustained',
    chordFeel: 0.65, // Peaceful organic breath
    chordOctave: 4,
    chordPresetId: 'factory-koto-pluck',

    // Bass: Warm Triangle drone
    bassPatternId: 'whole-note-root',
    bassFeel: 0.60,
    bassOctave: 2,
    bassPresetId: 'bass-warm-tri',

    // Main Synth: Pentatonic Bell Lead
    synthPresetId: 'factory-glocken-bell',

    effectChainId: 'zen-temple-air',
    effects: requireEffectChain('zen-temple-air'),

    // asian-zen
    variation: {
      genre: 'zen',
      // Koto-register roots — the instrument is conventionally tuned from
      // around D. Avoids the chromatic extremes where the Glocken Bell
      // partials either muddy or thin out.
      keyPool: ['D', 'E', 'F#', 'G', 'A'],
      // The one unsourced range: no production guide gave a tempo band for the
      // genre, so it is the authored 78 +/- 6.
      bpmRange: [70, 84],
      progressionIds: ['zen-bamboo-vamp', 'zen-moonlit-koto', 'zen-still-pond', 'zen-temple-bell'],
      rhythmIds: ['sustained', 'arpRollUp', 'arpDownEighths'],
      bassPatternIds: ['whole-note-root', 'half-time-legato'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['quarters', 'eighths', 'halves'],
          openhat: ['off', 'pickup', 'midBar'],
          tom: ['off', 'midBar', 'pickup'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'lofi-waltz',
    name: 'Lo-Fi Waltz',
    tagline: 'Dusty three-four turns with jazz keys and a brushed kit',
    emoji: '🎠',
    bpm: 96,
    meter: '3/4',
    scaleRoot: 'F',
    scaleType: 'Major',
    progressionId: 'lofi-rainy-window',

    // Beat: brushed three-four, one kick per bar
    soundKit: 'Lo-Fi Vinyl',
    drumFilterCutoff: 6800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'waltz-brush-three',
    drumPattern: drumPatternById('waltz-brush-three')!,

    // Chords: FM tines comping the literal oom-pah-pah
    chords: resolveProgression(progressionById('lofi-rainy-window')!, 'F', 'Major', 4),
    chordRhythmId: 'waltzOompah',
    chordFeel: 0.72, // Loose, brushed
    chordOctave: 4,
    chordPresetId: 'factory-mellow-epiano',

    // Bass: rising root-5th-octave, one note per beat
    bassPatternId: 'waltz-root-fifth',
    bassFeel: 0.68,
    bassOctave: 2,
    bassPresetId: 'bass-warm-tri',

    // Main Synth: FM tine piano
    synthPresetId: 'factory-fm-tine-piano',

    effectChainId: 'lofi-tape-room',
    effects: requireEffectChain('lofi-tape-room'),

    // lofi-waltz
    variation: {
      genre: 'lofi',
      keyPool: ['C', 'D', 'F', 'G', 'A'],
      bpmRange: [88, 104],
      progressionIds: ['jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop', 'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround'],
      rhythmIds: ['waltzOompah', 'jazzWaltzComp', 'waltzArpRoll'],
      bassPatternIds: ['waltz-root-fifth', 'waltz-walking-three'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          // hihat and crash are exempt from the kick-collision filter, so they
          // may sit on step 0. The other two may not: this kick is step 0 only.
          hihat: ['quarters', 'eighths', 'lofi16ths'],
          openhat: ['off', 'and2and4', 'offbeat8ths'],
          tom: ['off', 'midBar', 'lateFill'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
  {
    id: 'afro-six-eight',
    name: 'Afro 6/8',
    tagline: 'Compound bell groove, modal Dorian vamp, two beats to the bar',
    emoji: '🪘',
    bpm: 132,
    meter: '6/8',
    scaleRoot: 'D',
    scaleType: 'Dorian',
    progressionId: 'cine-dorian-voyage',

    // Beat: two dotted-quarter beats, snare pushing off the last eighth of each
    soundKit: 'Acoustic Studio',
    drumFilterCutoff: 9000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPatternId: 'afro-six-eight-bell',
    drumPattern: drumPatternById('afro-six-eight-bell')!,

    // Chords: tines on the one-bar 6/8 bell cell
    chords: resolveProgression(progressionById('cine-dorian-voyage')!, 'D', 'Dorian', 4),
    chordRhythmId: 'afroBellComp',
    chordFeel: 0.55,
    chordOctave: 4,
    chordPresetId: 'factory-fm-tine-piano',

    // Bass: both beats plus the octave push on the last eighth of beat two
    bassPatternId: 'afro-six-eight-tumbao',
    bassFeel: 0.5,
    bassOctave: 2,
    bassPresetId: 'bass-round-pluck',

    // Main Synth: bell lead, the voice the groove is named for
    synthPresetId: 'factory-glocken-bell',

    effectChainId: 'boombap-dry-room',
    effects: requireEffectChain('boombap-dry-room'),

    // afro-six-eight
    variation: {
      genre: 'boombap',
      keyPool: ['C', 'D', 'E', 'F', 'G'],
      bpmRange: [126, 138],
      progressionIds: ['cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig', 'boombap-head-nod', 'boombap-soul-piano'],
      rhythmIds: ['afroBellComp', 'compoundEighthPads', 'sixEightBallad'],
      bassPatternIds: ['afro-six-eight-tumbao', 'six-eight-root-pulse'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          // This kick hits BOTH 0 and 6, so every catalogue row that touches
          // either is ineligible for openhat and tom once adapted to twelve
          // steps. What survives is off / backbeat (step 4) / lateFill (step 7).
          // hihat and crash are exempt from the filter.
          hihat: ['eighths', 'sixteenths', 'lofi16ths'],
          openhat: ['off', 'backbeat', 'lateFill'],
          tom: ['off', 'lateFill'],
          crash: ['off', 'downbeat'],
        },
      },
    },
  },
];

/** Every vibe's id, in table order — the identity set the invariant tests pin against. */
export const VIBE_IDS: string[] = INSTANT_VIBES.map((v) => v.id);
