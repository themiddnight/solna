import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SynthView } from './components/SynthView';
import { DrumMachineView } from './components/DrumMachineView';
import { SequencerView } from './components/SequencerView';
import { ChordView } from './components/ChordView';
import { ArrangeView } from './components/ArrangeView';
import { EffectsRackView } from './components/EffectsRackView';
import { TransportBar } from './components/TransportBar';
import { AiCompanionModal } from './components/AiCompanionModal';
import { RoomCollaborationModal } from './components/RoomCollaborationModal';
import { ProjectModal } from './components/ProjectModal';
import { audioEngine } from './audio/engine';
import {
  ViewMode,
  SynthParams,
  SequencerTrack,
  ChordItem,
  ArrangeTrack,
  MasterEffects,
  RoomUser,
  ProjectState,
} from './types';
import { generateBlockChordNotes } from '../shared/src/index';

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
  {
    id: 'track-bass',
    name: 'Synth Bass',
    instrument: 'bass',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    volume: 0.8,
    muted: false,
    color: 'bg-indigo-500',
  },
];

const INITIAL_CHORDS: ChordItem[] = [
  { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
  { id: 'chord-2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
  { id: 'chord-3', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
  { id: 'chord-4', root: 'G', quality: '7', bars: 1, notes: ['G3', 'B3', 'D4', 'F4'] },
];

const INITIAL_ARRANGE_TRACKS: ArrangeTrack[] = [
  {
    id: 'arr-synth',
    name: 'Lead Synthesizer',
    color: 'bg-indigo-600',
    type: 'synth',
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    regions: [
      { id: 'r1', name: 'Synth Theme Intro', startBeat: 0, durationBeats: 16 },
      { id: 'r2', name: 'Synth Chorus Main', startBeat: 16, durationBeats: 16 },
      { id: 'r3', name: 'Synth Outro Hook', startBeat: 32, durationBeats: 16 },
    ],
  },
  {
    id: 'arr-drums',
    name: 'Electronic Drums',
    color: 'bg-pink-600',
    type: 'drums',
    volume: 0.9,
    pan: 0,
    muted: false,
    solo: false,
    regions: [
      { id: 'r4', name: '4-on-the-Floor Beat', startBeat: 0, durationBeats: 16 },
      { id: 'r5', name: 'Full Drop Matrix', startBeat: 16, durationBeats: 16 },
      { id: 'r6', name: 'Outro Groove', startBeat: 32, durationBeats: 16 },
    ],
  },
  {
    id: 'arr-chords',
    name: 'Poly Harmonic Pad',
    color: 'bg-emerald-600',
    type: 'chords',
    volume: 0.75,
    pan: 0,
    muted: false,
    solo: false,
    regions: [
      { id: 'r7', name: 'Chords Ambient Pad', startBeat: 0, durationBeats: 32 },
      { id: 'r8', name: 'Chords Swell Climax', startBeat: 32, durationBeats: 16 },
    ],
  },
  {
    id: 'arr-bass',
    name: '808 Sub-Bass',
    color: 'bg-amber-600',
    type: 'bass',
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    regions: [
      { id: 'r9', name: 'Bass Groove A', startBeat: 16, durationBeats: 16 },
      { id: 'r10', name: 'Bass Drive B', startBeat: 32, durationBeats: 16 },
    ],
  },
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

const INITIAL_USERS: RoomUser[] = [
  { id: 'u1', name: 'You (Alex)', role: 'creator', instrument: 'synth', isHost: true },
  { id: 'u2', name: 'Maya Jam', role: 'collaborator', instrument: 'drums', isHost: false },
  { id: 'u3', name: 'Leo Beats', role: 'collaborator', instrument: 'bass', isHost: false },
];

export function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('synth');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [metronomeActive, setMetronomeActive] = useState<boolean>(false);
  const [bpm, setBpm] = useState<number>(120);
  const [scaleRoot, setScaleRoot] = useState<string>('A');
  const [scaleType, setScaleType] = useState<string>('Natural Minor');
  const [masterVolume, setMasterVolume] = useState<number>(0.85);

  // Modals
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);

  // States
  const [synthParams, setSynthParams] = useState<SynthParams>(INITIAL_SYNTH_PARAMS);
  const [sequencerTracks, setSequencerTracks] = useState<SequencerTrack[]>(INITIAL_SEQUENCER_TRACKS);
  const [chords, setChords] = useState<ChordItem[]>(INITIAL_CHORDS);
  const [arrangeTracks, setArrangeTracks] = useState<ArrangeTrack[]>(INITIAL_ARRANGE_TRACKS);
  const [effects, setEffects] = useState<MasterEffects>(INITIAL_EFFECTS);
  const [users, setUsers] = useState<RoomUser[]>(INITIAL_USERS);
  const [currentRoomId, setCurrentRoomId] = useState<string>('room-alpha-jam');
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

  const togglePlay = () => {
    audioEngine.init();
    setIsPlaying((prev) => !prev);
  };

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
    arrangeTracks,
    effects,
  };

  return (
    <div className="min-h-screen bg-[#0A0C17] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Navigation Header */}
      <Header
        currentView={activeTab}
        onSelectView={setActiveTab}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
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
        onOpenRooms={() => setIsRoomModalOpen(true)}
        onOpenProjects={() => setIsProjectModalOpen(true)}
        activeRoomName={projectTitle}
        connectedCount={users.length}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 pb-6">
        {activeTab === 'synth' && (
          <SynthView params={synthParams} onChangeParams={setSynthParams} />
        )}
        {activeTab === 'drums' && <DrumMachineView />}
        {activeTab === 'sequencer' && (
          <SequencerView
            tracks={sequencerTracks}
            onChangeTracks={setSequencerTracks}
            bpm={bpm}
            isPlaying={isPlaying}
            onTogglePlay={togglePlay}
            synthParams={synthParams}
          />
        )}
        {activeTab === 'chords' && (
          <ChordView
            chords={chords}
            onChangeChords={setChords}
            scaleRoot={scaleRoot}
            onChangeScaleRoot={setScaleRoot}
            scaleType={scaleType}
            onChangeScaleType={setScaleType}
            synthParams={synthParams}
          />
        )}
        {activeTab === 'arrange' && (
          <ArrangeView
            tracks={arrangeTracks}
            onChangeTracks={setArrangeTracks}
            bpm={bpm}
            isPlaying={isPlaying}
          />
        )}
        {activeTab === 'effects' && (
          <EffectsRackView effects={effects} onChangeEffects={setEffects} />
        )}
      </main>

      {/* Persistent Transport Bar at bottom */}
      <TransportBar
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
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

      <RoomCollaborationModal
        isOpen={isRoomModalOpen}
        onClose={() => setIsRoomModalOpen(false)}
        currentRoomId={currentRoomId}
        onJoinRoom={(id, name) => {
          setCurrentRoomId(id);
          setProjectTitle(name);
        }}
        users={users}
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
