import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Music, Play, Square, Sparkles, Plus, Trash2, ArrowRight, Library, Bookmark, Check } from 'lucide-react';
import { ChordItem, SynthParams } from '../types';
import { audioEngine } from '../audio/engine';
import { generateBlockChordNotes } from '../../shared/src/index';
import { reharmonizeProgressionToScale } from '../utils/musicTheory';
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
  bpm: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  masterChordVelocity: number;
  onChangeMasterChordVelocity: (velocity: number) => void;
}

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES: Record<string, { name: string; intervals: number[] }> = {
  'Major': { name: 'Major (Ionian)', intervals: [0, 2, 4, 5, 7, 9, 11] },
  'Natural Minor': { name: 'Natural Minor (Aeolian)', intervals: [0, 2, 3, 5, 7, 8, 10] },
  'Harmonic Minor': { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  'Dorian': { name: 'Dorian (Funk / Modal)', intervals: [0, 2, 3, 5, 7, 9, 10] },
  'Mixolydian': { name: 'Mixolydian (Blues / Rock)', intervals: [0, 2, 4, 5, 7, 9, 10] },
  'Lydian': { name: 'Lydian (Bright / Dreamy)', intervals: [0, 2, 4, 6, 7, 9, 11] },
  'Minor Pentatonic': { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  'Major Pentatonic': { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  'Blues': { name: 'Blues Scale', intervals: [0, 3, 5, 6, 7, 10] },
};

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
  isPlaying,
  onTogglePlay,
  masterChordVelocity,
  onChangeMasterChordVelocity,
}) => {
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const playChord = useCallback((chord: ChordItem, time?: number) => {
    audioEngine.init();
    setActiveChordId(chord.id);

    const notes = generateBlockChordNotes(chord.quality, chord.root, 4);
    const offTime = time !== undefined ? time + 1.2 : undefined;
    notes.forEach((n) => {
      audioEngine.triggerSynthNoteOn(n, synthParams, masterChordVelocity, time);
      audioEngine.triggerSynthNoteOff(n, 0.5, offTime);
    });

    // UI-only: clear the highlight after the chord's fixed 1.2s hold
    setTimeout(() => setActiveChordId(null), 1200);
  }, [synthParams, masterChordVelocity]);

  // Master Playback Loop — driven by the shared audio-clock scheduler
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customProgressions, setCustomProgressions] = useState<CustomChordProgressionItem[]>([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>('');
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [autoReharmonize, setAutoReharmonize] = useState<boolean>(true);
  const [isAutoReharmonizedIndicator, setIsAutoReharmonizedIndicator] = useState<boolean>(false);
  const armedRef = useRef(false);
  const chordIndexRef = useRef(0);
  const nextBarStepRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      armedRef.current = false;
      setPlayingIndex(null);
      return;
    }

    return audioEngine.subscribeClock((step, _beat, time) => {
      // Start aligned to the next quarter-note boundary of the shared grid
      if (!armedRef.current) {
        if (step % 4 !== 0) return;
        armedRef.current = true;
        chordIndexRef.current = 0;
        nextBarStepRef.current = step;
      }
      if (step < nextBarStepRef.current) return;
      const chord = chords[chordIndexRef.current % chords.length];
      playChord(chord, time);
      setPlayingIndex(chordIndexRef.current % chords.length);
      nextBarStepRef.current = step + (chord.bars || 1) * 16;
      chordIndexRef.current++;
    });
  }, [isPlaying, chords, playChord]);

  // Auto-reharmonize current chords when scale/root changes if autoReharmonize is enabled
  useEffect(() => {
    if (autoReharmonize && chords.length > 0) {
      const updated = reharmonizeProgressionToScale(chords, scaleRoot, scaleType);
      onChangeChords(updated);
      setIsAutoReharmonizedIndicator(true);
    }
  }, [scaleRoot, scaleType]);

  // Calculate notes in selected scale
  const rootIdx = ROOTS.indexOf(scaleRoot);
  const intervals = SCALES[scaleType]?.intervals || [0, 2, 4, 5, 7, 9, 11];
  const scaleNotes = intervals.map((int) => ROOTS[(rootIdx + int) % 12]);

  // Transpose the template's relative intervals cleanly to the current selected Key Root and optionally auto-reharmonize
  const applyProgressionTemplate = (template: ProgressionTemplate) => {
    const baseRootIndex = ROOTS.indexOf(scaleRoot) >= 0 ? ROOTS.indexOf(scaleRoot) : 0;

    let newChords: ChordItem[] = template.relativeChords.map((c, i) => {
      const transposedRoot = ROOTS[(baseRootIndex + c.interval) % 12];
      return {
        id: `chord-${Date.now()}-${i}`,
        root: transposedRoot,
        quality: c.quality,
        bars: c.bars,
        notes: generateBlockChordNotes(c.quality, transposedRoot, 4),
      };
    });

    if (autoReharmonize) {
      newChords = reharmonizeProgressionToScale(newChords, scaleRoot, scaleType);
      setIsAutoReharmonizedIndicator(true);
    } else {
      setIsAutoReharmonizedIndicator(false);
    }

    onChangeChords(newChords);
  };

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    let finalChords = libraryChords.map((c, i) => ({
      ...c,
      id: `lib-chord-${Date.now()}-${i}`,
      notes: generateBlockChordNotes(c.quality, c.root, 4),
    }));

    if (autoReharmonize) {
      finalChords = reharmonizeProgressionToScale(finalChords, scaleRoot, scaleType);
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
    const newChord: ChordItem = {
      id: `chord-${Date.now()}`,
      root: scaleRoot,
      quality: 'maj7',
      bars: 1,
      notes: generateBlockChordNotes('maj7', scaleRoot, 4),
    };
    onChangeChords([...chords, newChord]);
  };

  const removeChord = (id: string) => {
    onChangeChords(chords.filter((c) => c.id !== id));
  };

  const updateChord = (id: string, updates: Partial<ChordItem>) => {
    onChangeChords(
      chords.map((c) => {
        if (c.id !== id) return c;
        const root = updates.root || c.root;
        const quality = updates.quality || c.quality;
        return {
          ...c,
          ...updates,
          notes: generateBlockChordNotes(quality, root, 4),
        };
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
              const updated = reharmonizeProgressionToScale(chords, scaleRoot, scaleType);
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
                const updated = reharmonizeProgressionToScale(chords, scaleRoot, scaleType);
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
                  onClick={() => playChord(chord)}
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
                </div>
              </div>
            );
          })}
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
