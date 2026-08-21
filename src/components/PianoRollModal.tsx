import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Play,
  Square,
  Sparkles,
  Trash2,
  Volume2,
  Layers,
  Wand2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Music,
  Check,
  Clock,
  Plus,
} from 'lucide-react';
import { RegionNote, ArrangeRegion, ArrangeTrack, SynthParams } from '../types';
import { audioEngine } from '../audio/engine';

interface PianoRollModalProps {
  region: ArrangeRegion;
  track: ArrangeTrack;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  onSaveRegion: (updatedRegion: ArrangeRegion) => void;
  onClose: () => void;
}

// 3.5 Octaves from C2 (low bass) to B5 (high lead)
const NOTE_NAMES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];
const OCTAVES = [5, 4, 3, 2];

const ALL_PIANO_NOTES: string[] = [];
OCTAVES.forEach((oct) => {
  NOTE_NAMES.forEach((n) => {
    ALL_PIANO_NOTES.push(`${n}${oct}`);
  });
});

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES: Record<string, number[]> = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Natural Minor': [0, 2, 3, 5, 7, 8, 10],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Pentatonic Minor': [0, 3, 5, 7, 10],
  'Pentatonic Major': [0, 2, 4, 7, 9],
  'Blues': [0, 3, 5, 6, 7, 10],
};

