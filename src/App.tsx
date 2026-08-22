import React, { useEffect, useMemo } from 'react';
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
import type { ProjectState } from './types';
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
  const isAiModalOpen = useAppStore((s) => s.isAiModalOpen);
  const isProjectModalOpen = useAppStore((s) => s.isProjectModalOpen);
  const closeAiModal = useAppStore((s) => s.closeAiModal);
  const closeProjectsModal = useAppStore((s) => s.closeProjectsModal);

  // Transport slice
  const bpm = useAppStore((s) => s.bpm);

  // Music context slice
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setProjectTitle = useAppStore((s) => s.setProjectTitle);
  const applyTemplate = useAppStore((s) => s.applyTemplate);

  // Synth slice
  const applySynthPreset = useAppStore((s) => s.applySynthPreset);

  // Chords slice (ChordView reads the rest of the slice directly)
  const setChords = useAppStore((s) => s.setChords);

  // Sequencer slice
  const applyDrumPattern = useAppStore((s) => s.applyDrumPattern);

  // Initialize audio engine on first user interaction
  useEffect(() => {
    const handleFirstClick = () => {
      audioEngine.init();
      window.removeEventListener('click', handleFirstClick);
    };
    window.addEventListener('click', handleFirstClick);
    return () => window.removeEventListener('click', handleFirstClick);
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
      <Header />

      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity */}
      <main className="flex-1 min-h-0 relative overflow-y-auto">
        <div className={activeTab === 'synth' ? 'block' : 'hidden'}>
          <SynthView />
        </div>
        <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}>
          <SequencerView />
        </div>
        <div className={activeTab === 'chords' ? 'block' : 'hidden'}>
          <ChordView />
        </div>
        <div className={activeTab === 'effects' ? 'block' : 'hidden'}>
          <EffectsRackView />
        </div>
      </main>

      {/* Persistent Transport Bar at bottom */}
      <TransportBar />

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
