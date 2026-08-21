import React, { useState } from 'react';
import {
  X,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
  Radio,
  Layers,
  Activity,
  Check,
  Disc,
  Music,
  Zap,
} from 'lucide-react';
import { ArrangeTrack, SynthParams, InstrumentType } from '../types';
import { audioEngine } from '../audio/engine';

interface TrackSynthInspectorProps {
  track: ArrangeTrack;
  onSaveTrack: (updatedTrack: ArrangeTrack) => void;
  onClose: () => void;
}

const INSTRUMENT_PRESETS: Array<{
  name: string;
  type: InstrumentType;
  params: Partial<SynthParams>;
}> = [
  {
    name: 'Cosmic Lead',
    type: 'lead',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.3,
      noiseVolume: 0.02,
      detune: 6,
      filterType: 'lowpass',
      filterCutoff: 3200,
      filterResonance: 3.5,
      filterEnvAmount: 1400,
      attack: 0.02,
      decay: 0.4,
      sustain: 0.6,
      release: 0.4,
      lfoRate: 4,
      lfoDepth: 0.15,
      lfoTarget: 'cutoff',
      octave: 0,
      preset: 'Cosmic Lead',
    },
  },
  {
    name: 'Acid 303 Bass',
    type: 'bass',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.6,
      noiseVolume: 0,
      detune: 2,
      filterType: 'lowpass',
      filterCutoff: 1200,
      filterResonance: 6.5,
      filterEnvAmount: 2800,
      attack: 0.01,
      decay: 0.25,
      sustain: 0.2,
      release: 0.15,
      lfoRate: 1,
      lfoDepth: 0,
      lfoTarget: 'cutoff',
      octave: -1,
      preset: 'Acid 303 Bass',
    },
  },
  {
    name: '808 Sub-Bass',
    type: 'bass',
    params: {
      oscType: 'sine',
      subOscVolume: 0.8,
      noiseVolume: 0,
      detune: 0,
      filterType: 'lowpass',
      filterCutoff: 650,
      filterResonance: 1.0,
      filterEnvAmount: 400,
      attack: 0.01,
      decay: 0.8,
      sustain: 0.5,
      release: 0.6,
      lfoRate: 0,
      lfoDepth: 0,
      lfoTarget: 'pitch',
      octave: -2,
      preset: '808 Sub-Bass',
    },
  },
  {
    name: 'Lush Ambient Pad',
    type: 'pad',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.4,
      noiseVolume: 0.03,
      detune: 12,
      filterType: 'lowpass',
      filterCutoff: 1800,
      filterResonance: 2.0,
      filterEnvAmount: 600,
      attack: 0.4,
      decay: 1.2,
      sustain: 0.85,
      release: 1.4,
      lfoRate: 1.5,
      lfoDepth: 0.25,
      lfoTarget: 'cutoff',
      octave: 0,
      preset: 'Lush Ambient Pad',
    },
  },
  {
    name: 'FM Electric Piano',
    type: 'piano',
    params: {
      oscType: 'sine',
      subOscVolume: 0.4,
      noiseVolume: 0.01,
      detune: 3,
      filterType: 'lowpass',
      filterCutoff: 4000,
      filterResonance: 1.5,
      filterEnvAmount: 1800,
      attack: 0.01,
      decay: 0.7,
      sustain: 0.35,
      release: 0.5,
      lfoRate: 5,
      lfoDepth: 0.1,
      lfoTarget: 'pitch',
      octave: 0,
      preset: 'FM Electric Piano',
    },
  },
  {
    name: 'Cyber Pluck / Arp',
    type: 'pluck',
    params: {
      oscType: 'square',
      subOscVolume: 0.2,
      noiseVolume: 0.02,
      detune: 4,
      filterType: 'lowpass',
      filterCutoff: 2400,
      filterResonance: 4.5,
      filterEnvAmount: 2200,
      attack: 0.005,
      decay: 0.18,
      sustain: 0.05,
      release: 0.2,
      lfoRate: 8,
      lfoDepth: 0.1,
      lfoTarget: 'cutoff',
      octave: 0,
      preset: 'Cyber Pluck / Arp',
    },
  },
  {
    name: 'Warm Analog Poly',
    type: 'synth',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.3,
      noiseVolume: 0.01,
      detune: 8,
      filterType: 'lowpass',
      filterCutoff: 2600,
      filterResonance: 2.8,
      filterEnvAmount: 900,
      attack: 0.05,
      decay: 0.5,
      sustain: 0.7,
      release: 0.6,
      lfoRate: 2.5,
      lfoDepth: 0.15,
      lfoTarget: 'cutoff',
      octave: 0,
      preset: 'Warm Analog Poly',
    },
  },
];

