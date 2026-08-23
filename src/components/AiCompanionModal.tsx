import React, { useState } from 'react';
import { X, Sparkles, Wand2, Music, Grid, Zap, Check, Loader2 } from 'lucide-react';
import { ChordItem, SequencerTrack, SynthParams } from '../types';
import { generateBlockChordNotes, formatChordLabel } from '../utils/musicTheory';

interface AiCompanionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyChords: (chords: ChordItem[]) => void;
  onApplyDrumPattern: (pattern: Record<string, boolean[]>) => void;
  onApplySynthPreset: (preset: Partial<SynthParams>) => void;
  currentKey: string;
  currentBpm: number;
}

export const AiCompanionModal: React.FC<AiCompanionModalProps> = React.memo(({
  isOpen,
  onClose,
  onApplyChords,
  onApplyDrumPattern,
  onApplySynthPreset,
  currentKey,
  currentBpm,
}) => {
  const [activeTab, setActiveTab] = useState<'chords' | 'melody' | 'drum_groove'>('chords');
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('Lo-Fi');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [applied, setApplied] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsLoading(true);
    setApplied(false);
    setResult(null);

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeTab,
          prompt,
          genre,
          key: currentKey,
          bpm: currentBpm,
        }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error('Failed to generate with AI Companion:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (!result) return;

    if (activeTab === 'chords' && result.progression) {
      const chords: ChordItem[] = result.progression.map((c: any, i: number) => ({
        id: `ai-chord-${Date.now()}-${i}`,
        root: c.root,
        quality: c.quality,
        bars: c.bars || 1,
        notes: generateBlockChordNotes(c.quality, c.root, 4),
      }));
      onApplyChords(chords);
    } else if (activeTab === 'drum_groove' && result.pattern) {
      onApplyDrumPattern(result.pattern);
    } else if (activeTab === 'melody' && result.soundDesignPreset) {
      onApplySynthPreset(result.soundDesignPreset);
    }

    setApplied(true);
    setTimeout(() => {
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12152A] border border-[#2D355A] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900/60 via-indigo-900/60 to-[#12152A] p-4 border-b border-[#252B48] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-600/30 border border-purple-500/40 text-purple-300">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                AI Music Producer & Companion
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Gemini 2.5
                </span>
              </h3>
              <p className="text-xs text-slate-400">Generate intelligent chord voicings, rhythmic beat patterns, and sound presets</p>
            </div>
          </div>

          <button
            id="btn-close-ai-modal"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-[#252B48] bg-[#0B0D19] p-1.5 gap-1.5">
          <button
            id="tab-ai-chords"
            onClick={() => { setActiveTab('chords'); setResult(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'chords'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>Chord Progression</span>
          </button>

          <button
            id="tab-ai-melody"
            onClick={() => { setActiveTab('melody'); setResult(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'melody'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Melodic Lead Hook</span>
          </button>

          <button
            id="tab-ai-drums"
            onClick={() => { setActiveTab('drum_groove'); setResult(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'drum_groove'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>16-Step Drum Groove</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1 font-medium">Genre Style</label>
              <select
                id="select-ai-genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full bg-[#0B0D19] border border-[#2D355A] text-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:border-purple-500"
              >
                <option value="Lo-Fi">Lo-Fi / Chillhop</option>
                <option value="Synthwave">80s Synthwave / Outrun</option>
                <option value="Neo-Soul">Neo-Soul / R&B</option>
                <option value="Cyberpunk">Cyberpunk / Industrial</option>
                <option value="House">Deep House / EDM</option>
                <option value="Jazz">Modern Modal Jazz</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1 font-medium">Current Key & Tempo</label>
              <div className="bg-[#0B0D19] border border-[#2D355A] text-slate-300 text-xs rounded-lg p-2 font-mono flex items-center justify-between">
                <span>Key: {currentKey}</span>
                <span>{currentBpm} BPM</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1 font-medium">
              Creative Prompt / Vibe Description
            </label>
            <input
              id="input-ai-prompt"
              type="text"
              placeholder={
                activeTab === 'chords'
                  ? 'e.g. Dreamy melancholic progression with jazz 7th chords'
                  : activeTab === 'melody'
                  ? 'e.g. Fast syncopated arpeggiated hook with filter sweep'
                  : 'e.g. Tight bouncy 16th-note trap rhythm with ghost snares'
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-[#0B0D19] border border-[#2D355A] text-slate-100 text-xs rounded-lg p-2.5 focus:outline-none focus:border-purple-500 placeholder:text-slate-600"
            />
          </div>

          {/* Generate Button */}
          <button
            id="btn-trigger-ai-generate"
            onClick={handleGenerate}
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 text-white font-bold text-xs flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer shadow-lg shadow-purple-600/20 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating with Gemini 2.5...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                <span>Generate {activeTab === 'chords' ? 'Chords' : activeTab === 'melody' ? 'Melody' : 'Rhythm'}</span>
              </>
            )}
          </button>

          {/* Result Box */}
          {result && (
            <div className="bg-[#0B0D19] border border-purple-500/40 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
                <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {result.title || 'Generated Music Idea'}
                </span>
                <span className="text-[10px] font-mono text-slate-400">{genre}</span>
              </div>

              {result.description && (
                <p className="text-xs text-slate-300 italic">{result.description}</p>
              )}

              {/* Chords preview */}
              {result.progression && (
                <div className="flex items-center gap-2 flex-wrap">
                  {result.progression.map((c: any, i: number) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-[#181C35] border border-purple-500/30 text-center">
                      <span className="text-sm font-black text-white">{formatChordLabel(c.root, c.quality)}</span>
                      <span className="text-[9px] text-slate-400 block font-mono">{c.bars || 1} bar</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Drum Pattern preview */}
              {result.pattern && (
                <div className="text-xs text-slate-300 font-mono bg-[#12152A] p-2 rounded border border-[#252B48]">
                  Drum tracks ready: Kick, Snare, Hi-Hat, Open Hat, Clap
                </div>
              )}

              {/* Apply Button */}
              <button
                id="btn-apply-ai-result"
                onClick={handleApply}
                className={`w-full py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  applied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                }`}
              >
                {applied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Applied to Studio!</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Apply to Studio Project</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
