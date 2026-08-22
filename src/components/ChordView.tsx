import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  Music,
  Play,
  Square,
  Sparkles,
  Plus,
  Trash2,
  ArrowRight,
  Library,
  Bookmark,
  Check,
  Volume2,
  VolumeX,
  GripVertical,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { motion } from "motion/react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChordItem, SynthParams } from "../types";
import { useAppStore } from "../store/store";
import { audioEngine, STEPS_PER_BAR } from "../audio/engine";
import {
  getCustomPresets,
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from "../audio/synthPresets";
import {
  RHYTHM_PATTERNS,
  RHYTHM_STYLE_GROUPS,
  RhythmPattern,
  feelToHoldScale,
} from "../audio/rhythmPatterns";
import { FACTORY_BASS_PRESETS } from "../audio/bassPresets";
import {
  BASS_PATTERNS,
  BASS_STYLE_GROUPS,
  BassPattern,
  isApproachToken,
  resolveBassSteps,
} from "../audio/bassPatterns";
import {
  deriveChordNotes,
  reharmonizeProgressionToScale,
  generateBlockChordNotes,
  quarterNoteMs,
  sixteenthNoteMs,
  rootSemitone,
  shiftNoteOctave,
  SCALES,
  ROOTS,
  getDiatonicChordForDegree,
  getBorrowedChords,
} from "../utils/musicTheory";
import {
  ChordPresetLibrary,
  getCustomChordProgressions,
  saveCustomChordProgression,
  CustomChordProgressionItem,
} from "./ChordPresetLibrary";

const SELECT_BASE =
  "bg-[#171B36] border border-[#2D355A] rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-200";

export interface ProgressionTemplate {
  name: string;
  category:
    | "Pop & EDM"
    | "Jazz & Neo-Soul"
    | "Lofi & R&B"
    | "Rock & Blues"
    | "Anime & J-Pop"
    | "Cinematic & Modal"
    | "Classical & Baroque";
  roman: string;
  description: string;
  // Semitone intervals relative to the chosen key's root (0 = Key root)
  // along with chord quality for key transposition
  relativeChords: Array<{ interval: number; quality: string; bars: number }>;
}

export const CHORD_PROGRESSION_TEMPLATES: ProgressionTemplate[] = [
  // Pop & EDM
  {
    name: "Classic 4-Chord Pop Anthem",
    category: "Pop & EDM",
    roman: "I – V – vi – IV",
    description:
      "The definitive major-scale pop progression creating an instantly uplifting and catchy flow.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 7, quality: "maj", bars: 1 }, // V
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
    ],
  },
  {
    name: "Emotional Minor Synthwave",
    category: "Pop & EDM",
    roman: "vi – IV – I – V",
    description:
      "Moody, heroic, and emotional minor opening used widely in synthwave, EDM, and cinematic anthems.",
    relativeChords: [
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 7, quality: "maj", bars: 1 }, // V
    ],
  },
  {
    name: "Classic 50s Doo-Wop Cadence",
    category: "Pop & EDM",
    roman: "I – vi – IV – V",
    description:
      "Timeless vintage progression with warm, romantic, and circular harmonic resolution.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 7, quality: "maj", bars: 1 }, // V
    ],
  },
  {
    name: "Future Bass / Euphoric EDM Lift",
    category: "Pop & EDM",
    roman: "IVmaj7 – V7 – iiim7 – vim7",
    description:
      "Lush 7th chord cadence creating unstoppable momentum and euphoric drops.",
    relativeChords: [
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 4, quality: "min7", bars: 1 }, // iiim7
      { interval: 9, quality: "min7", bars: 1 }, // vim7
    ],
  },
  {
    name: "Club Dance & House Groove",
    category: "Pop & EDM",
    roman: "i – VI – VII – v",
    description:
      "Driving natural minor cadence standard in modern deep house and electronic dance music.",
    relativeChords: [
      { interval: 0, quality: "min7", bars: 1 }, // i
      { interval: 8, quality: "maj7", bars: 1 }, // VI
      { interval: 10, quality: "7", bars: 1 }, // VII
      { interval: 7, quality: "min7", bars: 1 }, // v
    ],
  },

  // Jazz & Neo-Soul
  {
    name: "Jazz ii-V-I-VI Turnaround",
    category: "Jazz & Neo-Soul",
    roman: "ii7 – V7 – Imaj7 – VI7",
    description:
      "The quintessential jazz standard backbone featuring a secondary dominant turnaround.",
    relativeChords: [
      { interval: 2, quality: "min7", bars: 1 }, // ii7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 9, quality: "7", bars: 1 }, // VI7
    ],
  },
  {
    name: "Neo-Soul Butter Flow",
    category: "Jazz & Neo-Soul",
    roman: "Imaj9 – viim7b5 – III7 – vim9",
    description:
      "Complex soulful harmony with half-diminished 7b5 leading into a dominant resolution.",
    relativeChords: [
      { interval: 0, quality: "maj9", bars: 1 }, // Imaj9
      { interval: 11, quality: "m7b5", bars: 1 }, // viim7b5
      { interval: 4, quality: "7", bars: 1 }, // III7
      { interval: 9, quality: "min9", bars: 1 }, // vim9
    ],
  },
  {
    name: "Chromatic Mediants / Giant Step Cycle",
    category: "Jazz & Neo-Soul",
    roman: "Imaj7 – bVImaj7 – bIImaj7 – V7",
    description:
      "Chromatic third root movements providing a vibrant, otherworldly modal jazz coloration.",
    relativeChords: [
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 8, quality: "maj7", bars: 1 }, // bVImaj7
      { interval: 1, quality: "maj7", bars: 1 }, // bIImaj7
      { interval: 7, quality: "7sus4", bars: 1 }, // V7sus4
    ],
  },

  // Lofi & R&B
  {
    name: "Lofi Extended 9th Coffeehouse",
    category: "Lofi & R&B",
    roman: "ii9 – V13 – Imaj9 – IVmaj7",
    description:
      "Warm, relaxed extended 9th and 13th chords tailored for mellow beats and study sessions.",
    relativeChords: [
      { interval: 2, quality: "min9", bars: 1 }, // ii9
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 0, quality: "maj9", bars: 1 }, // Imaj9
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
    ],
  },
  {
    name: "Contemporary R&B / Trap-Soul Flow",
    category: "Lofi & R&B",
    roman: "i9 – iv7 – VII9 – IIImaj7",
    description:
      "Sultry, atmospheric minor progression standard in contemporary R&B and downtempo production.",
    relativeChords: [
      { interval: 0, quality: "min9", bars: 1 }, // i9
      { interval: 5, quality: "min7", bars: 1 }, // iv7
      { interval: 10, quality: "9", bars: 1 }, // VII9
      { interval: 3, quality: "maj7", bars: 1 }, // IIImaj7
    ],
  },
  {
    name: "Melancholy Bedroom Pop",
    category: "Lofi & R&B",
    roman: "Imaj7 – IVmaj7 – ii7 – V7",
    description:
      "Intimate, nostalgic daydream feel with soft major-7th oscillations and tender resolutions.",
    relativeChords: [
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 2, quality: "min7", bars: 1 }, // ii7
      { interval: 7, quality: "7", bars: 1 }, // V7
    ],
  },

  // Anime & J-Pop
  {
    name: "Royal Road / Oudo Cadence (王道進行)",
    category: "Anime & J-Pop",
    roman: "IVmaj7 – V7 – iiim7 – vim7",
    description:
      "The golden standard harmonic sequence of Asian pop and modern dynamic anime theme tracks.",
    relativeChords: [
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 4, quality: "min7", bars: 1 }, // iiim7
      { interval: 9, quality: "min7", bars: 1 }, // vim7
    ],
  },
  {
    name: "City Pop / Marusa Groove (丸サ進行)",
    category: "Anime & J-Pop",
    roman: "IVmaj7 – III7 – vim7 – I7",
    description:
      "Infectious groove with secondary dominant transition standard in vintage City Pop and Funk.",
    relativeChords: [
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 4, quality: "7", bars: 1 }, // III7 (secondary dominant)
      { interval: 9, quality: "min7", bars: 1 }, // vim7
      { interval: 0, quality: "7", bars: 1 }, // I7
    ],
  },
  {
    name: "Heroic Anthem / J-Rock Drive",
    category: "Anime & J-Pop",
    roman: "vi – IV – V – I",
    description:
      "High-energy, heroic minor-to-major resolution celebrating triumph and determination.",
    relativeChords: [
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 7, quality: "maj", bars: 1 }, // V
      { interval: 0, quality: "maj", bars: 1 }, // I
    ],
  },

  // Rock & Blues
  {
    name: "12-Bar Blues Standard",
    category: "Rock & Blues",
    roman: "I7 – IV7 – I7 – V7 – IV7 – I7",
    description:
      "The foundational public domain 12-bar blues form loaded with dominant 7th grit.",
    relativeChords: [
      { interval: 0, quality: "7", bars: 2 }, // I7
      { interval: 5, quality: "7", bars: 1 }, // IV7
      { interval: 0, quality: "7", bars: 1 }, // I7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 5, quality: "7", bars: 1 }, // IV7
      { interval: 0, quality: "7", bars: 2 }, // I7
    ],
  },
  {
    name: "Mixolydian Rock Anthem",
    category: "Rock & Blues",
    roman: "I – bVII – IV – I",
    description:
      "Modal rock swagger featuring the flattened seventh chord for a gritty, driving feel.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 10, quality: "maj", bars: 1 }, // bVII
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 0, quality: "maj", bars: 1 }, // I
    ],
  },
  {
    name: "Andalusian / Flamenco Descent",
    category: "Rock & Blues",
    roman: "i – bVII – bVI – V",
    description:
      "Dramatic descending Phrygian bassline cadence rooted in historic Spanish folk and acoustic rock.",
    relativeChords: [
      { interval: 0, quality: "min", bars: 1 }, // i
      { interval: 10, quality: "maj", bars: 1 }, // bVII
      { interval: 8, quality: "maj", bars: 1 }, // bVI
      { interval: 7, quality: "7", bars: 1 }, // V7
    ],
  },

  // Cinematic & Modal
  {
    name: "Epic Cinematic Ostinato",
    category: "Cinematic & Modal",
    roman: "i – bVI – III – bVII",
    description:
      "Monumental cinematic progression built for soaring blockbuster film scores and orchestral trailers.",
    relativeChords: [
      { interval: 0, quality: "min", bars: 1 }, // i
      { interval: 8, quality: "maj", bars: 1 }, // bVI
      { interval: 3, quality: "maj", bars: 1 }, // III
      { interval: 10, quality: "maj", bars: 1 }, // bVII
    ],
  },
  {
    name: "Dorian Space Voyage",
    category: "Cinematic & Modal",
    roman: "i7 – IV7 – i7 – IV7",
    description:
      "Floating, futuristic vamp utilizing natural 6th modal harmonization for electronic soundscapes.",
    relativeChords: [
      { interval: 0, quality: "min7", bars: 1 }, // i7
      { interval: 5, quality: "7", bars: 1 }, // IV7 (Major IV in Dorian)
      { interval: 0, quality: "min7", bars: 1 }, // i7
      { interval: 5, quality: "7", bars: 1 }, // IV7
    ],
  },
  {
    name: "Lydian Dreamscape",
    category: "Cinematic & Modal",
    roman: "Imaj7 – II – Imaj7 – II",
    description:
      "Magical raised-4th harmony evoking wonder, airborne flight, and majestic adventure.",
    relativeChords: [
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 2, quality: "maj", bars: 1 }, // II (Major 2 in Lydian)
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 2, quality: "maj", bars: 1 }, // II
    ],
  },

  // Classical & Baroque
  {
    name: "Baroque Canon Cadence",
    category: "Classical & Baroque",
    roman: "I – V – vi – iii – IV – I – IV – V",
    description:
      "The golden traditional baroque harmonic sequence celebrated across 300 years of music history.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 7, quality: "maj", bars: 1 }, // V
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 4, quality: "min", bars: 1 }, // iii
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 7, quality: "maj", bars: 1 }, // V
    ],
  },
  {
    name: "Passacaglia / Circle of Fifths Descent",
    category: "Classical & Baroque",
    roman: "i – iv – VII – III – VI – iio – V – i",
    description:
      "Hypnotic circular resolution driving classical drama, emotional tension, and resolve.",
    relativeChords: [
      { interval: 0, quality: "min", bars: 1 }, // i
      { interval: 5, quality: "min", bars: 1 }, // iv
      { interval: 10, quality: "maj", bars: 1 }, // VII
      { interval: 3, quality: "maj", bars: 1 }, // III
      { interval: 8, quality: "maj", bars: 1 }, // VI
      { interval: 2, quality: "dim", bars: 1 }, // iio
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 0, quality: "min", bars: 1 }, // i
    ],
  },
];

