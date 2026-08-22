import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { SynthView } from './components/SynthView';
import { SequencerView } from './components/SequencerView';
import { ChordView } from './components/ChordView';
import { EffectsRackView } from './components/EffectsRackView';
import { TransportBar } from './components/TransportBar';
import { AiCompanionModal } from './components/AiCompanionModal';
import { ProjectModal } from './components/ProjectModal';
import { AudioVisualizer } from './components/AudioVisualizer';
import { audioEngine } from './audio/engine';
import type { SynthControlTarget } from './utils/synthControl';
import { FACTORY_BASS_PRESETS } from './audio/bassPresets';
import { BASS_PATTERNS } from './audio/bassPatterns';
import {
  ViewMode,
  SynthParams,
  SequencerTrack,
  ChordItem,
  MasterEffects,
  ProjectState,
} from './types';
import { deriveChordNotes } from './utils/musicTheory';
import { DRUM_KITS } from './audio/drumKits';
import {
  INITIAL_CHORDS,
  INITIAL_EFFECTS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
} from './store/initialState';

export function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('synth');
  const [isSequencerPlaying, setIsSequencerPlaying] = useState<boolean>(false);
  const [isChordsPlaying, setIsChordsPlaying] = useState<boolean>(false);
  const [soundKit, setSoundKit] = useState<string>('Retro Drive');

  const anyPlaying = isSequencerPlaying || isChordsPlaying;

  useEffect(() => {
    audioEngine.setDrumKit(DRUM_KITS[soundKit]);
  }, [soundKit]);

  const toggleMasterPlay = useCallback(() => {
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
  }, [anyPlaying]);

  const resetClockIfStopped = useCallback(() => {
    if (!isSequencerPlaying && !isChordsPlaying) {
      audioEngine.resetClock();
    }
  }, [isSequencerPlaying, isChordsPlaying]);

  const toggleSequencerPlay = useCallback(() => {
    audioEngine.init();
    resetClockIfStopped();
    setIsSequencerPlaying((prev) => !prev);
  }, [resetClockIfStopped]);

  const toggleChordsPlay = useCallback(() => {
    audioEngine.init();
    resetClockIfStopped();
    setIsChordsPlaying((prev) => !prev);
  }, [resetClockIfStopped]);

  const isCurrentTabPlaying = 
    activeTab === 'sequencer' ? isSequencerPlaying :
    activeTab === 'chords' ? isChordsPlaying :
    false;

  const toggleCurrentTabPlay = useCallback(() => {
    if (activeTab === 'sequencer') {
      toggleSequencerPlay();
    } else if (activeTab === 'chords') {
      toggleChordsPlay();
    }
  }, [activeTab, toggleSequencerPlay, toggleChordsPlay]);

  const isPlayDisabled = !['sequencer', 'chords'].includes(activeTab);

  const [bpm, setBpm] = useState<number>(120);

  // Keep the engine's shared clock in sync with the UI bpm
  useEffect(() => {
    audioEngine.setClockBpm(bpm);
  }, [bpm]);
  const [scaleRoot, setScaleRoot] = useState<string>('A');
  const [scaleType, setScaleType] = useState<string>('Natural Minor');
  const [masterVolume, setMasterVolume] = useState<number>(0.85);

  // Modals
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);

  // States
  const [synthParams, setSynthParams] = useState<SynthParams>(INITIAL_SYNTH_PARAMS);
  // Chord mode keeps its own sound: a preset-driven param set, editable from the synth page
  const [chordSynthParams, setChordSynthParams] = useState<SynthParams>(INITIAL_SYNTH_PARAMS);
  // Which param set the synth page controls (knobs and preset selects follow
  // this; the keyboard always plays the main synth)
  const [controlTarget, setControlTarget] = useState<SynthControlTarget>('synth');
  const [chordRhythmId, setChordRhythmId] = useState<string>('sustained');
  const [chordFeel, setChordFeel] = useState<number>(0.5);
  const [chordOctave, setChordOctave] = useState<number>(4);

  // Bass module: own preset/pattern/octave plus per-layer mutes (session-local, not persisted)
  const [bassSynthParams, setBassSynthParams] = useState<SynthParams>({ ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params });
  const [bassPatternId, setBassPatternId] = useState<string>(BASS_PATTERNS[0].id);
  const [bassFeel, setBassFeel] = useState<number>(0.5);
  const [bassOctave, setBassOctave] = useState<number>(2);
  const [chordMuted, setChordMuted] = useState<boolean>(false);
  const [bassMuted, setBassMuted] = useState<boolean>(false);

  // Push param tweaks into sounding voices — one effect per source so a change
  // to one param set re-shapes only that source's voices.
  useEffect(() => {
    audioEngine.updateSynthParams(synthParams, 'synth');
  }, [synthParams]);
  useEffect(() => {
    audioEngine.updateSynthParams(chordSynthParams, 'chord');
  }, [chordSynthParams]);
  useEffect(() => {
    audioEngine.updateSynthParams(bassSynthParams, 'bass');
  }, [bassSynthParams]);

  // Per-layer mutes live on the engine's source buses: scheduling keeps running,
  // the bus gain decides audibility (instant, click-free).
  useEffect(() => {
    audioEngine.setSourceMuted('chord', chordMuted);
    audioEngine.setSourceMuted('bass', bassMuted);
  }, [chordMuted, bassMuted]);
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

  const handleMasterVolumeChange = useCallback((v: number) => {
    setMasterVolume(v);
    audioEngine.setMasterVolume(v);
  }, []);

  const openAiModal = useCallback(() => setIsAiModalOpen(true), []);
  const openProjectsModal = useCallback(() => setIsProjectModalOpen(true), []);
  const closeAiModal = useCallback(() => setIsAiModalOpen(false), []);
  const closeProjectsModal = useCallback(() => setIsProjectModalOpen(false), []);

  const toggleChordMuted = useCallback(() => setChordMuted((prev) => !prev), []);
  const toggleBassMuted = useCallback(() => setBassMuted((prev) => !prev), []);

  const handleApplyDrumPattern = useCallback((pattern: Record<string, boolean[]>) => {
    setSequencerTracks((prev) =>
      prev.map((t) => {
        if (pattern[t.instrument]) {
          return { ...t, steps: [...pattern[t.instrument]] };
        }
        return t;
      })
    );
  }, []);

  const handleApplySynthPreset = useCallback((preset: Partial<SynthParams>) => {
    setSynthParams((prev) => ({
      ...prev,
      ...preset,
    }));
  }, []);

  const handleLoadTemplate = useCallback((templateName: string) => {
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
  }, []);

  const currentProject: ProjectState = useMemo(
    () => ({
      id: 'proj-active',
      title: projectTitle,
      bpm,
      scaleRoot,
      scaleType,
      synthParams,
      sequencerTracks,
      chords,
      effects,
    }),
    [projectTitle, bpm, scaleRoot, scaleType, synthParams, sequencerTracks, chords, effects]
  );

  return (
    <div className="h-dvh bg-[#0A0C17] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white relative overflow-hidden">
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
        isSequencerPlaying={isSequencerPlaying}
        isChordsPlaying={isChordsPlaying}
        onOpenAi={openAiModal}
        onOpenProjects={openProjectsModal}
        projectTitle={projectTitle}
        scaleRoot={scaleRoot}
        onChangeScaleRoot={setScaleRoot}
        scaleType={scaleType}
        onChangeScaleType={setScaleType}
      />

      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity */}
      <main className="flex-1 min-h-0 relative overflow-y-auto">
        <div className={activeTab === 'synth' ? 'block' : 'hidden'}>
          <SynthView
            controlTarget={controlTarget}
            onChangeControlTarget={setControlTarget}
            synthParams={synthParams}
            onChangeSynthParams={setSynthParams}
            chordSynthParams={chordSynthParams}
            onChangeChordSynthParams={setChordSynthParams}
            bassSynthParams={bassSynthParams}
            onChangeBassSynthParams={setBassSynthParams}
            scaleRoot={scaleRoot}
            scaleType={scaleType}
          />
        </div>
        <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}>
          <SequencerView
            tracks={sequencerTracks}
            onChangeTracks={setSequencerTracks}
            bpm={bpm}
            isPlaying={isSequencerPlaying}
            onTogglePlay={toggleSequencerPlay}
            synthParams={synthParams}
            soundKit={soundKit}
            onChangeSoundKit={setSoundKit}
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
            rhythmId={chordRhythmId}
            onChangeRhythmId={setChordRhythmId}
            chordFeel={chordFeel}
            onChangeChordFeel={setChordFeel}
            chordOctave={chordOctave}
            onChangeChordOctave={setChordOctave}
            bpm={bpm}
            isPlaying={isChordsPlaying}
            onTogglePlay={toggleChordsPlay}
            bassSynthParams={bassSynthParams}
            onChangeBassSynthParams={setBassSynthParams}
            bassPatternId={bassPatternId}
            onChangeBassPatternId={setBassPatternId}
            bassFeel={bassFeel}
            onChangeBassFeel={setBassFeel}
            bassOctave={bassOctave}
            onChangeBassOctave={setBassOctave}
            chordMuted={chordMuted}
            onToggleChordMuted={toggleChordMuted}
            bassMuted={bassMuted}
            onToggleBassMuted={toggleBassMuted}
          />
        </div>
        <div className={activeTab === 'effects' ? 'block' : 'hidden'}>
          <EffectsRackView effects={effects} onChangeEffects={setEffects} />
        </div>
      </main>

      {/* Persistent Transport Bar at bottom */}
      <TransportBar
        currentView={activeTab}
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
        onChangeMasterVolume={handleMasterVolumeChange}
      />

      {/* Modals */}
      <AiCompanionModal
        isOpen={isAiModalOpen}
        onClose={closeAiModal}
        onApplyChords={setChords}
        onApplyDrumPattern={handleApplyDrumPattern}
        onApplySynthPreset={handleApplySynthPreset}
        currentKey={`${scaleRoot} ${scaleType}`}
        currentBpm={bpm}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={closeProjectsModal}
        project={currentProject}
        onSaveProject={setProjectTitle}
        onLoadTemplate={handleLoadTemplate}
      />
    </div>
  );
}

export default App;
