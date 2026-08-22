import React, { useEffect, useCallback, useMemo } from 'react';
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
import type { SynthParams, SequencerTrack, ChordItem, ProjectState } from './types';
import { useAppStore } from './store/store';
import { useEngineSync } from './store/engineSync';

/**
 * The currently-open project, composed from store selectors (replaces the old
 * `currentProject` useMemo in App). The object is memoized over the same eight
 * values so the memoized ProjectModal keeps its old referential stability.
 */
function useProjectState(): ProjectState {
  const projectTitle = useAppStore((s) => s.projectTitle);
  const bpm = useAppStore((s) => s.bpm);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const synthParams = useAppStore((s) => s.synthParams);
  const sequencerTracks = useAppStore((s) => s.sequencerTracks);
  const chords = useAppStore((s) => s.chords);
  const effects = useAppStore((s) => s.effects);
  return useMemo(
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
}

export function App() {
  // One-way bridge: store state -> audioEngine singleton (replaces the
  // engine-sync useEffect blocks that used to live here).
  useEngineSync();

  // UI slice
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const isAiModalOpen = useAppStore((s) => s.isAiModalOpen);
  const isProjectModalOpen = useAppStore((s) => s.isProjectModalOpen);
  const openAiModal = useAppStore((s) => s.openAiModal);
  const closeAiModal = useAppStore((s) => s.closeAiModal);
  const openProjectsModal = useAppStore((s) => s.openProjectsModal);
  const closeProjectsModal = useAppStore((s) => s.closeProjectsModal);

  // Transport slice
  const isSequencerPlaying = useAppStore((s) => s.isSequencerPlaying);
  const isChordsPlaying = useAppStore((s) => s.isChordsPlaying);
  const bpm = useAppStore((s) => s.bpm);
  const setBpm = useAppStore((s) => s.setBpm);
  const masterVolume = useAppStore((s) => s.masterVolume);
  const setMasterVolume = useAppStore((s) => s.setMasterVolume);
  const toggleMasterPlay = useAppStore((s) => s.toggleMasterPlay);
  const toggleSequencerPlay = useAppStore((s) => s.toggleSequencerPlay);
  const toggleChordsPlay = useAppStore((s) => s.toggleChordsPlay);

  // Music context slice
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const projectTitle = useAppStore((s) => s.projectTitle);
  const applyTemplate = useAppStore((s) => s.applyTemplate);

  // Synth slice
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const controlTarget = useAppStore((s) => s.controlTarget);
  const applySynthPreset = useAppStore((s) => s.applySynthPreset);

  // Chords slice
  const chords = useAppStore((s) => s.chords);
  const chordRhythmId = useAppStore((s) => s.chordRhythmId);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const chordMuted = useAppStore((s) => s.chordMuted);
  const setChordOctave = useAppStore((s) => s.setChordOctave);

  // Bass slice
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const bassMuted = useAppStore((s) => s.bassMuted);

  // Sequencer slice
  const sequencerTracks = useAppStore((s) => s.sequencerTracks);
  const soundKit = useAppStore((s) => s.soundKit);
  const applyDrumPattern = useAppStore((s) => s.applyDrumPattern);

  // Effects slice
  const effects = useAppStore((s) => s.effects);
  const setEffects = useAppStore((s) => s.setEffects);

  const anyPlaying = isSequencerPlaying || isChordsPlaying;

  const isCurrentTabPlaying =
    activeTab === 'sequencer' ? isSequencerPlaying :
    activeTab === 'chords' ? isChordsPlaying :
    false;

  const toggleCurrentTabPlay = useCallback(() => {
    const {
      activeTab: tab,
      toggleSequencerPlay: toggleSeq,
      toggleChordsPlay: toggleChords,
    } = useAppStore.getState();
    if (tab === 'sequencer') {
      toggleSeq();
    } else if (tab === 'chords') {
      toggleChords();
    }
  }, []);

  const isPlayDisabled = !['sequencer', 'chords'].includes(activeTab);

  // Initialize audio engine on first user interaction
  useEffect(() => {
    const handleFirstClick = () => {
      audioEngine.init();
      window.removeEventListener('click', handleFirstClick);
    };
    window.addEventListener('click', handleFirstClick);
    return () => window.removeEventListener('click', handleFirstClick);
  }, []);

  // The store exposes actions only for the values listed in the task brief;
  // the remaining values have no slice setter yet (Task 3-5 refactor their
  // children), so they are written through direct setState calls — same
  // semantics as the original useState setters they replace.
  const setScaleRoot = useCallback((value: string) => useAppStore.setState({ scaleRoot: value }), []);
  const setScaleType = useCallback((value: string) => useAppStore.setState({ scaleType: value }), []);
  const setSynthParams = useCallback((value: SynthParams) => useAppStore.setState({ synthParams: value }), []);
  const setChordSynthParams = useCallback((value: SynthParams) => useAppStore.setState({ chordSynthParams: value }), []);
  const setBassSynthParams = useCallback((value: SynthParams) => useAppStore.setState({ bassSynthParams: value }), []);
  const setControlTarget = useCallback((value: SynthControlTarget) => useAppStore.setState({ controlTarget: value }), []);
  const setChordRhythmId = useCallback((value: string) => useAppStore.setState({ chordRhythmId: value }), []);
  const setChordFeel = useCallback((value: number) => useAppStore.setState({ chordFeel: value }), []);
  const setBassPatternId = useCallback((value: string) => useAppStore.setState({ bassPatternId: value }), []);
  const setBassFeel = useCallback((value: number) => useAppStore.setState({ bassFeel: value }), []);
  const setBassOctave = useCallback((value: number) => useAppStore.setState({ bassOctave: value }), []);
  const setSequencerTracks = useCallback((value: SequencerTrack[]) => useAppStore.setState({ sequencerTracks: value }), []);
  const setChords = useCallback((value: ChordItem[]) => useAppStore.setState({ chords: value }), []);
  const setProjectTitle = useCallback((value: string) => useAppStore.setState({ projectTitle: value }), []);
  const setSoundKit = useCallback((value: string) => useAppStore.setState({ soundKit: value }), []);
  const toggleChordMuted = useCallback(() => {
    useAppStore.setState((state) => ({ chordMuted: !state.chordMuted }));
  }, []);
  const toggleBassMuted = useCallback(() => {
    useAppStore.setState((state) => ({ bassMuted: !state.bassMuted }));
  }, []);

  const currentProject = useProjectState();

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
        onChangeMasterVolume={setMasterVolume}
      />

      {/* Modals */}
      <AiCompanionModal
        isOpen={isAiModalOpen}
        onClose={closeAiModal}
        onApplyChords={setChords}
        onApplyDrumPattern={applyDrumPattern}
        onApplySynthPreset={applySynthPreset}
        currentKey={`${scaleRoot} ${scaleType}`}
        currentBpm={bpm}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={closeProjectsModal}
        project={currentProject}
        onSaveProject={setProjectTitle}
        onLoadTemplate={applyTemplate}
      />
    </div>
  );
}

export default App;