type BarInvariantEvent = {
  noteName: string;
  velocity: number;
  timeOffset: number;
  hold: number;
  lastBarOnly?: boolean;
};

// Schedules one precomputed, bar-invariant event set at the start of each bar
function scheduleBarInvariantEvents(
  events: BarInvariantEvent[],
  params: SynthParams,
  source: string,
  startTime: number,
  barDur: number,
  totalBars: number,
): void {
  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = startTime + bar * barDur;
    const isLastBar = bar === totalBars - 1;
    for (const ev of events) {
      if (!isLastBar && ev.lastBarOnly) continue;
      audioEngine.triggerSynthNoteOn(
        ev.noteName,
        params,
        ev.velocity,
        barStart + ev.timeOffset,
        source,
      );
      audioEngine.triggerSynthNoteOff(
        ev.noteName,
        params.release,
        barStart + ev.timeOffset + ev.hold,
        source,
      );
    }
  }
}
export const ChordView: React.FC = React.memo(() => {
  // ChordView reads the store directly (Task 5): every value below replaces
  // one of the ~34 props it used to receive from App.tsx.
  const chords = useAppStore((s) => s.chords);
  const setChords = useAppStore((s) => s.setChords);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const setChordRhythmId = useAppStore((s) => s.setChordRhythmId);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const setChordFeel = useAppStore((s) => s.setChordFeel);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const setChordOctave = useAppStore((s) => s.setChordOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const setBassPatternId = useAppStore((s) => s.setBassPatternId);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const setBassFeel = useAppStore((s) => s.setBassFeel);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const setBassOctave = useAppStore((s) => s.setBassOctave);
  const chordMuted = useAppStore((s) => s.chordMuted);
  const toggleChordMuted = useAppStore((s) => s.toggleChordMuted);
  const bassMuted = useAppStore((s) => s.bassMuted);
  const toggleBassMuted = useAppStore((s) => s.toggleBassMuted);
  const bpm = useAppStore((s) => s.bpm);
  const isPlaying = useAppStore((s) => s.isChordsPlaying);
  const chordVolume = useAppStore((s) => s.chordVolume);
  const setChordVolume = useAppStore((s) => s.setChordVolume);
  const bassVolume = useAppStore((s) => s.bassVolume);
  const setBassVolume = useAppStore((s) => s.setBassVolume);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  // Chord sound presets: factory presets plus presets saved from the synth view
  const customPresets = getCustomPresets();

  const rhythmPattern = useMemo(
    () => RHYTHM_PATTERNS.find((p) => p.id === rhythmId) ?? RHYTHM_PATTERNS[0],
    [rhythmId],
  );

  // Schedule a whole chord across its bars using the selected rhythm pattern:
  // block hits strike every note at once, strums cascade note-by-note.
  const playChordWithRhythm = useCallback(
    (chord: ChordItem, startTime: number, pattern: RhythmPattern) => {
      audioEngine.init();

      const notes = generateBlockChordNotes(
        chord.quality,
        chord.root,
        chordOctave,
      );
      const stepDur = sixteenthNoteMs(bpm) / 1000;
      const totalBars = chord.bars || 1;

      // Precompute the pattern's events once per chord trigger (bar-invariant)
      const holdScale = feelToHoldScale(chordFeel);
      const events = pattern.hits.flatMap((hit) => {
        const offset = hit.step * stepDur;
        const hold = Math.max(0.05, (hit.holdSteps ?? 1) * stepDur * holdScale);
        const baseVelocity = hit.velocity ?? 0.8;
        const hitNotes = hit.note !== undefined ? [notes[hit.note]] : notes;
        const isStrum = hit.type === "strum";
        const orderedNotes =
          isStrum && hit.direction === "up"
            ? [...hitNotes].reverse()
            : hitNotes;
        const spreadMs = hit.spreadMs ?? 30;

        return orderedNotes.flatMap((n, i) => {
          if (!n) return [];
          const noteName = hit.octaveShift
            ? shiftNoteOctave(n, hit.octaveShift)
            : n;
          const timeOffset = offset + (isStrum ? (i * spreadMs) / 1000 : 0);
          const velocity = isStrum
            ? Math.max(0.1, baseVelocity * (1 - i * 0.08))
            : baseVelocity;
          return [{ noteName, velocity, timeOffset, hold }];
        });
      });

      const barDur = stepDur * STEPS_PER_BAR;
      scheduleBarInvariantEvents(events, chordSynthParams, "chord", startTime, barDur, totalBars);
    },
    [bpm, chordSynthParams, chordOctave, chordFeel],
  );

  const playBassWithPattern = useCallback(
    (chord: ChordItem, startTime: number, pattern: BassPattern) => {
      audioEngine.init();
      const chordIdx = Math.max(0, chords.indexOf(chord));
      // Events are bar-invariant (the clock advances by barDur per bar); schedule
      // the resolved set at each bar's start. Approach tokens lead into the NEXT
      // chord, so they only play on the last bar.
      const events = resolveBassSteps(
        pattern,
        chords,
        chordIdx,
        bassOctave,
        scaleRoot,
        scaleType,
        bpm,
        feelToHoldScale(bassFeel),
      ).map((ev) => ({
        noteName: ev.noteName,
        velocity: ev.velocity,
        timeOffset: ev.timeOffsetSec,
        hold: ev.holdSec,
        lastBarOnly: isApproachToken(ev.token),
      }));
      const stepDur = sixteenthNoteMs(bpm) / 1000;
      const barDur = stepDur * STEPS_PER_BAR;
      const totalBars = chord.bars || 1;
      scheduleBarInvariantEvents(events, bassSynthParams, "bass", startTime, barDur, totalBars);
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams, bassFeel],
  );

  // Master Playback Loop — driven by the shared audio-clock scheduler
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customProgressions, setCustomProgressions] = useState<
    CustomChordProgressionItem[]
  >([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>("");
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [autoReharmonize, setAutoReharmonize] = useState<boolean>(true);
  const [isAutoReharmonizedIndicator, setIsAutoReharmonizedIndicator] =
    useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [use7thsInQuickAdd, setUse7thsInQuickAdd] = useState<boolean>(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = chords.findIndex((c) => c.id === active.id);
      const newIndex = chords.findIndex((c) => c.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setChords(arrayMove(chords, oldIndex, newIndex));
      }
    }
  };

  const handleMoveChord = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= chords.length) return;
    const updated = [...chords];
    const [removed] = updated.splice(index, 1);
    updated.splice(newIndex, 0, removed);
    setChords(updated);
  };

  const bassPattern =
    BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];

  // Volumes live in the store; engineSync pushes them into the engine buses
  // (no dual-write here — Task 5).
  const handleChordVolumeChange = (vol: number) => {
    setChordVolume(vol);
  };

  const handleBassVolumeChange = (vol: number) => {
    setBassVolume(vol);
  };
  const armedRef = useRef(false);
  const chordIndexRef = useRef(0);
  const nextBarStepRef = useRef(0);

  // Latest callbacks via ref so param slides (which re-create these callbacks
  // every tick) never resubscribe the clock. Resubscribing on every slider
  // event stops/restarts the shared clock interval faster than it can fire —
  // the scheduler stalls and the next chord arrives late.
  const playFnsRef = useRef({ playChordWithRhythm, playBassWithPattern });
  useEffect(() => {
    playFnsRef.current = { playChordWithRhythm, playBassWithPattern };
  });

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
      playFnsRef.current.playChordWithRhythm(chord, time, rhythmPattern);
      playFnsRef.current.playBassWithPattern(chord, time, bassPattern);
      setPlayingIndex(chordIndexRef.current % chords.length);
      setActiveChordId(chord.id);
      nextBarStepRef.current = step + (chord.bars || 1) * STEPS_PER_BAR;
      chordIndexRef.current++;
    });
  }, [isPlaying, chords, rhythmPattern, bassPattern]);

  // Auto-reharmonize current chords when scale/root changes if autoReharmonize is enabled
  useEffect(() => {
    if (autoReharmonize && chords.length > 0) {
      const updated = reharmonizeProgressionToScale(
        chords,
        scaleRoot,
        scaleType,
        chordOctave,
      );
      setChords(updated);
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
        chordOctave,
      );
    });

    if (autoReharmonize) {
      newChords = reharmonizeProgressionToScale(
        newChords,
        scaleRoot,
        scaleType,
        chordOctave,
      );
      setIsAutoReharmonizedIndicator(true);
    } else {
      setIsAutoReharmonizedIndicator(false);
    }

    setChords(newChords);
  };

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    let finalChords = libraryChords.map((c, i) =>
      deriveChordNotes(
        { ...c, id: `lib-chord-${Date.now()}-${i}` },
        chordOctave,
      ),
    );

    if (autoReharmonize) {
      finalChords = reharmonizeProgressionToScale(
        finalChords,
        scaleRoot,
        scaleType,
        chordOctave,
      );
      setIsAutoReharmonizedIndicator(true);
    } else {
      setIsAutoReharmonizedIndicator(false);
    }

    setChords(finalChords);
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim() || chords.length === 0) return;

    const saved = saveCustomChordProgression(
      quickSaveName.trim(),
      chords,
      "User",
      "Saved from Chord View",
      chords.map((c) => `${c.root}${c.quality}`).join(" → "),
    );

    setCustomProgressions(getCustomChordProgressions());
    setIsQuickSaving(false);
    setQuickSaveName("");
    setSaveToast(`Saved progression "${saved.name}"!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const addChord = () => {
    const newChord: ChordItem = deriveChordNotes(
      {
        id: `chord-${Date.now()}`,
        root: scaleRoot,
        quality: "maj7",
        bars: 1,
        notes: [],
      },
      chordOctave,
    );
    setChords([...chords, newChord]);
  };

  const addDiatonicChord = (degreeIndex: number) => {
    const diatonic = getDiatonicChordForDegree(
      degreeIndex,
      scaleRoot,
      scaleType,
      use7thsInQuickAdd,
    );
    const newChord: ChordItem = deriveChordNotes(
      {
        id: `chord-${Date.now()}`,
        root: diatonic.root,
        quality: diatonic.quality,
        bars: 1,
        notes: [],
      },
      chordOctave,
    );
    setChords([...chords, newChord]);
  };

  const addBorrowedChord = (root: string, quality: string) => {
    const newChord: ChordItem = deriveChordNotes(
      {
        id: `chord-${Date.now()}`,
        root,
        quality,
        bars: 1,
        notes: [],
      },
      chordOctave,
    );
    setChords([...chords, newChord]);
  };

  const activePreviewTimeoutsRef = useRef<number[]>([]);

  const handlePreviewMouseDown = (e: React.MouseEvent | React.TouchEvent, root: string, quality: string) => {
    e.stopPropagation();
    e.preventDefault();
    audioEngine.init();
    const tempChord: ChordItem = {
      id: "preview",
      root,
      quality,
      bars: 1,
      notes: [],
    };
    const derived = deriveChordNotes(tempChord, chordOctave);
    const now = audioEngine.getAudioContext()?.currentTime ?? 0;
    
    // Play with rhythm pattern
    playChordWithRhythm(derived, now, rhythmPattern);
    
    // Also trigger bass preview if desired or chord rhythm
    const stepDur = sixteenthNoteMs(bpm) / 1000;
    const totalDurationMs = rhythmPattern.hits.reduce((max, h) => Math.max(max, (h.step + (h.holdSteps || 1)) * stepDur * 1000), 500);

    const tid = window.setTimeout(() => {
      // auto cleanup if held beyond pattern loop
    }, totalDurationMs);
    activePreviewTimeoutsRef.current.push(tid);
  };

  const handlePreviewMouseUp = (e: React.MouseEvent | React.TouchEvent, root: string, quality: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!audioEngine.getAudioContext()) return;

    // Stop all active chord and bass notes immediately on release
    activePreviewTimeoutsRef.current.forEach(clearTimeout);
    activePreviewTimeoutsRef.current = [];

    // Cuts the whole scheduled pattern, not just notes sounding right now.
    audioEngine.stopSource('chord', 0.15);
  };

  const handleCardPreviewMouseDown = (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => {
    e.stopPropagation();
    audioEngine.init();
    const now = audioEngine.getAudioContext()?.currentTime ?? 0;
    playChordWithRhythm(chord, now, rhythmPattern);
    playBassWithPattern(chord, now, bassPattern);
    setActiveChordId(chord.id);
  };

  const handleCardPreviewMouseUp = (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => {
    e.stopPropagation();
    if (!audioEngine.getAudioContext()) return;
    setActiveChordId(null);

    // Cuts the whole scheduled pattern (chord + bass), future hits included.
    audioEngine.stopSource('chord', 0.15);
    audioEngine.stopSource('bass', 0.15);
  };

  const removeChord = (id: string) => {
    setChords(chords.filter((c) => c.id !== id));
  };

  const updateChord = (id: string, updates: Partial<ChordItem>) => {
    setChords(
      chords.map((c) => {
        if (c.id !== id) return c;
        return deriveChordNotes({ ...c, ...updates }, chordOctave);
      }),
    );
  };

  const totalProgressionsCount =
    CHORD_PROGRESSION_TEMPLATES.length + customProgressions.length;

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
          {/* Per-layer mute toggles (engine source buses — tails cut instantly) */}
          <button
            id="btn-mute-chord"
            onClick={toggleChordMuted}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              chordMuted
                ? "bg-rose-600/30 border-rose-500/50 text-rose-200"
                : "bg-[#0B0D19] border-[#2D355A] text-slate-400"
            }`}
            title="Mute the chord layer on its engine bus (instant, includes tails)"
          >
            {chordMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-indigo-300" />
            )}
            <span>Chord: {chordMuted ? "OFF" : "ON"}</span>
          </button>

          <button
            id="btn-mute-bass"
            onClick={toggleBassMuted}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              bassMuted
                ? "bg-rose-600/30 border-rose-500/50 text-rose-200"
                : "bg-[#0B0D19] border-[#2D355A] text-slate-400"
            }`}
            title="Mute the bass layer on its engine bus (instant, includes tails)"
          >
            {bassMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
            )}
            <span>Bass: {bassMuted ? "OFF" : "ON"}</span>
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
          <form
            onSubmit={handleQuickSaveSubmit}
            className="flex items-center gap-2 flex-1 max-w-md"
          >
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
      <div className="bg-[#12152A] border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-[#252B48] pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Active Chord Progression Loop ({chords.length} Chords)
            </span>
            {isAutoReharmonizedIndicator && (
              <span
                className="flex items-center gap-1 bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-semibold px-2 py-0.5 rounded-full animate-in fade-in"
                title="Automatically reharmonized to active scale"
              >
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>
                  Auto-Reharmonized to {scaleRoot} {scaleType}
                </span>
              </span>
            )}
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

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Chord Sound Preset Select */}
          <select
            id="select-chord-sound-preset"
            value={chordSynthParams.preset ?? ""}
            onChange={(e) => {
              const preset = findPresetByName(
                e.target.value,
                getAllSynthPresets(customPresets),
              );
              if (!preset) return;
              setChordSynthParams({
                ...chordSynthParams,
                ...preset.params,
                preset: preset.name,
              });
            }}
            className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
            title="Chord sound preset — factory and saved presets, synced with the synth page"
          >
            <option value="">Chord Preset…</option>
            {getPresetsGroupedByCategory(getAllSynthPresets(customPresets)).map((group) => (
              <optgroup
                key={group.category}
                label={group.label}
                className="bg-[#12152A] text-indigo-300 font-bold"
              >
                {group.presets.map((p) => (
                  <option
                    key={p.id}
                    value={p.name}
                    className={
                      p.isFactory
                        ? "bg-[#0B0D19] text-slate-200 font-normal"
                        : "bg-[#0B0D19] text-purple-300 font-normal"
                    }
                  >
                    {!p.isFactory ? `★ ${p.name}` : p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Chord Octave Select */}
          <select
            id="select-chord-octave"
            value={chordOctave}
            onChange={(e) => setChordOctave(parseInt(e.target.value, 10))}
            className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
            title="Octave for chord playback"
          >
            {[2, 3, 4, 5, 6].map((o) => (
              <option key={o} value={o}>
                Oct {o}
              </option>
            ))}
          </select>

          {/* Chord Rhythm Pattern Select */}
          <select
            id="select-chord-rhythm-pattern"
            value={rhythmId}
            onChange={(e) => setChordRhythmId(e.target.value)}
            className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
            title="Rhythm pattern for chord playback"
          >
            {RHYTHM_STYLE_GROUPS.map((group) => (
              <optgroup key={group.style} label={group.style}>
                {group.patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Chord Feel Slider (tight ↔ loose) */}
          <div className="flex items-center gap-1.5 bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs">
            <span className="text-[10px] text-slate-400 font-mono shrink-0">Feel</span>
            <span className="text-[9px] text-slate-500 font-mono shrink-0">tight</span>
            <input
              id="slider-chord-feel"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={chordFeel}
              onChange={(e) => setChordFeel(parseFloat(e.target.value))}
              className="w-20 h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500"
              title="Chord note length: tight (short holds) ↔ loose (long holds)"
            />
            <span className="text-[9px] text-slate-500 font-mono shrink-0">loose</span>
          </div>

          {/* Chord Layer Volume Slider */}
          <div className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-[10px] text-slate-400 font-mono">Vol</span>
            <input
              id="slider-chord-layer-volume"
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={chordVolume}
              onChange={(e) => handleChordVolumeChange(parseFloat(e.target.value))}
              className="w-16 h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500"
              title={`Chord Layer Gain: ${(chordVolume * 100).toFixed(0)}%`}
            />
            <span className="text-[10px] text-indigo-300 font-mono min-w-8 text-right">
              {(chordVolume * 100).toFixed(0)}%
            </span>
          </div>
          {/* Option B Re-harmonize Button */}
          <button
            id="btn-reharmonize-chord-progression"
            onClick={() => {
              const updated = reharmonizeProgressionToScale(
                chords,
                scaleRoot,
                scaleType,
                chordOctave,
              );
              setChords(updated);
              setIsAutoReharmonizedIndicator(true);
              setSaveToast(
                `Re-harmonized progression to ${scaleRoot} ${scaleType} (Option B)!`,
              );
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
                const updated = reharmonizeProgressionToScale(
                  chords,
                  scaleRoot,
                  scaleType,
                  chordOctave,
                );
                setChords(updated);
                setIsAutoReharmonizedIndicator(true);
              } else {
                setIsAutoReharmonizedIndicator(false);
              }
            }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              autoReharmonize
                ? "bg-purple-600/30 border-purple-500/50 text-purple-200"
                : "bg-[#0B0D19] border-[#2D355A] text-slate-400"
            }`}
            title="Toggle automatic re-harmonization when loading presets or changing scales"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${autoReharmonize ? "text-purple-300" : "text-slate-500"}`}
            />
            <span>Auto-Reharmonize: {autoReharmonize ? "ON" : "OFF"}</span>
          </button>
        </div>

        {/* In-Scale & Borrowed Quick Add Palette */}
        <div className="bg-[#171B36] border border-[#252B48] rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-indigo-300 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>In-Scale Chords ({scaleRoot} {scaleType}):</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">Click to append, 🔊 to preview:</span>
              <button
                type="button"
                onClick={() => setUse7thsInQuickAdd(!use7thsInQuickAdd)}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  use7thsInQuickAdd
                    ? "bg-indigo-600 text-white"
                    : "bg-[#12152A] text-slate-400 hover:text-slate-200 border border-[#2D355A]"
                }`}
              >
                {use7thsInQuickAdd ? "7th Chords" : "Triads"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Array.from({ length: SCALES[scaleType]?.intervals.length || 7 }).map((_, i) => {
              const diatonic = getDiatonicChordForDegree(i, scaleRoot, scaleType, use7thsInQuickAdd);
              return (
                <div
                  key={i}
                  onClick={() => addDiatonicChord(i)}
                  className="group flex items-center gap-1.5 bg-[#12152A] hover:bg-indigo-600/30 border border-[#2D355A] hover:border-indigo-500/50 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer shadow-sm"
                  title={`Click to add ${diatonic.root} ${diatonic.quality} (${diatonic.degreeName})`}
                >
                  <span className="font-mono text-[10px] text-indigo-400 font-bold group-hover:text-indigo-300 bg-[#1C213E] px-1.5 py-0.5 rounded">
                    {diatonic.degreeName}
                  </span>
                  <span className="font-semibold">
                    {diatonic.root} {diatonic.quality}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => handlePreviewMouseDown(e, diatonic.root, diatonic.quality)}
                    onMouseUp={(e) => handlePreviewMouseUp(e, diatonic.root, diatonic.quality)}
                    onMouseLeave={(e) => handlePreviewMouseUp(e, diatonic.root, diatonic.quality)}
                    onTouchStart={(e) => handlePreviewMouseDown(e, diatonic.root, diatonic.quality)}
                    onTouchEnd={(e) => handlePreviewMouseUp(e, diatonic.root, diatonic.quality)}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-slate-400 hover:text-indigo-300 transition-colors ml-0.5 rounded hover:bg-[#252B48] cursor-pointer select-none"
                    title="Hold to Preview Chord Audio"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Borrowed Chords (Modal Interchange) */}
          <div className="pt-2 border-t border-[#252B48]/80">
            <div className="flex items-center justify-between text-xs mb-2">
              <div className="flex items-center gap-1.5 text-purple-300 font-medium">
                <Music className="w-3.5 h-3.5 text-purple-400" />
                <span>Borrowed Chords (Modal Interchange):</span>
              </div>
              <span className="text-[10px] text-slate-400">Add colorful non-diatonic flavor:</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {getBorrowedChords(scaleRoot, scaleType).map((borrowed, i) => (
                <div
                  key={i}
                  onClick={() => addBorrowedChord(borrowed.root, borrowed.quality)}
                  className="group flex items-center gap-1.5 bg-[#12152A] hover:bg-purple-600/30 border border-[#2D355A] hover:border-purple-500/50 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer shadow-sm"
                  title={`Click to add ${borrowed.label}: ${borrowed.root} ${borrowed.quality}`}
                >
                  <span className="font-mono text-[10px] text-purple-300 font-bold group-hover:text-purple-200 bg-[#1C213E] px-1.5 py-0.5 rounded">
                    {borrowed.label}
                  </span>
                  <span className="font-semibold">
                    {borrowed.root} {borrowed.quality}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => handlePreviewMouseDown(e, borrowed.root, borrowed.quality)}
                    onMouseUp={(e) => handlePreviewMouseUp(e, borrowed.root, borrowed.quality)}
                    onMouseLeave={(e) => handlePreviewMouseUp(e, borrowed.root, borrowed.quality)}
                    onTouchStart={(e) => handlePreviewMouseDown(e, borrowed.root, borrowed.quality)}
                    onTouchEnd={(e) => handlePreviewMouseUp(e, borrowed.root, borrowed.quality)}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-slate-400 hover:text-purple-300 transition-colors ml-0.5 rounded hover:bg-[#252B48] cursor-pointer select-none"
                    title="Hold to Preview Chord Audio"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={chords.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {chords.map((chord, idx) => {
                const startBar = chords
                  .slice(0, idx)
                  .reduce((sum, c) => sum + (c.bars || 1), 1);
                const isActive = playingIndex === idx || activeChordId === chord.id;
                return (
                  <SortableChordCard
                    key={chord.id}
                    chord={chord}
                    idx={idx}
                    totalChords={chords.length}
                    startBar={startBar}
                    isActive={isActive}
                    rhythmPattern={rhythmPattern}
                    bassPattern={bassPattern}
                    bpm={bpm}
                    updateChord={updateChord}
                    removeChord={removeChord}
                    handleMoveChord={handleMoveChord}
                    playChordWithRhythm={playChordWithRhythm}
                    playBassWithPattern={playBassWithPattern}
                    setActiveChordId={setActiveChordId}
                    chordOctave={chordOctave}
                    handleCardPreviewMouseDown={handleCardPreviewMouseDown}
                    handleCardPreviewMouseUp={handleCardPreviewMouseUp}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Bass Module Panel */}
      <div className="mt-4 bg-[#12152A] border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-xl p-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-emerald-300">Bass Module</h3>
          <p className="text-[10px] text-slate-500">
            Bass line follows the same chord progression loop; pattern steps are
            16th notes.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">
              Bass Preset
            </label>
            <select
              id="select-bass-sound-preset"
              value={bassSynthParams.preset ?? ""}
              onChange={(e) => {
                const preset = findPresetByName(
                  e.target.value,
                  getAllSynthPresets(customPresets),
                );
                if (!preset) return;
                setBassSynthParams({
                  ...bassSynthParams,
                  ...preset.params,
                  preset: preset.name,
                });
              }}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Bass sound preset — any factory, bass, or saved preset, synced with the synth page"
            >
              <option value="">Bass Preset…</option>
              {getPresetsGroupedByCategory(getAllSynthPresets(customPresets)).map((group) => (
                <optgroup
                  key={group.category}
                  label={group.label}
                  className="bg-[#12152A] text-indigo-300 font-bold"
                >
                  {group.presets.map((p) => (
                    <option
                      key={p.id}
                      value={p.name}
                      className={
                        p.isFactory
                          ? "bg-[#0B0D19] text-slate-200 font-normal"
                          : "bg-[#0B0D19] text-purple-300 font-normal"
                      }
                    >
                      {!p.isFactory ? `★ ${p.name}` : p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">
              Bass Octave
            </label>
            <select
              id="select-bass-octave"
              value={bassOctave}
              onChange={(e) => setBassOctave(parseInt(e.target.value, 10))}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Register for the bass line (embedded in the note names)"
            >
              {[1, 2, 3, 4].map((o) => (
                <option key={o} value={o}>
                  Oct {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">
              Bass Pattern
            </label>
            <select
              id="select-bass-rhythm-pattern"
              value={bassPatternId}
              onChange={(e) => setBassPatternId(e.target.value)}
              className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
              title="Bass pattern (16th-note grid, deterministic)"
            >
              {BASS_STYLE_GROUPS.map((group) => (
                <optgroup key={group.style} label={group.style}>
                  {group.patterns.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Bass Feel Slider (tight ↔ loose) */}
          <div className="flex items-center gap-1.5 bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs">
            <span className="text-[10px] text-slate-400 font-mono shrink-0">Feel</span>
            <span className="text-[9px] text-slate-500 font-mono shrink-0">tight</span>
            <input
              id="slider-bass-feel"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={bassFeel}
              onChange={(e) => setBassFeel(parseFloat(e.target.value))}
              className="w-20 h-1 bg-[#0B0D19] rounded cursor-pointer accent-emerald-500"
              title="Bass note length: tight (short holds) ↔ loose (long holds)"
            />
            <span className="text-[9px] text-slate-500 font-mono shrink-0">loose</span>
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">
              Bass Level ({Math.round(bassVolume * 100)}%)
            </label>
            <div className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs h-[30px]">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <input
                id="slider-bass-layer-volume"
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={bassVolume}
                onChange={(e) => handleBassVolumeChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-emerald-500"
                title={`Bass Layer Gain: ${(bassVolume * 100).toFixed(0)}%`}
              />
            </div>
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
});

interface SortableChordCardProps {
  chord: ChordItem;
  idx: number;
  totalChords: number;
  startBar: number;
  isActive: boolean;
  rhythmPattern: RhythmPattern;
  bassPattern: BassPattern;
  bpm: number;
  updateChord: (id: string, updates: Partial<ChordItem>) => void;
  removeChord: (id: string) => void;
  handleMoveChord: (index: number, direction: -1 | 1) => void;
  playChordWithRhythm: (chord: ChordItem, startTime: number, pattern: RhythmPattern) => void;
  playBassWithPattern: (chord: ChordItem, startTime: number, pattern: BassPattern) => void;
  setActiveChordId: (id: string | null) => void;
  chordOctave: number;
  handleCardPreviewMouseDown: (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => void;
  handleCardPreviewMouseUp: (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => void;
}

function SortableChordCard({
  chord,
  idx,
  totalChords,
  startBar,
  isActive,
  rhythmPattern,
  bassPattern,
  bpm,
  updateChord,
  removeChord,
  handleMoveChord,
  playChordWithRhythm,
  playBassWithPattern,
  setActiveChordId,
  chordOctave,
  handleCardPreviewMouseDown,
  handleCardPreviewMouseUp,
}: SortableChordCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chord.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-[#0B0D19] border rounded-xl p-4 flex flex-col justify-between space-y-3 transition-colors ${
        isActive
          ? "border-indigo-400 ring-2 ring-indigo-500/50 bg-[#161B36]"
          : "border-[#252B48] hover:border-[#3B4371]"
      } ${isDragging ? "shadow-2xl ring-2 ring-indigo-500 bg-[#161B36]/95 scale-102" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 p-0.5 focus:outline-none"
            title="Drag to reorder"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono font-bold text-slate-400 bg-[#1C213E] px-2 py-0.5 rounded">
            Bar {startBar}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={idx === 0}
            onClick={() => handleMoveChord(idx, -1)}
            className="p-1 text-slate-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
            title="Move Left"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={idx === totalChords - 1}
            onClick={() => handleMoveChord(idx, 1)}
            className="p-1 text-slate-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
            title="Move Right"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            id={`btn-remove-chord-${chord.id}`}
            onClick={() => removeChord(chord.id)}
            className="text-slate-500 hover:text-rose-400 transition-colors p-1 cursor-pointer ml-1"
            title="Delete Chord"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Big Interactive Chord Trigger Pad */}
      <button
        id={`btn-play-chord-${chord.id}`}
        onMouseDown={(e) => handleCardPreviewMouseDown(e, chord)}
        onMouseUp={(e) => handleCardPreviewMouseUp(e, chord)}
        onMouseLeave={(e) => handleCardPreviewMouseUp(e, chord)}
        onTouchStart={(e) => handleCardPreviewMouseDown(e, chord)}
        onTouchEnd={(e) => handleCardPreviewMouseUp(e, chord)}
        className={`w-full py-4 rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer select-none ${
          isActive
            ? "bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg scale-98"
            : "bg-[#181C35] hover:bg-[#22274A] text-slate-100"
        }`}
        title="Hold to Preview Chord & Bass Pattern"
      >
        <span className="text-2xl font-black tracking-tight flex items-baseline gap-1">
          {chord.root}
          <span className="text-sm font-semibold text-indigo-400">
            {chord.quality}
          </span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono mt-1">
          {chord.notes.join(" • ")}
        </span>
      </button>

      {/* Edit Controls */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#252B48]/60">
        <div>
          <label className="text-[10px] text-slate-500 block mb-0.5">
            Root
          </label>
          <select
            id={`select-chord-root-${chord.id}`}
            value={chord.root}
            onChange={(e) =>
              updateChord(chord.id, { root: e.target.value })
            }
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
          <label className="text-[10px] text-slate-500 block mb-0.5">
            Quality
          </label>
          <select
            id={`select-chord-quality-${chord.id}`}
            value={chord.quality}
            onChange={(e) =>
              updateChord(chord.id, { quality: e.target.value })
            }
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
          <label className="text-[10px] text-slate-500 block mb-0.5">
            Duration (Bars)
          </label>
          <select
            id={`select-chord-bars-${chord.id}`}
            value={chord.bars || 1}
            onChange={(e) =>
              updateChord(chord.id, { bars: parseInt(e.target.value, 10) })
            }
            className="w-full bg-[#12152A] border border-[#2D355A] text-slate-200 text-xs rounded p-1"
          >
            <option value={1}>1 Bar</option>
            <option value={2}>2 Bars</option>
            <option value={4}>4 Bars</option>
          </select>
        </div>
      </div>
    </div>
  );
}
