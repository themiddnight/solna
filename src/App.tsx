import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SynthView } from './components/SynthView';
import { DrumMachineView } from './components/DrumMachineView';
import { SequencerView } from './components/SequencerView';
import { ChordView } from './components/ChordView';
import { EffectsRackView } from './components/EffectsRackView';
import { TransportBar } from './components/TransportBar';
import { AiCompanionModal } from './components/AiCompanionModal';
import { ProjectModal } from './components/ProjectModal';
import { AudioVisualizer } from './components/AudioVisualizer';
import { audioEngine } from './audio/engine';
import {
  ViewMode,
  SynthParams,
  SequencerTrack,
  ChordItem,
  MasterEffects,
  ProjectState,
} from './types';
import { deriveChordNotes } from './utils/musicTheory';

const INITIAL_SYNTH_PARAMS: SynthParams = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0.02,
  detune: 6,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3.0,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0.2,
  lfoTarget: 'cutoff',
  octave: 0,
  preset: 'Cosmic Lead',
};

const INITIAL_SEQUENCER_TRACKS: SequencerTrack[] = [
  {
    id: 'track-kick',
    name: 'Kick 808',
    instrument: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    volume: 0.9,
    muted: false,
    color: 'bg-rose-500',
  },
  {
    id: 'track-snare',
    name: 'Snare Snap',
    instrument: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    volume: 0.85,
    muted: false,
    color: 'bg-amber-500',
  },
  {
    id: 'track-hihat',
    name: 'Closed Hat',
    instrument: 'hihat',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    volume: 0.75,
    muted: false,
    color: 'bg-emerald-500',
  },
  {
    id: 'track-openhat',
    name: 'Open Hat',
    instrument: 'openhat',
    steps: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
    volume: 0.8,
    muted: false,
    color: 'bg-cyan-500',
  },
  {
    id: 'track-clap',
    name: 'Hand Clap',
    instrument: 'clap',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    volume: 0.85,
    muted: false,
    color: 'bg-purple-500',
  },
];

