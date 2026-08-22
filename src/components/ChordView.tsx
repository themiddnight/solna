import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Music, Play, Square, Sparkles, Plus, Trash2, ArrowRight, Library, Bookmark, Check, Link2, Volume2, VolumeX } from 'lucide-react';
import { ChordItem, SynthParams } from '../types';
import { audioEngine, STEPS_PER_BAR } from '../audio/engine';
import { FACTORY_PRESETS, getCustomPresets } from '../audio/synthPresets';
import { RHYTHM_PATTERNS, RHYTHM_STYLE_GROUPS, RhythmPattern } from '../audio/rhythmPatterns';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { BASS_PATTERNS, BASS_STYLE_GROUPS, BassPattern, resolveBassSteps } from '../audio/bassPatterns';
import { deriveChordNotes, reharmonizeProgressionToScale, generateBlockChordNotes, quarterNoteMs, sixteenthNoteMs, rootSemitone, shiftNoteOctave, SCALES, ROOTS } from '../utils/musicTheory';
import {
  ChordPresetLibrary,
  getCustomChordProgressions,
  saveCustomChordProgression,
  CustomChordProgressionItem,
} from './ChordPresetLibrary';

interface ChordViewProps {
  chords: ChordItem[];
  onChangeChords: (chords: ChordItem[]) => void;
  scaleRoot: string;
  onChangeScaleRoot: (root: string) => void;
  scaleType: string;
  onChangeScaleType: (type: string) => void;
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  onChangeChordSynthParams: (params: SynthParams) => void;
  followMainSynth: boolean;
  onToggleFollowMain: () => void;
  rhythmId: string;
  onChangeRhythmId: (id: string) => void;
  chordOctave: number;
  onChangeChordOctave: (octave: number) => void;
  bassSynthParams: SynthParams;
  onChangeBassSynthParams: (params: SynthParams) => void;
  bassPatternId: string;
  onChangeBassPatternId: (id: string) => void;
  bassOctave: number;
  onChangeBassOctave: (octave: number) => void;
  chordMuted: boolean;
  onToggleChordMuted: () => void;
  bassMuted: boolean;
  onToggleBassMuted: () => void;
  bpm: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  masterChordVelocity: number;
  onChangeMasterChordVelocity: (velocity: number) => void;
}

const SELECT_BASE = 'bg-[#171B36] border border-[#2D355A] rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-200';

export interface ProgressionTemplate {
  name: string;
  category: 'Pop & EDM' | 'Jazz & Neo-Soul' | 'Lofi & R&B' | 'Rock & Blues' | 'Anime & J-Pop' | 'Cinematic & Modal' | 'Classical & Baroque';
  roman: string;
  description: string;
  // Semitone intervals relative to the chosen key's root (0 = Key root)
  // along with chord quality for key transposition
  relativeChords: Array<{ interval: number; quality: string; bars: number }>;
}

