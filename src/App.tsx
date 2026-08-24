import { useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { InstantVibesBar } from './components/InstantVibesBar';
import { SynthView } from './components/SynthView';
import { SequencerView } from './components/SequencerView';
import { ChordView } from './components/ChordView';
import { EffectsRackView } from './components/EffectsRackView';
import { TransportBar } from './components/TransportBar';
import { ProjectModal } from './components/ProjectModal';
import { AudioVisualizer } from './components/AudioVisualizer';
import { audioEngine } from './audio/engine';
import type { ProjectState } from './types';
import { useAppStore } from './store/store';
import { applyEngineSnapshot, useEngineSync } from './store/engineSync';
import { useTabRouting } from './routing/useTabRouting';

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

  // Two-way sync: URL ?tab= <-> uiSlice.activeTab (called exactly once).
  useTabRouting();

  // UI slice
  const activeTab = useAppStore((s) => s.activeTab);
  const isProjectModalOpen = useAppStore((s) => s.isProjectModalOpen);
  const closeProjectsModal = useAppStore((s) => s.closeProjectsModal);

  // Music context slice
  const setProjectTitle = useAppStore((s) => s.setProjectTitle);
  const applyTemplate = useAppStore((s) => s.applyTemplate);

  // Initialize audio engine on first user interaction
  useEffect(() => {
    const handleFirstClick = () => {
      audioEngine.init();
      // setMasterVolume / updateEffects were no-ops before the engine existed
      // (engine.ts guards on this.ctx), so re-apply the persisted audio
      // snapshot now that the engine is live.
      applyEngineSnapshot();
      window.removeEventListener('click', handleFirstClick);
    };
    window.addEventListener('click', handleFirstClick);
    return () => window.removeEventListener('click', handleFirstClick);
  }, []);

  const currentProject = useProjectState();

  return (
    <div className="h-dvh bg-base-200 text-base-content flex flex-col font-sans selection:bg-primary selection:text-primary-content relative overflow-hidden">
      {/* Real-time Atmospheric Background Frequency Wave Visualizer */}
      <div className="ambient-wash absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <AudioVisualizer
          mode="ambient-bg"
          height="100%"
          className="w-full h-full"
          colorTheme="primary"
          ambientOpacity={0.2}
        />
      </div>

      {/* Navigation Header */}
      <Header />

      {/* 1-Click Instant Vibes Quick Starter Bar */}
      <InstantVibesBar />

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