const INITIAL_CHORDS: ChordItem[] = [
  { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
  { id: 'chord-2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
  { id: 'chord-3', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
  { id: 'chord-4', root: 'G', quality: '7', bars: 1, notes: ['G3', 'B3', 'D4', 'F4'] },
];

const INITIAL_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 2.4,
  delayWet: 0.2,
  delayTime: '8n',
  delayFeedback: 0.35,
  distortionWet: 0.1,
  eqLow: 2,
  eqMid: 0,
  eqHigh: 3,
  compressorThreshold: -16,
};

export function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('synth');
  const [isSequencerPlaying, setIsSequencerPlaying] = useState<boolean>(false);
  const [isChordsPlaying, setIsChordsPlaying] = useState<boolean>(false);

  const anyPlaying = isSequencerPlaying || isChordsPlaying;

  const toggleMasterPlay = () => {
    audioEngine.init();
    if (anyPlaying) {
      setIsSequencerPlaying(false);
      setIsChordsPlaying(false);
    } else {
      // Play All: every view starts together on the shared engine clock
      audioEngine.resetClock();
      setIsSequencerPlaying(true);
      setIsChordsPlaying(true);
    }
  };

  const resetClockIfStopped = () => {
    if (!isSequencerPlaying && !isChordsPlaying) {
      audioEngine.resetClock();
    }
  };

  const toggleSequencerPlay = () => {
    audioEngine.init();
    resetClockIfStopped();
    setIsSequencerPlaying((prev) => !prev);
  };

  const toggleChordsPlay = () => {
    audioEngine.init();
    resetClockIfStopped();
    setIsChordsPlaying((prev) => !prev);
  };

  const isCurrentTabPlaying = 
    activeTab === 'sequencer' ? isSequencerPlaying :
    activeTab === 'chords' ? isChordsPlaying :
    false;

  const toggleCurrentTabPlay = () => {
    if (activeTab === 'sequencer') {
      toggleSequencerPlay();
    } else if (activeTab === 'chords') {
      toggleChordsPlay();
    }
  };

  const isPlayDisabled = !['sequencer', 'chords'].includes(activeTab);

  const [metronomeActive, setMetronomeActive] = useState<boolean>(false);
  const [bpm, setBpm] = useState<number>(120);

  // Keep the engine's shared clock in sync with the UI bpm
  useEffect(() => {
    audioEngine.setClockBpm(bpm);
  }, [bpm]);
  const [scaleRoot, setScaleRoot] = useState<string>('A');
  const [scaleType, setScaleType] = useState<string>('Natural Minor');
  const [masterVolume, setMasterVolume] = useState<number>(0.85);
  const [masterChordVelocity, setMasterChordVelocity] = useState<number>(0.7);
  const [masterSequencerVolume, setMasterSequencerVolume] = useState<number>(0.8);

  // Modals
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);

  // States
  const [synthParams, setSynthParams] = useState<SynthParams>(INITIAL_SYNTH_PARAMS);
  // Chord mode keeps its own sound: a preset-driven param set plus a follow toggle
  const [chordSynthParams, setChordSynthParams] = useState<SynthParams>(INITIAL_SYNTH_PARAMS);
  const [followMainSynth, setFollowMainSynth] = useState<boolean>(false);
  const [chordRhythmId, setChordRhythmId] = useState<string>('sustained');
  const [chordOctave, setChordOctave] = useState<number>(4);

  // Push param tweaks into sounding voices. The main pass runs last so it wins
  // over the chord pass while follow is on; the chord pass is skipped then.
  useEffect(() => {
    if (!followMainSynth) {
      audioEngine.updateSynthParams(chordSynthParams, 'chord');
    }
    audioEngine.updateSynthParams(synthParams, followMainSynth ? undefined : 'synth');
  }, [synthParams, chordSynthParams, followMainSynth]);
  const [sequencerTracks, setSequencerTracks] = useState<SequencerTrack[]>(INITIAL_SEQUENCER_TRACKS);
  const [chords, setChords] = useState<ChordItem[]>(INITIAL_CHORDS);

  // Keep the displayed chord notes in sync with the chord octave
  useEffect(() => {
    setChords((prev) => prev.map((c) => deriveChordNotes(c, chordOctave)));
  }, [chordOctave]);
  const [effects, setEffects] = useState<MasterEffects>(INITIAL_EFFECTS);
  const [projectTitle, setProjectTitle] = useState<string>('Cosmic Horizon Jam');

  // Initialize audio engine on first user interaction
  useEffect(() => {
    const handleFirstClick = () => {
      audioEngine.init();
      window.removeEventListener('click', handleFirstClick);
    };
    window.addEventListener('click', handleFirstClick);
    return () => window.removeEventListener('click', handleFirstClick);
  }, []);

  const handleApplyDrumPattern = (pattern: Record<string, boolean[]>) => {
    setSequencerTracks((prev) =>
      prev.map((t) => {
        if (pattern[t.instrument]) {
          return { ...t, steps: [...pattern[t.instrument]] };
        }
        return t;
      })
    );
  };

  const handleApplySynthPreset = (preset: Partial<SynthParams>) => {
    setSynthParams((prev) => ({
      ...prev,
      ...preset,
    }));
  };

  const handleLoadTemplate = (templateName: string) => {
    if (templateName === 'Synthwave Odyssey') {
      setBpm(120);
      setScaleRoot('A');
      setScaleType('Natural Minor');
      setProjectTitle('Synthwave Odyssey');
    } else if (templateName === 'Lo-Fi Chill Hop') {
      setBpm(85);
      setScaleRoot('C');
      setScaleType('Major');
      setProjectTitle('Lo-Fi Chill Hop');
    } else if (templateName === 'Cyber Electro Club') {
      setBpm(128);
      setScaleRoot('D');
      setScaleType('Dorian');
      setProjectTitle('Cyber Electro Club');
    } else if (templateName === 'Funky Neo-Soul') {
      setBpm(95);
      setScaleRoot('F');
      setScaleType('Major');
      setProjectTitle('Funky Neo-Soul');
    }
  };

  const currentProject: ProjectState = {
    id: 'proj-active',
    title: projectTitle,
    bpm,
    scaleRoot,
    scaleType,
    synthParams,
    sequencerTracks,
    chords,
    effects,
  };

  return (
    <div className="min-h-screen bg-[#0A0C17] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* Real-time Atmospheric Background Frequency Wave Visualizer */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-25 overflow-hidden">
        <AudioVisualizer
          mode="ambient-bg"
          height="100%"
          className="w-full h-full"
          colorTheme="indigo"
          ambientOpacity={0.2}
        />
      </div>

      {/* Navigation Header */}
      <Header
        currentView={activeTab}
        onSelectView={setActiveTab}
        bpm={bpm}
        onChangeBpm={setBpm}
        metronomeActive={metronomeActive}
        onToggleMetronome={() => setMetronomeActive((prev) => !prev)}
        masterVolume={masterVolume}
        onChangeMasterVolume={(v) => {
          setMasterVolume(v);
          audioEngine.setMasterVolume(v);
        }}
        onOpenAi={() => setIsAiModalOpen(true)}
        onOpenProjects={() => setIsProjectModalOpen(true)}
        projectTitle={projectTitle}
        scaleRoot={scaleRoot}
        onChangeScaleRoot={setScaleRoot}
        scaleType={scaleType}
        onChangeScaleType={setScaleType}
      />

      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity */}
      <main className="flex-1 pb-0 relative">
        <div className={activeTab === 'synth' ? 'block' : 'hidden'}>
          <SynthView 
            params={synthParams} 
            onChangeParams={setSynthParams} 
            scaleRoot={scaleRoot} 
            scaleType={scaleType} 
          />
        </div>
        <div className={activeTab === 'drums' ? 'block' : 'hidden'}>
          <DrumMachineView />
        </div>
        <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}>
          <SequencerView
            tracks={sequencerTracks}
            onChangeTracks={setSequencerTracks}
            bpm={bpm}
            isPlaying={isSequencerPlaying}
            onTogglePlay={toggleSequencerPlay}
            synthParams={synthParams}
            masterSequencerVolume={masterSequencerVolume}
            onChangeMasterSequencerVolume={setMasterSequencerVolume}
          />
        </div>
        <div className={activeTab === 'chords' ? 'block' : 'hidden'}>
          <ChordView
            chords={chords}
            onChangeChords={setChords}
            scaleRoot={scaleRoot}
            onChangeScaleRoot={setScaleRoot}
            scaleType={scaleType}
            onChangeScaleType={setScaleType}
            synthParams={synthParams}
            chordSynthParams={chordSynthParams}
            onChangeChordSynthParams={setChordSynthParams}
            followMainSynth={followMainSynth}
            onToggleFollowMain={() => setFollowMainSynth((prev) => !prev)}
            rhythmId={chordRhythmId}
            onChangeRhythmId={setChordRhythmId}
            chordOctave={chordOctave}
            onChangeChordOctave={setChordOctave}
            bpm={bpm}
            isPlaying={isChordsPlaying}
            onTogglePlay={toggleChordsPlay}
            masterChordVelocity={masterChordVelocity}
            onChangeMasterChordVelocity={setMasterChordVelocity}
          />
        </div>
        <div className={activeTab === 'effects' ? 'block' : 'hidden'}>
          <EffectsRackView effects={effects} onChangeEffects={setEffects} />
        </div>
      </main>

      {/* Persistent Transport Bar at bottom */}
      <TransportBar
        isPlaying={isCurrentTabPlaying}
        onTogglePlay={toggleCurrentTabPlay}
        isPlayingAll={anyPlaying}
        onTogglePlayAll={toggleMasterPlay}
        isPlayDisabled={isPlayDisabled}
        bpm={bpm}
        onChangeBpm={setBpm}
        scaleRoot={scaleRoot}
        scaleType={scaleType}
        masterVolume={masterVolume}
        onChangeMasterVolume={setMasterVolume}
      />

      {/* Modals */}
      <AiCompanionModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onApplyChords={setChords}
        onApplyDrumPattern={handleApplyDrumPattern}
        onApplySynthPreset={handleApplySynthPreset}
        currentKey={`${scaleRoot} ${scaleType}`}
        currentBpm={bpm}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        project={currentProject}
        onSaveProject={(title) => setProjectTitle(title)}
        onLoadTemplate={handleLoadTemplate}
      />
    </div>
  );
}

export default App;