export const CHORD_PROGRESSION_TEMPLATES: ProgressionTemplate[] = [
  // Pop & EDM
  {
    name: 'Classic 4-Chord Pop Anthem',
    category: 'Pop & EDM',
    roman: 'I – V – vi – IV',
    description: 'The definitive major-scale pop progression creating an instantly uplifting and catchy flow.',
    relativeChords: [
      { interval: 0, quality: 'maj', bars: 1 },  // I
      { interval: 7, quality: 'maj', bars: 1 },  // V
      { interval: 9, quality: 'min', bars: 1 },  // vi
      { interval: 5, quality: 'maj', bars: 1 },  // IV
    ],
  },
  {
    name: 'Emotional Minor Synthwave',
    category: 'Pop & EDM',
    roman: 'vi – IV – I – V',
    description: 'Moody, heroic, and emotional minor opening used widely in synthwave, EDM, and cinematic anthems.',
    relativeChords: [
      { interval: 9, quality: 'min', bars: 1 },  // vi
      { interval: 5, quality: 'maj', bars: 1 },  // IV
      { interval: 0, quality: 'maj', bars: 1 },  // I
      { interval: 7, quality: 'maj', bars: 1 },  // V
    ],
  },
  {
    name: 'Classic 50s Doo-Wop Cadence',
    category: 'Pop & EDM',
    roman: 'I – vi – IV – V',
    description: 'Timeless vintage progression with warm, romantic, and circular harmonic resolution.',
    relativeChords: [
      { interval: 0, quality: 'maj', bars: 1 },  // I
      { interval: 9, quality: 'min', bars: 1 },  // vi
      { interval: 5, quality: 'maj', bars: 1 },  // IV
      { interval: 7, quality: 'maj', bars: 1 },  // V
    ],
  },
  {
    name: 'Future Bass / Euphoric EDM Lift',
    category: 'Pop & EDM',
    roman: 'IVmaj7 – V7 – iiim7 – vim7',
    description: 'Lush 7th chord cadence creating unstoppable momentum and euphoric drops.',
    relativeChords: [
      { interval: 5, quality: 'maj7', bars: 1 }, // IVmaj7
      { interval: 7, quality: '7', bars: 1 },    // V7
      { interval: 4, quality: 'min7', bars: 1 }, // iiim7
      { interval: 9, quality: 'min7', bars: 1 }, // vim7
    ],
  },
  {
    name: 'Club Dance & House Groove',
    category: 'Pop & EDM',
    roman: 'i – VI – VII – v',
    description: 'Driving natural minor cadence standard in modern deep house and electronic dance music.',
    relativeChords: [
      { interval: 0, quality: 'min7', bars: 1 }, // i
      { interval: 8, quality: 'maj7', bars: 1 }, // VI
      { interval: 10, quality: '7', bars: 1 },   // VII
      { interval: 7, quality: 'min7', bars: 1 }, // v
    ],
  },

  // Jazz & Neo-Soul
  {
    name: 'Jazz ii-V-I-VI Turnaround',
    category: 'Jazz & Neo-Soul',
    roman: 'ii7 – V7 – Imaj7 – VI7',
    description: 'The quintessential jazz standard backbone featuring a secondary dominant turnaround.',
    relativeChords: [
      { interval: 2, quality: 'min7', bars: 1 },  // ii7
      { interval: 7, quality: '7', bars: 1 },     // V7
      { interval: 0, quality: 'maj7', bars: 1 },  // Imaj7
      { interval: 9, quality: '7', bars: 1 },     // VI7
    ],
  },
  {
    name: 'Neo-Soul Butter Flow',
    category: 'Jazz & Neo-Soul',
    roman: 'Imaj9 – viim7b5 – III7 – vim9',
    description: 'Complex soulful harmony with half-diminished 7b5 leading into a dominant resolution.',
    relativeChords: [
      { interval: 0, quality: 'maj9', bars: 1 },  // Imaj9
      { interval: 11, quality: 'm7b5', bars: 1 }, // viim7b5
      { interval: 4, quality: '7', bars: 1 },     // III7
      { interval: 9, quality: 'min9', bars: 1 },  // vim9
    ],
  },
  {
    name: 'Chromatic Mediants / Giant Step Cycle',
    category: 'Jazz & Neo-Soul',
    roman: 'Imaj7 – bVImaj7 – bIImaj7 – V7',
    description: 'Chromatic third root movements providing a vibrant, otherworldly modal jazz coloration.',
    relativeChords: [
      { interval: 0, quality: 'maj7', bars: 1 },  // Imaj7
      { interval: 8, quality: 'maj7', bars: 1 },  // bVImaj7
      { interval: 1, quality: 'maj7', bars: 1 },  // bIImaj7
      { interval: 7, quality: '7sus4', bars: 1 }, // V7sus4
    ],
  },

  // Lofi & R&B
  {
    name: 'Lofi Extended 9th Coffeehouse',
    category: 'Lofi & R&B',
    roman: 'ii9 – V13 – Imaj9 – IVmaj7',
    description: 'Warm, relaxed extended 9th and 13th chords tailored for mellow beats and study sessions.',
    relativeChords: [
      { interval: 2, quality: 'min9', bars: 1 },  // ii9
      { interval: 7, quality: '7', bars: 1 },     // V7
      { interval: 0, quality: 'maj9', bars: 1 },  // Imaj9
      { interval: 5, quality: 'maj7', bars: 1 },  // IVmaj7
    ],
  },
  {
    name: 'Contemporary R&B / Trap-Soul Flow',
    category: 'Lofi & R&B',
    roman: 'i9 – iv7 – VII9 – IIImaj7',
    description: 'Sultry, atmospheric minor progression standard in contemporary R&B and downtempo production.',
    relativeChords: [
      { interval: 0, quality: 'min9', bars: 1 },  // i9
      { interval: 5, quality: 'min7', bars: 1 },  // iv7
      { interval: 10, quality: '9', bars: 1 },    // VII9
      { interval: 3, quality: 'maj7', bars: 1 },  // IIImaj7
    ],
  },
  {
    name: 'Melancholy Bedroom Pop',
    category: 'Lofi & R&B',
    roman: 'Imaj7 – IVmaj7 – ii7 – V7',
    description: 'Intimate, nostalgic daydream feel with soft major-7th oscillations and tender resolutions.',
    relativeChords: [
      { interval: 0, quality: 'maj7', bars: 1 },  // Imaj7
      { interval: 5, quality: 'maj7', bars: 1 },  // IVmaj7
      { interval: 2, quality: 'min7', bars: 1 },  // ii7
      { interval: 7, quality: '7', bars: 1 },     // V7
    ],
  },

  // Anime & J-Pop
  {
    name: 'Royal Road / Oudo Cadence (王道進行)',
    category: 'Anime & J-Pop',
    roman: 'IVmaj7 – V7 – iiim7 – vim7',
    description: 'The golden standard harmonic sequence of Asian pop and modern dynamic anime theme tracks.',
    relativeChords: [
      { interval: 5, quality: 'maj7', bars: 1 }, // IVmaj7
      { interval: 7, quality: '7', bars: 1 },    // V7
      { interval: 4, quality: 'min7', bars: 1 }, // iiim7
      { interval: 9, quality: 'min7', bars: 1 }, // vim7
    ],
  },
  {
    name: 'City Pop / Marusa Groove (丸サ進行)',
    category: 'Anime & J-Pop',
    roman: 'IVmaj7 – III7 – vim7 – I7',
    description: 'Infectious groove with secondary dominant transition standard in vintage City Pop and Funk.',
    relativeChords: [
      { interval: 5, quality: 'maj7', bars: 1 }, // IVmaj7
      { interval: 4, quality: '7', bars: 1 },    // III7 (secondary dominant)
      { interval: 9, quality: 'min7', bars: 1 }, // vim7
      { interval: 0, quality: '7', bars: 1 },    // I7
    ],
  },
  {
    name: 'Heroic Anthem / J-Rock Drive',
    category: 'Anime & J-Pop',
    roman: 'vi – IV – V – I',
    description: 'High-energy, heroic minor-to-major resolution celebrating triumph and determination.',
    relativeChords: [
      { interval: 9, quality: 'min', bars: 1 },  // vi
      { interval: 5, quality: 'maj', bars: 1 },  // IV
      { interval: 7, quality: 'maj', bars: 1 },  // V
      { interval: 0, quality: 'maj', bars: 1 },  // I
    ],
  },

  // Rock & Blues
  {
    name: '12-Bar Blues Standard',
    category: 'Rock & Blues',
    roman: 'I7 – IV7 – I7 – V7 – IV7 – I7',
    description: 'The foundational public domain 12-bar blues form loaded with dominant 7th grit.',
    relativeChords: [
      { interval: 0, quality: '7', bars: 2 },  // I7
      { interval: 5, quality: '7', bars: 1 },  // IV7
      { interval: 0, quality: '7', bars: 1 },  // I7
      { interval: 7, quality: '7', bars: 1 },  // V7
      { interval: 5, quality: '7', bars: 1 },  // IV7
      { interval: 0, quality: '7', bars: 2 },  // I7
    ],
  },
  {
    name: 'Mixolydian Rock Anthem',
    category: 'Rock & Blues',
    roman: 'I – bVII – IV – I',
    description: 'Modal rock swagger featuring the flattened seventh chord for a gritty, driving feel.',
    relativeChords: [
      { interval: 0, quality: 'maj', bars: 1 },  // I
      { interval: 10, quality: 'maj', bars: 1 }, // bVII
      { interval: 5, quality: 'maj', bars: 1 },  // IV
      { interval: 0, quality: 'maj', bars: 1 },  // I
    ],
  },
  {
    name: 'Andalusian / Flamenco Descent',
    category: 'Rock & Blues',
    roman: 'i – bVII – bVI – V',
    description: 'Dramatic descending Phrygian bassline cadence rooted in historic Spanish folk and acoustic rock.',
    relativeChords: [
      { interval: 0, quality: 'min', bars: 1 },  // i
      { interval: 10, quality: 'maj', bars: 1 }, // bVII
      { interval: 8, quality: 'maj', bars: 1 },  // bVI
      { interval: 7, quality: '7', bars: 1 },    // V7
    ],
  },

  // Cinematic & Modal
  {
    name: 'Epic Cinematic Ostinato',
    category: 'Cinematic & Modal',
    roman: 'i – bVI – III – bVII',
    description: 'Monumental cinematic progression built for soaring blockbuster film scores and orchestral trailers.',
    relativeChords: [
      { interval: 0, quality: 'min', bars: 1 },  // i
      { interval: 8, quality: 'maj', bars: 1 },  // bVI
      { interval: 3, quality: 'maj', bars: 1 },  // III
      { interval: 10, quality: 'maj', bars: 1 }, // bVII
    ],
  },
  {
    name: 'Dorian Space Voyage',
    category: 'Cinematic & Modal',
    roman: 'i7 – IV7 – i7 – IV7',
    description: 'Floating, futuristic vamp utilizing natural 6th modal harmonization for electronic soundscapes.',
    relativeChords: [
      { interval: 0, quality: 'min7', bars: 1 }, // i7
      { interval: 5, quality: '7', bars: 1 },    // IV7 (Major IV in Dorian)
      { interval: 0, quality: 'min7', bars: 1 }, // i7
      { interval: 5, quality: '7', bars: 1 },    // IV7
    ],
  },
  {
    name: 'Lydian Dreamscape',
    category: 'Cinematic & Modal',
    roman: 'Imaj7 – II – Imaj7 – II',
    description: 'Magical raised-4th harmony evoking wonder, airborne flight, and majestic adventure.',
    relativeChords: [
      { interval: 0, quality: 'maj7', bars: 1 }, // Imaj7
      { interval: 2, quality: 'maj', bars: 1 },  // II (Major 2 in Lydian)
      { interval: 0, quality: 'maj7', bars: 1 }, // Imaj7
      { interval: 2, quality: 'maj', bars: 1 },  // II
    ],
  },

  // Classical & Baroque
  {
    name: 'Baroque Canon Cadence',
    category: 'Classical & Baroque',
    roman: 'I – V – vi – iii – IV – I – IV – V',
    description: 'The golden traditional baroque harmonic sequence celebrated across 300 years of music history.',
    relativeChords: [
      { interval: 0, quality: 'maj', bars: 1 },  // I
      { interval: 7, quality: 'maj', bars: 1 },  // V
      { interval: 9, quality: 'min', bars: 1 },  // vi
      { interval: 4, quality: 'min', bars: 1 },  // iii
      { interval: 5, quality: 'maj', bars: 1 },  // IV
      { interval: 0, quality: 'maj', bars: 1 },  // I
      { interval: 5, quality: 'maj', bars: 1 },  // IV
      { interval: 7, quality: 'maj', bars: 1 },  // V
    ],
  },
  {
    name: 'Passacaglia / Circle of Fifths Descent',
    category: 'Classical & Baroque',
    roman: 'i – iv – VII – III – VI – iio – V – i',
    description: 'Hypnotic circular resolution driving classical drama, emotional tension, and resolve.',
    relativeChords: [
      { interval: 0, quality: 'min', bars: 1 },  // i
      { interval: 5, quality: 'min', bars: 1 },  // iv
      { interval: 10, quality: 'maj', bars: 1 }, // VII
      { interval: 3, quality: 'maj', bars: 1 },  // III
      { interval: 8, quality: 'maj', bars: 1 },  // VI
      { interval: 2, quality: 'dim', bars: 1 },  // iio
      { interval: 7, quality: '7', bars: 1 },    // V7
      { interval: 0, quality: 'min', bars: 1 },  // i
    ],
  },
];

