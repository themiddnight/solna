import React, { useState, useCallback } from 'react';
import { Music, Play, Sparkles, Plus, Trash2, ArrowRight } from 'lucide-react';
import { ChordItem, SynthParams } from '../types';
import { audioEngine } from '../audio/engine';
import { generateBlockChordNotes } from '../../shared/src/index';

interface ChordViewProps {
  chords: ChordItem[];
  onChangeChords: (chords: ChordItem[]) => void;
  scaleRoot: string;
  onChangeScaleRoot: (root: string) => void;
  scaleType: string;
  onChangeScaleType: (type: string) => void;
  synthParams: SynthParams;
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

const CHORD_PROGRESSION_TEMPLATES: Record<string, Array<{ root: string; quality: string; bars: number }>> = {
  'Pop Anthem (I - V - vi - IV)': [
    { root: 'C', quality: 'maj', bars: 1 },
    { root: 'G', quality: 'maj', bars: 1 },
    { root: 'A', quality: 'min', bars: 1 },
    { root: 'F', quality: 'maj', bars: 1 },
  ],
  'Jazz Standard (ii - V - I - vi)': [
    { root: 'D', quality: 'min7', bars: 1 },
    { root: 'G', quality: '7', bars: 1 },
    { root: 'C', quality: 'maj7', bars: 1 },
    { root: 'A', quality: 'min7', bars: 1 },
  ],
  'Emotional Synthwave (vi - IV - I - V)': [
    { root: 'A', quality: 'min', bars: 1 },
    { root: 'F', quality: 'maj', bars: 1 },
    { root: 'C', quality: 'maj', bars: 1 },
    { root: 'G', quality: 'maj', bars: 1 },
  ],
  'Neo-Soul Modal Flow (i - iv - VII - III)': [
    { root: 'D', quality: 'min7', bars: 1 },
    { root: 'G', quality: 'min7', bars: 1 },
    { root: 'C', quality: '7', bars: 1 },
    { root: 'F', quality: 'maj7', bars: 1 },
  ],
  '12-Bar Blues Loop': [
    { root: 'C', quality: '7', bars: 2 },
    { root: 'F', quality: '7', bars: 1 },
    { root: 'C', quality: '7', bars: 1 },
    { root: 'G', quality: '7', bars: 1 },
    { root: 'F', quality: '7', bars: 1 },
  ],
};

export const ChordView: React.FC<ChordViewProps> = ({
  chords,
  onChangeChords,
  scaleRoot,
  onChangeScaleRoot,
  scaleType,
  onChangeScaleType,
  synthParams,
}) => {
  const [activeChordId, setActiveChordId] = useState<string | null>(null);

  // Calculate notes in selected scale
  const rootIdx = ROOTS.indexOf(scaleRoot);
  const intervals = SCALES[scaleType]?.intervals || [0, 2, 4, 5, 7, 9, 11];
  const scaleNotes = intervals.map((int) => ROOTS[(rootIdx + int) % 12]);

  const playChord = useCallback((chord: ChordItem) => {
    audioEngine.init();
    setActiveChordId(chord.id);

    const notes = generateBlockChordNotes(chord.quality, chord.root, 4);
    notes.forEach((n) => {
      audioEngine.triggerSynthNoteOn(n, synthParams, 0.7);
    });

    setTimeout(() => {
      notes.forEach((n) => {
        audioEngine.triggerSynthNoteOff(n, 0.5);
      });
      setActiveChordId(null);
    }, 1200);
  }, [synthParams]);

  const applyProgressionTemplate = (name: string) => {
    const template = CHORD_PROGRESSION_TEMPLATES[name];
    if (!template) return;

    const newChords: ChordItem[] = template.map((c, i) => ({
      id: `chord-${Date.now()}-${i}`,
      root: c.root,
      quality: c.quality,
      bars: c.bars,
      notes: generateBlockChordNotes(c.quality, c.root, 4),
    }));

    onChangeChords(newChords);
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

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Scale & Music Theory Header */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <Music className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Music Theory & Chord Progression Studio
            </h2>
            <p className="text-xs text-slate-400">Scale harmonization, chord voicings, and progression designer</p>
          </div>
        </div>

        {/* Root and Scale Selectors */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Root Picker */}
          <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#2D355A] px-2.5 py-1 rounded-lg">
            <span className="text-xs text-slate-400 font-mono">Key:</span>
            <select
              id="select-scale-root"
              value={scaleRoot}
              onChange={(e) => onChangeScaleRoot(e.target.value)}
              className="bg-transparent text-xs font-bold text-indigo-300 focus:outline-none cursor-pointer"
            >
              {ROOTS.map((r) => (
                <option key={r} value={r} className="bg-[#12152A]">
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Scale Type Picker */}
          <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#2D355A] px-2.5 py-1 rounded-lg">
            <span className="text-xs text-slate-400 font-mono">Scale:</span>
            <select
              id="select-scale-type"
              value={scaleType}
              onChange={(e) => onChangeScaleType(e.target.value)}
              className="bg-transparent text-xs font-bold text-indigo-300 focus:outline-none cursor-pointer"
            >
              {Object.keys(SCALES).map((s) => (
                <option key={s} value={s} className="bg-[#12152A]">
                  {SCALES[s].name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Visual Scale Degrees Strip */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 shadow-md flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Scale Notes:
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {scaleNotes.map((note, idx) => (
            <div
              key={idx}
              className={`px-3 py-1 rounded-lg font-mono text-xs font-bold border transition-all ${
                idx === 0
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-500/30'
                  : 'bg-[#0B0D19] border-[#252B48] text-slate-300'
              }`}
            >
              <span className="text-[9px] opacity-60 block font-normal text-center">
                {idx === 0 ? 'Tonic' : `deg ${idx + 1}`}
              </span>
              {note}
            </div>
          ))}
        </div>
      </div>

      {/* Progression Templates & Quick Builders */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-md space-y-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          Harmonic Progression Templates
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {Object.keys(CHORD_PROGRESSION_TEMPLATES).map((templateName) => (
            <button
              key={templateName}
              id={`btn-template-${templateName.replace(/\s+/g, '-').toLowerCase()}`}
              onClick={() => applyProgressionTemplate(templateName)}
              className="px-3 py-1.5 rounded-lg bg-[#0B0D19] hover:bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white text-xs font-medium transition-all cursor-pointer"
            >
              {templateName}
            </button>
          ))}
        </div>
      </div>

      {/* Active Progression Blocks & Playable Chord Pads */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Active Chord Progression Loop ({chords.length} Chords)
          </span>
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
            const isActive = activeChordId === chord.id;
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
                      <option value="maj">Major</option>
                      <option value="min">Minor</option>
                      <option value="maj7">Major 7th</option>
                      <option value="min7">Minor 7th</option>
                      <option value="7">Dominant 7th</option>
                      <option value="dim">Diminished</option>
                      <option value="aug">Augmented</option>
                      <option value="sus2">Sus 2</option>
                      <option value="sus4">Sus 4</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