const AUDITION_NOTES = ['C3', 'E3', 'G3', 'B3', 'C4', 'E4', 'G4', 'C5'];

export const TrackSynthInspector: React.FC<TrackSynthInspectorProps> = ({
  track,
  onSaveTrack,
  onClose,
}) => {
  const [trackName, setTrackName] = useState<string>(track.name);
  const [trackType, setTrackType] = useState<InstrumentType>(track.type);
  const [volume, setVolume] = useState<number>(track.volume);
  const [pan, setPan] = useState<number>(track.pan || 0);

  const initialSynth: SynthParams = track.synthParams || {
    oscType: 'sawtooth',
    subOscVolume: 0.3,
    noiseVolume: 0.02,
    detune: 6,
    filterType: 'lowpass',
    filterCutoff: 2600,
    filterResonance: 3.0,
    filterEnvAmount: 1200,
    attack: 0.02,
    decay: 0.4,
    sustain: 0.6,
    release: 0.5,
    lfoRate: 3.5,
    lfoDepth: 0.2,
    lfoTarget: 'cutoff',
    octave: 0,
    preset: 'Custom Setup',
  };

  const [synth, setSynth] = useState<SynthParams>(initialSynth);

  const handleAudition = (note: string) => {
    audioEngine.init();
    if (trackType === 'drums') {
      audioEngine.triggerDrum('kick', volume);
    } else {
      audioEngine.triggerSynthNoteOn(note, synth, volume);
      setTimeout(() => {
        audioEngine.triggerSynthNoteOff(note, synth.release);
      }, 400);
    }
  };

  const handleApplyPreset = (preset: typeof INSTRUMENT_PRESETS[0]) => {
    setTrackType(preset.type);
    setSynth((prev) => ({
      ...prev,
      ...preset.params,
      preset: preset.name,
    }));
  };

  const handleSave = () => {
    const updated: ArrangeTrack = {
      ...track,
      name: trackName.trim() || track.name,
      type: trackType,
      volume,
      pan,
      synthParams: { ...synth },
    };
    onSaveTrack(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-6 animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-[#11142A] border border-[#2B335C] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 bg-[#0C0E1E] border-b border-[#252B48] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={trackName}
                  onChange={(e) => setTrackName(e.target.value)}
                  className="font-bold text-sm text-slate-100 bg-[#161B38] border border-[#2D355A] rounded px-2 py-0.5 focus:outline-none focus:border-indigo-500"
                />
                <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded text-white ${track.color}`}>
                  {trackType.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Per-Track Sound Engine, Oscillator, Filter & ADSR Envelope</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Save Sound Setup</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#181C38] hover:bg-[#252B48] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 text-slate-200 text-xs">
          {/* Preset Selector */}
          <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                INSTRUMENT SOUND PRESETS
              </span>
              <span className="text-[10px] font-mono text-indigo-300">{synth.preset}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {INSTRUMENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleApplyPreset(preset)}
                  className={`p-2 rounded-lg text-left border transition-all cursor-pointer ${
                    synth.preset === preset.name
                      ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-md'
                      : 'bg-[#121630] border-[#22284C] text-slate-400 hover:text-slate-200 hover:bg-[#181D3C]'
                  }`}
                >
                  <div className="font-bold text-xs truncate">{preset.name}</div>
                  <div className="text-[10px] opacity-75 font-mono capitalize">{preset.type}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Instrument Type & Mixer Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3 space-y-2">
              <label className="text-[11px] font-bold text-slate-300 block">Instrument Category</label>
              <select
                value={trackType}
                onChange={(e) => setTrackType(e.target.value as InstrumentType)}
                className="w-full bg-[#121630] border border-[#252B48] rounded-lg p-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="lead">🚀 Poly Lead Synth</option>
                <option value="bass">⚡ Acid / Sub-Bass</option>
                <option value="pad">🌌 Atmospheric Pad</option>
                <option value="piano">💎 FM Electric Piano</option>
                <option value="pluck">✨ Cyber Pluck</option>
                <option value="synth">🎹 Analog Poly Synth</option>
                <option value="drums">🥁 808 Drum Machine</option>
              </select>
            </div>

            <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3 space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-slate-300">Track Volume</label>
                <span className="font-mono text-indigo-400 text-[10px]">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
              />
            </div>

            <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3 space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-slate-300">Stereo Pan</label>
                <span className="font-mono text-indigo-400 text-[10px]">
                  {pan === 0 ? 'Center' : pan < 0 ? `L ${Math.round(Math.abs(pan) * 100)}%` : `R ${Math.round(pan * 100)}%`}
                </span>
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={pan}
                onChange={(e) => setPan(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
              />
            </div>
          </div>

          {/* Synth Oscillators & Waveforms */}
          <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3.5 space-y-3">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              OSCILLATOR & WAVEFORM
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['sawtooth', 'square', 'sine', 'triangle'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setSynth({ ...synth, oscType: w })}
                  className={`p-2 rounded-lg border text-center font-bold capitalize transition-colors cursor-pointer ${
                    synth.oscType === w
                      ? 'bg-indigo-600 border-indigo-400 text-white'
                      : 'bg-[#121630] border-[#22284C] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Sub-Osc Volume</span>
                  <span className="font-mono text-indigo-300">{Math.round(synth.subOscVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={synth.subOscVolume}
                  onChange={(e) => setSynth({ ...synth, subOscVolume: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Detune Cents</span>
                  <span className="font-mono text-indigo-300">+{synth.detune}ct</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={synth.detune}
                  onChange={(e) => setSynth({ ...synth, detune: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Noise Level</span>
                  <span className="font-mono text-indigo-300">{Math.round(synth.noiseVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.2}
                  step={0.01}
                  value={synth.noiseVolume}
                  onChange={(e) => setSynth({ ...synth, noiseVolume: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Filter Section */}
          <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3.5 space-y-3">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              ANALOG LADDER FILTER & RESONANCE
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Cutoff Frequency</span>
                  <span className="font-mono text-purple-300">{Math.round(synth.filterCutoff)} Hz</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={12000}
                  step={50}
                  value={synth.filterCutoff}
                  onChange={(e) => setSynth({ ...synth, filterCutoff: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-purple-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Resonance (Q)</span>
                  <span className="font-mono text-purple-300">{synth.filterResonance.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={10}
                  step={0.1}
                  value={synth.filterResonance}
                  onChange={(e) => setSynth({ ...synth, filterResonance: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-purple-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Filter Envelope Amount</span>
                  <span className="font-mono text-purple-300">+{Math.round(synth.filterEnvAmount)} Hz</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5000}
                  step={50}
                  value={synth.filterEnvAmount}
                  onChange={(e) => setSynth({ ...synth, filterEnvAmount: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-purple-500"
                />
              </div>
            </div>
          </div>

          {/* ADSR Envelope */}
          <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3.5 space-y-3">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              ADSR AMPLITUDE ENVELOPE
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Attack</span>
                  <span className="font-mono text-cyan-300">{(synth.attack * 1000).toFixed(0)} ms</span>
                </div>
                <input
                  type="range"
                  min={0.005}
                  max={1.5}
                  step={0.01}
                  value={synth.attack}
                  onChange={(e) => setSynth({ ...synth, attack: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Decay</span>
                  <span className="font-mono text-cyan-300">{(synth.decay * 1000).toFixed(0)} ms</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={2.0}
                  step={0.02}
                  value={synth.decay}
                  onChange={(e) => setSynth({ ...synth, decay: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Sustain</span>
                  <span className="font-mono text-cyan-300">{Math.round(synth.sustain * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={synth.sustain}
                  onChange={(e) => setSynth({ ...synth, sustain: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Release</span>
                  <span className="font-mono text-cyan-300">{(synth.release * 1000).toFixed(0)} ms</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={3.0}
                  step={0.05}
                  value={synth.release}
                  onChange={(e) => setSynth({ ...synth, release: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-[#252B48] rounded cursor-pointer accent-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Quick Audition Keyboard */}
          <div className="bg-[#0B0D1B] border border-[#232948] rounded-xl p-3 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 block">AUDITION SOUND KEYS</span>
            <div className="flex gap-1.5">
              {AUDITION_NOTES.map((note) => (
                <button
                  key={note}
                  onClick={() => handleAudition(note)}
                  className="flex-1 py-2 bg-[#171C3A] hover:bg-indigo-600 border border-[#2A3258] hover:border-indigo-400 text-slate-200 hover:text-white rounded-lg font-mono text-xs font-bold transition-colors cursor-pointer"
                >
                  {note}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