export const ChordView: React.FC<ChordViewProps> = ({
  chords,
  onChangeChords,
  scaleRoot,
  onChangeScaleRoot,
  scaleType,
  onChangeScaleType,
  synthParams,
  chordSynthParams,
  onChangeChordSynthParams,
  followMainSynth,
  onToggleFollowMain,
  rhythmId,
  onChangeRhythmId,
  chordOctave,
  onChangeChordOctave,
  bassSynthParams,
  onChangeBassSynthParams,
  bassPatternId,
  onChangeBassPatternId,
  bassOctave,
  onChangeBassOctave,
  chordMuted,
  onToggleChordMuted,
  bassMuted,
  onToggleBassMuted,
  bpm,
  isPlaying,
  onTogglePlay,
  masterChordVelocity,
  onChangeMasterChordVelocity,
}) => {
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [selectedChordPresetId, setSelectedChordPresetId] = useState<string | null>(null);

  // Chord sound presets: factory presets plus presets saved from the synth view
  const customPresets = getCustomPresets();

  const rhythmPattern = useMemo(
    () => RHYTHM_PATTERNS.find((p) => p.id === rhythmId) ?? RHYTHM_PATTERNS[0],
    [rhythmId]
  );

  // Schedule a whole chord across its bars using the selected rhythm pattern:
  // block hits strike every note at once, strums cascade note-by-note.
  const playChordWithRhythm = useCallback((chord: ChordItem, startTime: number, pattern: RhythmPattern) => {
    audioEngine.init();

    const notes = generateBlockChordNotes(chord.quality, chord.root, chordOctave);
    const stepDur = sixteenthNoteMs(bpm) / 1000;
    const totalBars = chord.bars || 1;

    // Precompute the pattern's events once per chord trigger (bar-invariant)
    const events = pattern.hits.flatMap((hit) => {
      const offset = hit.step * stepDur;
      const hold = Math.max(0.05, (hit.holdSteps ?? 1) * stepDur);
      const baseVelocity = masterChordVelocity * (hit.velocity ?? 1);
      const hitNotes = hit.note !== undefined ? [notes[hit.note]] : notes;
      const isStrum = hit.type === 'strum';
      const orderedNotes = isStrum && hit.direction === 'up' ? [...hitNotes].reverse() : hitNotes;
      const spreadMs = hit.spreadMs ?? 30;

      return orderedNotes.flatMap((n, i) => {
        if (!n) return [];
        const noteName = hit.octaveShift ? shiftNoteOctave(n, hit.octaveShift) : n;
        const timeOffset = offset + (isStrum ? (i * spreadMs) / 1000 : 0);
        const velocity = isStrum ? Math.max(0.1, baseVelocity * (1 - i * 0.08)) : baseVelocity;
        return [{ noteName, velocity, timeOffset, hold }];
      });
    });

    const barDur = stepDur * STEPS_PER_BAR;
    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = startTime + bar * barDur;
      for (const ev of events) {
        audioEngine.triggerSynthNoteOn(ev.noteName, chordSynthParams, ev.velocity, barStart + ev.timeOffset, 'chord');
        audioEngine.triggerSynthNoteOff(ev.noteName, chordSynthParams.release, barStart + ev.timeOffset + ev.hold, 'chord');
      }
    }
  }, [bpm, chordSynthParams, chordOctave, masterChordVelocity]);

  const playBassWithPattern = useCallback(
    (chord: ChordItem, startTime: number, pattern: BassPattern) => {
      audioEngine.init();
      const chordIdx = Math.max(0, chords.indexOf(chord));
      const events = resolveBassSteps(pattern, chords, chordIdx, bassOctave, scaleRoot, scaleType, bpm);
      const stepDur = sixteenthNoteMs(bpm) / 1000;
      const barDur = stepDur * STEPS_PER_BAR;
      const totalBars = chord.bars || 1;
      // Events are bar-invariant (the clock advances by barDur per bar); schedule
      // the resolved set at each bar's start.
      for (let bar = 0; bar < totalBars; bar++) {
        const barStart = startTime + bar * barDur;
        const isLastBar = bar === totalBars - 1;
        for (const ev of events) {
          // Approach tokens lead into the NEXT chord — only play them on the last bar.
          if (!isLastBar && ev.token.startsWith('approach')) continue;
          audioEngine.triggerSynthNoteOn(ev.noteName, bassSynthParams, ev.velocity, barStart + ev.timeOffsetSec, 'bass');
          audioEngine.triggerSynthNoteOff(ev.noteName, bassSynthParams.release, barStart + ev.timeOffsetSec + ev.holdSec, 'bass');
        }
      }
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams]
  );

  // Master Playback Loop — driven by the shared audio-clock scheduler
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customProgressions, setCustomProgressions] = useState<CustomChordProgressionItem[]>([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>('');
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [autoReharmonize, setAutoReharmonize] = useState<boolean>(true);
  const [isAutoReharmonizedIndicator, setIsAutoReharmonizedIndicator] = useState<boolean>(false);
  const [selectedBassPresetId, setSelectedBassPresetId] = useState<string>(FACTORY_BASS_PRESETS[0].id);
  const bassPattern = BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];
  const armedRef = useRef(false);
  const chordIndexRef = useRef(0);
  const nextBarStepRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      armedRef.current = false;
      setPlayingIndex(null);
      setActiveChordId(null);
      return;
    }

    return audioEngine.subscribeClock((step, _beat, time) => {
      // Start aligned to the next bar boundary so chord changes land on beat 1
      if (!armedRef.current) {
        if (step % STEPS_PER_BAR !== 0) return;
        armedRef.current = true;
        chordIndexRef.current = 0;
        nextBarStepRef.current = step;
      }
      if (step < nextBarStepRef.current) return;
      const chord = chords[chordIndexRef.current % chords.length];
      playChordWithRhythm(chord, time, rhythmPattern);
      playBassWithPattern(chord, time, bassPattern);
      setPlayingIndex(chordIndexRef.current % chords.length);
      setActiveChordId(chord.id);
      nextBarStepRef.current = step + (chord.bars || 1) * STEPS_PER_BAR;
      chordIndexRef.current++;
    });
  }, [isPlaying, chords, playChordWithRhythm, playBassWithPattern, rhythmPattern, bassPattern]);

  // Auto-reharmonize current chords when scale/root changes if autoReharmonize is enabled
  useEffect(() => {
    if (autoReharmonize && chords.length > 0) {
      const updated = reharmonizeProgressionToScale(chords, scaleRoot, scaleType, chordOctave);
      onChangeChords(updated);
      setIsAutoReharmonizedIndicator(true);
    }
  }, [scaleRoot, scaleType]);

  // Calculate notes in selected scale
  const rootIdx = rootSemitone(scaleRoot);
  const intervals = SCALES[scaleType]?.intervals || [0, 2, 4, 5, 7, 9, 11];
  const scaleNotes = intervals.map((int) => ROOTS[(rootIdx + int) % 12]);

  // Transpose the template's relative intervals cleanly to the current selected Key Root and optionally auto-reharmonize
  const applyProgressionTemplate = (template: ProgressionTemplate) => {
    const baseRootIndex = rootSemitone(scaleRoot);

    let newChords: ChordItem[] = template.relativeChords.map((c, i) => {
      const transposedRoot = ROOTS[(baseRootIndex + c.interval) % 12];
      return deriveChordNotes(
        {
          id: `chord-${Date.now()}-${i}`,
          root: transposedRoot,
          quality: c.quality,
          bars: c.bars,
          notes: [],
        },
        chordOctave
      );
    });

    if (autoReharmonize) {
      newChords = reharmonizeProgressionToScale(newChords, scaleRoot, scaleType, chordOctave);
      setIsAutoReharmonizedIndicator(true);
    } else {
      setIsAutoReharmonizedIndicator(false);
    }

    onChangeChords(newChords);
  };

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    let finalChords = libraryChords.map((c, i) =>
      deriveChordNotes({ ...c, id: `lib-chord-${Date.now()}-${i}` }, chordOctave)
    );

    if (autoReharmonize) {
      finalChords = reharmonizeProgressionToScale(finalChords, scaleRoot, scaleType, chordOctave);
      setIsAutoReharmonizedIndicator(true);
    } else {
      setIsAutoReharmonizedIndicator(false);
    }

    onChangeChords(finalChords);
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim() || chords.length === 0) return;

    const saved = saveCustomChordProgression(
      quickSaveName.trim(),
      chords,
      'User',
      'Saved from Chord View',
      chords.map((c) => `${c.root}${c.quality}`).join(' → ')
    );

    setCustomProgressions(getCustomChordProgressions());
    setIsQuickSaving(false);
    setQuickSaveName('');
    setSaveToast(`Saved progression "${saved.name}"!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const addChord = () => {
    const newChord: ChordItem = deriveChordNotes(
      { id: `chord-${Date.now()}`, root: scaleRoot, quality: 'maj7', bars: 1, notes: [] },
      chordOctave
    );
    onChangeChords([...chords, newChord]);
  };

  const removeChord = (id: string) => {
    onChangeChords(chords.filter((c) => c.id !== id));
  };

  const updateChord = (id: string, updates: Partial<ChordItem>) => {
    onChangeChords(
      chords.map((c) => {
        if (c.id !== id) return c;
        return deriveChordNotes({ ...c, ...updates }, chordOctave);
      })
    );
  };

  const totalProgressionsCount = CHORD_PROGRESSION_TEMPLATES.length + customProgressions.length;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Scale & Music Theory Header */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg relative">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <Music className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Music Theory & Chord Studio
            </h2>
          </div>
        </div>

        {/* Action Controls & Independent Chords Play */}
        <div className="flex items-center gap-2.5 flex-wrap">

          {/* Chord Sound Preset Select */}
          <select
            id="select-chord-sound-preset"
            value={selectedChordPresetId ?? ''}
            disabled={followMainSynth}
            onChange={(e) => {
              const preset = [...FACTORY_PRESETS, ...customPresets].find((p) => p.id === e.target.value);
              if (!preset) return;
              setSelectedChordPresetId(preset.id);
              onChangeChordSynthParams({ ...chordSynthParams, ...preset.params });
            }}
            className={`${SELECT_BASE} cursor-pointer ${followMainSynth ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#22284C]'}`}
            title="Chord sound preset — factory and saved presets. Disabled while following the main synth."
          >
            <option value="">Chord Preset…</option>
            {FACTORY_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {customPresets.length > 0 && (
              <optgroup label="Saved Presets">
                {customPresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
          </select>

          {/* Chord Octave Select */}
          <select
            id="select-chord-octave"
            value={chordOctave}
            onChange={(e) => onChangeChordOctave(parseInt(e.target.value, 10))}
            className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
            title="Octave for chord playback"
          >
            {[2, 3, 4, 5, 6].map((o) => (
              <option key={o} value={o}>Oct {o}</option>
            ))}
          </select>

          {/* Chord Rhythm Pattern Select */}
          <select
            id="select-chord-rhythm-pattern"
            value={rhythmId}
            onChange={(e) => onChangeRhythmId(e.target.value)}
            className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
            title="Rhythm pattern for chord playback"
          >
            {RHYTHM_STYLE_GROUPS.map((group) => (
              <optgroup key={group.style} label={group.style}>
                {group.patterns.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Follow Main Synth Toggle */}
          <button
            id="btn-toggle-follow-main-synth"
            onClick={onToggleFollowMain}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              followMainSynth
                ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
                : 'bg-[#0B0D19] border-[#2D355A] text-slate-400'
            }`}
            title="ON: chord sound mirrors the main synth in realtime. OFF: chords use the selected preset."
          >
            <Link2 className={`w-3.5 h-3.5 ${followMainSynth ? 'text-indigo-300' : 'text-slate-500'}`} />
            <span>Follow Main Synth: {followMainSynth ? 'ON' : 'OFF'}</span>
          </button>

          {/* Per-layer mute toggles (engine source buses — tails cut instantly) */}
          <button
            id="btn-mute-chord"
            onClick={onToggleChordMuted}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              chordMuted
                ? 'bg-rose-600/30 border-rose-500/50 text-rose-200'
                : 'bg-[#0B0D19] border-[#2D355A] text-slate-400'
            }`}
            title="Mute the chord layer on its engine bus (instant, includes tails)"
          >
            {chordMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-indigo-300" />
            )}
            <span>Chord: {chordMuted ? 'OFF' : 'ON'}</span>
          </button>

          <button
            id="btn-mute-bass"
            onClick={onToggleBassMuted}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              bassMuted
                ? 'bg-rose-600/30 border-rose-500/50 text-rose-200'
                : 'bg-[#0B0D19] border-[#2D355A] text-slate-400'
            }`}
            title="Mute the bass layer on its engine bus (instant, includes tails)"
          >
            {bassMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
            )}
            <span>Bass: {bassMuted ? 'OFF' : 'ON'}</span>
          </button>

          {/* Quick Save Current Progression */}
          <button
            id="btn-quick-save-chord-progression"
            onClick={() => {
              setQuickSaveName(`Progression in ${scaleRoot}`);
              setIsQuickSaving(true);
            }}
            className="flex items-center gap-1.5 bg-[#171B36] hover:bg-[#22284C] text-slate-200 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#2D355A] transition-colors cursor-pointer shadow-xs"
            title="Save current chord progression to LocalStorage"
          >
            <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Option B Re-harmonize Button */}
          <button
            id="btn-reharmonize-chord-progression"
            onClick={() => {
              const updated = reharmonizeProgressionToScale(chords, scaleRoot, scaleType, chordOctave);
              onChangeChords(updated);
              setIsAutoReharmonizedIndicator(true);
              setSaveToast(`Re-harmonized progression to ${scaleRoot} ${scaleType} (Option B)!`);
              setTimeout(() => setSaveToast(null), 3000);
            }}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md transition-colors cursor-pointer"
            title="Option B: Diatonically snap current chord progression to active key and scale"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-200" />
            <span>Re-harmonize (Option B)</span>
          </button>

          {/* Auto-Reharmonize Toggle */}
          <button
            id="btn-toggle-auto-reharmonize"
            onClick={() => {
              const nextVal = !autoReharmonize;
              setAutoReharmonize(nextVal);
              if (nextVal && chords.length > 0) {
                const updated = reharmonizeProgressionToScale(chords, scaleRoot, scaleType, chordOctave);
                onChangeChords(updated);
                setIsAutoReharmonizedIndicator(true);
              } else {
                setIsAutoReharmonizedIndicator(false);
              }
            }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              autoReharmonize
                ? 'bg-purple-600/30 border-purple-500/50 text-purple-200'
                : 'bg-[#0B0D19] border-[#2D355A] text-slate-400'
            }`}
            title="Toggle automatic re-harmonization when loading presets or changing scales"
          >
            <Sparkles className={`w-3.5 h-3.5 ${autoReharmonize ? 'text-purple-300' : 'text-slate-500'}`} />
            <span>Auto-Reharmonize: {autoReharmonize ? 'ON' : 'OFF'}</span>
          </button>

          {/* Open Presets Library Drawer Button */}
          <button
            id="btn-open-chord-presets-library"
            onClick={() => setIsLibraryOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md transition-colors cursor-pointer"
            title="Open Chord Progression Library Drawer (Categorized, search, audition, export/import)"
          >
            <Library className="w-3.5 h-3.5" />
            <span>Progressions Library</span>
            <span className="bg-indigo-700/80 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
              {totalProgressionsCount}
            </span>
          </button>
        </div>

        {/* Floating Save Toast */}
        {saveToast && (
          <div className="absolute top-full right-4 mt-2 z-20 bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{saveToast}</span>
          </div>
        )}
      </div>

      {/* Quick Save Modal Popover */}
      {isQuickSaving && (
        <div className="bg-[#171B38] border border-indigo-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Bookmark className="w-4 h-4 text-indigo-400" />
            <span>Save Custom Chord Progression to Browser:</span>
          </div>
          <form onSubmit={handleQuickSaveSubmit} className="flex items-center gap-2 flex-1 max-w-md">
            <input
              type="text"
              required
              autoFocus
              placeholder="Progression Name..."
              value={quickSaveName}
              onChange={(e) => setQuickSaveName(e.target.value)}
              className="flex-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors shrink-0"
            >
              Save Progression
            </button>
            <button
              type="button"
              onClick={() => setIsQuickSaving(false)}
              className="bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#252B48] transition-colors shrink-0"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Visual Scale Degrees Strip (DELETED) */}

      {/* Quick Access Top Progression Presets Strip (DELETED) */}

      {/* Active Progression Blocks & Playable Chord Pads */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-[#252B48] pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Active Chord Progression Loop ({chords.length} Chords)
            </span>
            {isAutoReharmonizedIndicator && (
              <span className="flex items-center gap-1 bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-semibold px-2 py-0.5 rounded-full animate-in fade-in" title="Automatically reharmonized to active scale">
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>Auto-Reharmonized to {scaleRoot} {scaleType}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-slate-500">Master Velocity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={masterChordVelocity}
              onChange={(e) => onChangeMasterChordVelocity(parseFloat(e.target.value))}
              className="w-24 h-1.5 bg-[#12152A] rounded-lg cursor-pointer"
            />
          </div>
          <button
            id="btn-add-chord"
            onClick={addChord}
            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Chord</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          {chords.map((chord, idx) => {
            const isActive = playingIndex === idx || activeChordId === chord.id;
            return (
              <div
                key={chord.id}
                id={`chord-block-${chord.id}`}
                className={`bg-[#0B0D19] border rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all ${
                  isActive
                    ? 'border-indigo-400 ring-2 ring-indigo-500/50 bg-[#161B36]'
                    : 'border-[#252B48] hover:border-[#3B4371]'
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-slate-400 bg-[#1C213E] px-2 py-0.5 rounded">
                    Bar {idx + 1}
                  </span>
                  <button
                    id={`btn-remove-chord-${chord.id}`}
                    onClick={() => removeChord(chord.id)}
                    className="text-slate-500 hover:text-rose-400 transition-colors p-1 cursor-pointer"
                    title="Delete Chord"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Big Interactive Chord Trigger Pad */}
                <button
                  id={`btn-play-chord-${chord.id}`}
                  onClick={() => {
  const now = audioEngine.getAudioContext()?.currentTime ?? 0;
  playChordWithRhythm(chord, now, rhythmPattern);
  playBassWithPattern(chord, now, bassPattern);
  setActiveChordId(chord.id);
  setTimeout(() => setActiveChordId(null), (chord.bars || 1) * quarterNoteMs(bpm) * 4);
}}
                  className={`w-full py-4 rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg scale-98'
                      : 'bg-[#181C35] hover:bg-[#22274A] text-slate-100'
                  }`}
                >
                  <span className="text-2xl font-black tracking-tight flex items-baseline gap-1">
                    {chord.root}
                    <span className="text-sm font-semibold text-indigo-400">{chord.quality}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono mt-1">
                    {chord.notes.join(' • ')}
                  </span>
                </button>

                {/* Edit Controls */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#252B48]/60">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Root</label>
                    <select
                      id={`select-chord-root-${chord.id}`}
                      value={chord.root}
                      onChange={(e) => updateChord(chord.id, { root: e.target.value })}
                      className="w-full bg-[#12152A] border border-[#2D355A] text-slate-200 text-xs rounded p-1"
                    >
                      {ROOTS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Quality</label>
                    <select
                      id={`select-chord-quality-${chord.id}`}
                      value={chord.quality}
                      onChange={(e) => updateChord(chord.id, { quality: e.target.value })}
                      className="w-full bg-[#12152A] border border-[#2D355A] text-slate-200 text-xs rounded p-1"
                    >
                      <optgroup label="Triads">
                        <option value="maj">Major (maj)</option>
                        <option value="min">Minor (min)</option>
                        <option value="dim">Diminished (dim)</option>
                        <option value="aug">Augmented (aug)</option>
                        <option value="sus2">Sus 2</option>
                        <option value="sus4">Sus 4</option>
                      </optgroup>
                      <optgroup label="7th Chords">
                        <option value="maj7">Major 7th (maj7)</option>
                        <option value="min7">Minor 7th (min7)</option>
                        <option value="7">Dominant 7th (7)</option>
                        <option value="m7b5">Half-Dim (m7b5)</option>
                        <option value="dim7">Diminished 7th (dim7)</option>
                        <option value="7sus4">7 Sus 4</option>
                      </optgroup>
                      <optgroup label="Extensions & Additions">
                        <option value="9">Dominant 9th (9)</option>
                        <option value="maj9">Major 9th (maj9)</option>
                        <option value="min9">Minor 9th (min9)</option>
                        <option value="add9">Add 9</option>
                        <option value="6">Major 6th (6)</option>
                        <option value="min6">Minor 6th (min6)</option>
                      </optgroup>
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 block mb-0.5">Bass</label>
                    <select
                      id={`select-chord-bass-${chord.id}`}
                      value={chord.bassNote ?? ''}
                      onChange={(e) => updateChord(chord.id, { bassNote: e.target.value || null })}
                      className="w-full bg-[#12152A] border border-[#2D355A] text-slate-200 text-xs rounded p-1"
                      title="Bass note override for this chord (slash chord / inversion). Auto = chord root."
                    >
                      <option value="">Auto</option>
                      {chord.notes.slice(1, 4).map((n, i) => (
                        <option key={`${n}-${i}`} value={n}>
                          {['3rd', '5th', '7th'][i]} ({n})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bass Module Panel */}
      <div className="mt-4 bg-[#12152A] border border-[#252B48] rounded-xl p-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-emerald-300">Bass Module</h3>
          <p className="text-[10px] text-slate-500">
            Bass line follows the same chord progression loop; pattern steps are 16th notes.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Bass Preset</label>
            <select
              id="select-bass-sound-preset"
              value={selectedBassPresetId}
              onChange={(e) => {
                const preset = FACTORY_BASS_PRESETS.find((p) => p.id === e.target.value);
                if (!preset) return;
                setSelectedBassPresetId(preset.id);
                onChangeBassSynthParams({ ...bassSynthParams, ...preset.params });
              }}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Bass sound preset (dedicated bass factory presets)"
            >
              {FACTORY_BASS_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Bass Octave</label>
            <select
              id="select-bass-octave"
              value={bassOctave}
              onChange={(e) => onChangeBassOctave(parseInt(e.target.value, 10))}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Register for the bass line (embedded in the note names)"
            >
              {[1, 2, 3, 4].map((o) => (
                <option key={o} value={o}>Oct {o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Bass Pattern</label>
            <select
              id="select-bass-rhythm-pattern"
              value={bassPatternId}
              onChange={(e) => onChangeBassPatternId(e.target.value)}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Bass pattern (16th-note grid, deterministic)"
            >
              {BASS_STYLE_GROUPS.map((group) => (
                <optgroup key={group.style} label={group.style}>
                  {group.patterns.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Full Chord Preset Library Sidebar Drawer */}
      <ChordPresetLibrary
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        currentChords={chords}
        scaleRoot={scaleRoot}
        scaleType={scaleType}
        autoReharmonize={autoReharmonize}
        synthParams={synthParams}
        onApplyChords={handleApplyLibraryChords}
      />
    </div>
  );
};