export const PianoRollModal: React.FC<PianoRollModalProps> = ({
  region,
  track,
  bpm,
  scaleRoot,
  scaleType,
  onSaveRegion,
  onClose,
}) => {
  const [notes, setNotes] = useState<RegionNote[]>(region.notes || []);
  const [regionName, setRegionName] = useState<string>(region.name);
  const [durationBars, setDurationBars] = useState<number>(Math.max(1, Math.round(region.durationBeats / 4)));
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [selectedScale, setSelectedScale] = useState<string>(scaleType || 'Natural Minor');
  const [selectedRoot, setSelectedRoot] = useState<string>(scaleRoot || 'A');
  const [snapGrid, setSnapGrid] = useState<number>(1); // 1 = 16th, 2 = 8th, 4 = quarter
  const [noteDefaultDuration, setNoteDefaultDuration] = useState<number>(2); // 2 = 8th note
  const [defaultVelocity, setDefaultVelocity] = useState<number>(0.8);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const totalSteps = durationBars * 16; // 16 16th steps per bar
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  const trackSynthParams: SynthParams = track.synthParams || {
    oscType: 'sawtooth',
    subOscVolume: 0.2,
    noiseVolume: 0.01,
    detune: 5,
    filterType: 'lowpass',
    filterCutoff: 3000,
    filterResonance: 2.5,
    filterEnvAmount: 1000,
    attack: 0.02,
    decay: 0.3,
    sustain: 0.6,
    release: 0.4,
    lfoRate: 4,
    lfoDepth: 0.1,
    lfoTarget: 'cutoff',
    octave: 0,
    preset: track.name,
  };

  // Check if a note is in the selected musical scale
  const isNoteInScale = useCallback(
    (fullNote: string) => {
      const match = fullNote.match(/^([A-G][#b]?)/);
      if (!match) return false;
      const noteLetter = match[1];
      const rootIndex = ROOTS.indexOf(selectedRoot);
      const noteIndex = ROOTS.indexOf(noteLetter);
      if (rootIndex === -1 || noteIndex === -1) return false;

      const interval = (noteIndex - rootIndex + 12) % 12;
      const scaleIntervals = SCALES[selectedScale] || SCALES['Natural Minor'];
      return scaleIntervals.includes(interval);
    },
    [selectedRoot, selectedScale]
  );

  // Play audition sound when clicking on piano key
  const handleAuditionKey = (noteName: string) => {
    audioEngine.init();
    if (track.type === 'drums') {
      audioEngine.triggerDrum('kick', defaultVelocity);
    } else {
      audioEngine.triggerSynthNoteOn(noteName, trackSynthParams, defaultVelocity);
      setTimeout(() => {
        audioEngine.triggerSynthNoteOff(noteName, 0.3);
      }, 350);
    }
  };

  // Add or remove note on grid click
  const handleCellClick = (noteName: string, step: number) => {
    const snappedStep = Math.floor(step / snapGrid) * snapGrid;
    const existingIndex = notes.findIndex(
      (n) => n.note === noteName && n.startStep <= snappedStep && n.startStep + n.durationSteps > snappedStep
    );

    if (existingIndex >= 0) {
      // Remove note
      const updated = notes.filter((_, idx) => idx !== existingIndex);
      setNotes(updated);
    } else {
      // Add note
      const newNote: RegionNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        note: noteName,
        startStep: snappedStep,
        durationSteps: Math.max(1, noteDefaultDuration),
        velocity: defaultVelocity,
      };
      setNotes([...notes, newNote]);
      handleAuditionKey(noteName);
    }
  };

  // Real-time Preview Looper for Piano Roll
  const stepDurationMs = (60 / bpm / 4) * 1000;

  useEffect(() => {
    if (!isPlaying) {
      setCurrentStep(-1);
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const stepTick = () => {
      setCurrentStep((prev) => {
        const next = (prev + 1) % totalSteps;

        // Trigger any notes starting on this step
        const notesOnThisStep = notes.filter((n) => n.startStep === next);
        notesOnThisStep.forEach((n) => {
          const durationSec = (n.durationSteps * stepDurationMs) / 1000;
          if (track.type === 'drums') {
            audioEngine.triggerDrum('snare', n.velocity || defaultVelocity);
          } else {
            audioEngine.triggerTrackNote(
              track.id,
              n.note,
              trackSynthParams,
              n.velocity || defaultVelocity,
              track.volume,
              durationSec,
              track.pan
            );
          }
        });

        return next;
      });

      timerRef.current = setTimeout(stepTick, stepDurationMs);
    };

    timerRef.current = setTimeout(stepTick, stepDurationMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, bpm, stepDurationMs, totalSteps, notes, track, trackSynthParams, defaultVelocity]);

  // Melodic Pattern Generators
  const generatePattern = (type: 'arpeggio' | 'bass' | 'chords' | 'melody') => {
    const rootIndex = ROOTS.indexOf(selectedRoot) >= 0 ? ROOTS.indexOf(selectedRoot) : 0;
    const intervals = SCALES[selectedScale] || SCALES['Natural Minor'];
    const generated: RegionNote[] = [];

    if (type === 'arpeggio') {
      // 16th note upward-downward arpeggiator
      const arpIntervals = [0, 2, 4, 7, 9, 7, 4, 2]; // Scale degrees
      for (let s = 0; s < totalSteps; s += 2) {
        const deg = arpIntervals[(s / 2) % arpIntervals.length];
        const semitone = (intervals[deg % intervals.length] + Math.floor(deg / intervals.length) * 12) % 24;
        const noteLetter = ROOTS[(rootIndex + semitone) % 12];
        const oct = semitone >= 12 ? 4 : 3;
        generated.push({
          id: `arp-${Date.now()}-${s}`,
          note: `${noteLetter}${oct}`,
          startStep: s,
          durationSteps: 2,
          velocity: s % 8 === 0 ? 0.9 : 0.7,
        });
      }
    } else if (type === 'bass') {
      // Syncopated punchy bass groove in Octave 2
      const rootNote = `${selectedRoot}2`;
      const fifthNote = `${ROOTS[(rootIndex + 7) % 12]}2`;
      const octNote = `${selectedRoot}3`;

      for (let bar = 0; bar < durationBars; bar++) {
        const bStep = bar * 16;
        // Beat 1
        generated.push({ id: `b1-${bar}`, note: rootNote, startStep: bStep, durationSteps: 2, velocity: 0.95 });
        generated.push({ id: `b2-${bar}`, note: rootNote, startStep: bStep + 3, durationSteps: 1, velocity: 0.75 });
        // Beat 2
        generated.push({ id: `b3-${bar}`, note: octNote, startStep: bStep + 6, durationSteps: 2, velocity: 0.85 });
        // Beat 3
        generated.push({ id: `b4-${bar}`, note: rootNote, startStep: bStep + 8, durationSteps: 2, velocity: 0.9 });
        generated.push({ id: `b5-${bar}`, note: fifthNote, startStep: bStep + 11, durationSteps: 2, velocity: 0.8 });
        // Beat 4
        generated.push({ id: `b6-${bar}`, note: rootNote, startStep: bStep + 14, durationSteps: 2, velocity: 0.85 });
      }
    } else if (type === 'chords') {
      // Strummed 4-beat chords in Octave 3 & 4
      const chordDegrees = [
        [0, 2, 4], // I
        [3, 5, 7], // IV
        [4, 6, 8], // V
        [5, 7, 9], // vi
      ];

      for (let bar = 0; bar < durationBars; bar++) {
        const chordDegs = chordDegrees[bar % chordDegrees.length];
        const bStep = bar * 16;

        chordDegs.forEach((deg, dIdx) => {
          const semitone = intervals[deg % intervals.length];
          const noteLetter = ROOTS[(rootIndex + semitone) % 12];
          const oct = dIdx === 0 ? 3 : 4;
          // Strummed half-note chords (2 beats each)
          generated.push({
            id: `ch-${bar}-${dIdx}-1`,
            note: `${noteLetter}${oct}`,
            startStep: bStep,
            durationSteps: 8,
            velocity: 0.8,
          });
          generated.push({
            id: `ch-${bar}-${dIdx}-2`,
            note: `${noteLetter}${oct}`,
            startStep: bStep + 8,
            durationSteps: 7,
            velocity: 0.75,
          });
        });
      }
    } else if (type === 'melody') {
      // Expressive vocal/lead melody with syncopation
      const melSteps = [
        { step: 0, deg: 0, oct: 4, dur: 4 },
        { step: 4, deg: 2, oct: 4, dur: 2 },
        { step: 6, deg: 4, oct: 4, dur: 2 },
        { step: 8, deg: 7, oct: 4, dur: 6 },
        { step: 14, deg: 4, oct: 4, dur: 2 },
      ];

      for (let bar = 0; bar < durationBars; bar++) {
        const bStep = bar * 16;
        melSteps.forEach((m, idx) => {
          const semitone = intervals[m.deg % intervals.length];
          const noteLetter = ROOTS[(rootIndex + semitone) % 12];
          generated.push({
            id: `mel-${bar}-${idx}`,
            note: `${noteLetter}${m.oct}`,
            startStep: bStep + m.step,
            durationSteps: m.dur,
            velocity: 0.85,
          });
        });
      }
    }

    setNotes(generated);
    showToast(`Generated ${type.toUpperCase()} pattern!`);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleSave = () => {
    const updated: ArrangeRegion = {
      ...region,
      name: regionName.trim() || region.name,
      durationBeats: durationBars * 4,
      notes: [...notes],
    };
    onSaveRegion(updated);
    onClose();
  };

  const isBlackKey = (note: string) => note.includes('#') || note.includes('b');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-6xl h-[92vh] bg-[#101328] border border-[#2B335C] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header Bar */}
        <div className="p-3.5 bg-[#0C0E1E] border-b border-[#252B48] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={regionName}
                  onChange={(e) => setRegionName(e.target.value)}
                  className="font-bold text-sm text-slate-100 bg-[#161B38] border border-[#2D355A] rounded px-2 py-0.5 focus:outline-none focus:border-indigo-500"
                />
                <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded text-white ${track.color}`}>
                  {track.name} ({track.type.toUpperCase()})
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Piano Roll Note Editor • {notes.length} Active Notes • {durationBars} Bars ({totalSteps} Steps)
              </p>
            </div>
          </div>

          {/* Transport & Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Play/Stop Preview Button */}
            <button
              id="btn-pianoroll-play"
              onClick={() => {
                audioEngine.init();
                setIsPlaying(!isPlaying);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-md transition-colors ${
                isPlaying
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 animate-pulse'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isPlaying ? 'Stop Preview' : 'Loop Preview'}</span>
            </button>

            {/* Save & Apply Button */}
            <button
              id="btn-pianoroll-save"
              onClick={handleSave}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Apply Notes</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#181C38] hover:bg-[#252B48] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Floating Toast Notification */}
        {toastMsg && (
          <div className="absolute top-16 right-6 z-30 bg-indigo-900 border border-indigo-400/50 text-indigo-200 text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in">
            <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Secondary Control Ribbon (Scale, Tools, Generators, Bar Length) */}
        <div className="p-2.5 bg-[#0F1226] border-b border-[#252B48] flex items-center justify-between flex-wrap gap-2 text-xs">
          {/* Musical Scale Highlight */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Scale:
            </span>
            <select
              value={selectedRoot}
              onChange={(e) => setSelectedRoot(e.target.value)}
              className="bg-[#0B0D19] border border-[#252B48] rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            >
              {ROOTS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              value={selectedScale}
              onChange={(e) => setSelectedScale(e.target.value)}
              className="bg-[#0B0D19] border border-[#252B48] rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            >
              {Object.keys(SCALES).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Grid Snap & Note Length */}
            <div className="flex items-center gap-1.5 ml-2 border-l border-[#252B48] pl-2.5">
              <span className="text-[11px] text-slate-400">Snap:</span>
              <select
                value={snapGrid}
                onChange={(e) => setSnapGrid(parseInt(e.target.value, 10))}
                className="bg-[#0B0D19] border border-[#252B48] rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              >
                <option value={1}>1/16 Beat</option>
                <option value={2}>1/8 Beat</option>
                <option value={4}>1/4 Beat</option>
              </select>

              <span className="text-[11px] text-slate-400 ml-1">Length:</span>
              <select
                value={durationBars}
                onChange={(e) => setDurationBars(parseInt(e.target.value, 10))}
                className="bg-[#0B0D19] border border-[#252B48] rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              >
                <option value={1}>1 Bar (16 st)</option>
                <option value={2}>2 Bars (32 st)</option>
                <option value={4}>4 Bars (64 st)</option>
                <option value={8}>8 Bars (128 st)</option>
              </select>
            </div>
          </div>

          {/* Quick Melody / Pattern Generator Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 font-medium">Generate:</span>
            <button
              onClick={() => generatePattern('melody')}
              className="px-2.5 py-1 rounded bg-[#1A1F3B] hover:bg-[#252B48] text-indigo-300 hover:text-white border border-[#2E365E] transition-colors cursor-pointer"
              title="Generate melodic lead line"
            >
              Melody
            </button>
            <button
              onClick={() => generatePattern('chords')}
              className="px-2.5 py-1 rounded bg-[#1A1F3B] hover:bg-[#252B48] text-indigo-300 hover:text-white border border-[#2E365E] transition-colors cursor-pointer"
              title="Generate chord progression block"
            >
              Chords
            </button>
            <button
              onClick={() => generatePattern('bass')}
              className="px-2.5 py-1 rounded bg-[#1A1F3B] hover:bg-[#252B48] text-indigo-300 hover:text-white border border-[#2E365E] transition-colors cursor-pointer"
              title="Generate syncopated bassline"
            >
              Bass
            </button>
            <button
              onClick={() => generatePattern('arpeggio')}
              className="px-2.5 py-1 rounded bg-[#1A1F3B] hover:bg-[#252B48] text-indigo-300 hover:text-white border border-[#2E365E] transition-colors cursor-pointer"
              title="Generate 16th arpeggiator flow"
            >
              Arp 16th
            </button>
            <button
              onClick={() => {
                setNotes([]);
                showToast('Cleared all notes');
              }}
              className="p-1 rounded bg-[#1A1F3B] hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-[#2E365E] hover:border-rose-800 transition-colors cursor-pointer ml-1"
              title="Clear all notes"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Piano Roll Workspace (Keyboard on Left + Grid on Right) */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left Piano Keys Column */}
          <div className="w-20 sm:w-24 bg-[#090B16] border-r border-[#252B48] flex flex-col overflow-y-auto scrollbar-none shrink-0 select-none z-10">
            {ALL_PIANO_NOTES.map((note) => {
              const black = isBlackKey(note);
              const inScale = isNoteInScale(note);

              return (
                <button
                  key={note}
                  onClick={() => handleAuditionKey(note)}
                  className={`h-6 text-left px-2 flex items-center justify-between border-b transition-colors cursor-pointer text-[10px] font-mono ${
                    black
                      ? 'bg-[#121526] hover:bg-[#1C213E] text-slate-400 border-[#1B2038]'
                      : 'bg-[#1C213D] hover:bg-[#293056] text-slate-200 border-[#2A3154]'
                  } ${inScale ? 'font-bold' : 'opacity-60'}`}
                >
                  <span>{note}</span>
                  {inScale && (
                    <span className="flex items-center gap-0.5 text-[9px] text-indigo-300 bg-indigo-500/20 px-1 py-0.2 rounded font-semibold border border-indigo-500/30" title="In-Scale Note">
                      ✨
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right Scrollable Grid */}
          <div ref={gridContainerRef} className="flex-1 overflow-auto bg-[#070913] relative">
            {/* Top Step/Bar Ruler */}
            <div className="sticky top-0 z-20 flex bg-[#0B0D1C] border-b border-[#252B48] h-7 min-w-max">
              {Array.from({ length: totalSteps }).map((_, stepIdx) => {
                const isBarStart = stepIdx % 16 === 0;
                const isBeat = stepIdx % 4 === 0;
                const barNum = Math.floor(stepIdx / 16) + 1;
                const beatNum = Math.floor((stepIdx % 16) / 4) + 1;

                return (
                  <div
                    key={stepIdx}
                    className={`w-7 sm:w-8 h-full flex items-center justify-center text-[9px] font-mono border-r select-none ${
                      isBarStart
                        ? 'border-indigo-500/60 bg-indigo-950/40 text-indigo-300 font-bold'
                        : isBeat
                        ? 'border-[#252B48] text-slate-400'
                        : 'border-[#171B33]/50 text-slate-600'
                    }`}
                  >
                    {isBarStart ? `${barNum}.1` : isBeat ? `.${beatNum}` : ''}
                  </div>
                );
              })}
            </div>

            {/* Real-time Playhead Vertical Line */}
            {currentStep >= 0 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] z-30 pointer-events-none"
                style={{
                  left: `${currentStep * 32 + 16}px`, // matches cell width
                }}
              />
            )}

            {/* Rows of Grid Cells */}
            <div className="min-w-max">
              {ALL_PIANO_NOTES.map((note) => {
                const black = isBlackKey(note);
                const inScale = isNoteInScale(note);

                return (
                  <div
                    key={note}
                    className={`flex h-6 border-b relative ${
                      black ? 'border-[#15192E] bg-[#0A0C18]' : 'border-[#1A1F3B] bg-[#0E1122]'
                    } ${inScale ? 'bg-indigo-950/10' : ''}`}
                  >
                    {Array.from({ length: totalSteps }).map((_, stepIdx) => {
                      const isBarStart = stepIdx % 16 === 0;
                      const isBeat = stepIdx % 4 === 0;

                      return (
                        <div
                          key={stepIdx}
                          onClick={() => handleCellClick(note, stepIdx)}
                          className={`w-7 sm:w-8 h-full border-r cursor-pointer hover:bg-indigo-500/20 transition-colors ${
                            isBarStart
                              ? 'border-indigo-500/40'
                              : isBeat
                              ? 'border-[#252B48]/80'
                              : 'border-[#15182C]/40'
                          }`}
                        />
                      );
                    })}
                  </div>
                );
              })}

              {/* Render Placed Note Blocks Overlay */}
              {notes.map((n) => {
                const noteIndex = ALL_PIANO_NOTES.indexOf(n.note);
                if (noteIndex === -1) return null;

                const top = noteIndex * 24; // 24px = h-6
                const left = n.startStep * 32; // 32px cell width
                const width = n.durationSteps * 32;

                return (
                  <div
                    key={n.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNotes(notes.filter((item) => item.id !== n.id));
                    }}
                    className="absolute h-5.5 rounded bg-indigo-500 hover:bg-indigo-400 border border-indigo-200/50 text-white shadow-md flex items-center justify-between px-1.5 cursor-pointer z-10 select-none group transition-colors text-[10px] font-mono font-bold"
                    style={{
                      top: `${top + 1}px`,
                      left: `${left + 1}px`,
                      width: `${width - 2}px`,
                    }}
                    title={`${n.note} (Step ${n.startStep + 1}, Duration: ${n.durationSteps} steps) - Click to Delete`}
                  >
                    <span className="truncate">{n.note}</span>
                    <span className="opacity-0 group-hover:opacity-100 text-[8px] transition-opacity">✕</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Helper Bar */}
        <div className="p-2.5 bg-[#0C0E1E] border-t border-[#252B48] flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              💡 <strong>Tips:</strong> Click cell to add note • Click placed note to delete • Press Space or "Loop Preview" to hear changes
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <span>BPM: {bpm}</span>
            <span>•</span>
            <span>Root: {selectedRoot}</span>
            <span>•</span>
            <span>Scale: {selectedScale}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
