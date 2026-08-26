import { useEffect } from 'react';
import { Header } from './components/Header';
import { InstantVibesBar } from './components/InstantVibesBar';
import { SynthView } from './components/SynthView';
import { SequencerView } from './components/SequencerView';
import { ChordView } from './components/ChordView';
import { EffectsRackView } from './components/EffectsRackView';
import { TransportBar } from './components/TransportBar';
import { audioEngine } from './audio/engine';
import { useAppStore } from './store/store';
import { applyEngineSnapshot, useEngineSync } from './store/engineSync';
import { useTabRouting } from './routing/useTabRouting';
import { usePlayheadSync } from './components/usePlayheadSync';

export function App() {
  // One-way bridge: store state -> audioEngine singleton (replaces the
  // engine-sync useEffect blocks that used to live here).
  useEngineSync();

  // Two-way sync: URL ?tab= <-> uiSlice.activeTab (called exactly once).
  useTabRouting();

  // Shared clock -> store playhead, so every tab can show the beat position.
  usePlayheadSync();

  // UI slice
  const activeTab = useAppStore((s) => s.activeTab);

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

  return (
    <div className="h-dvh bg-canvas text-base-content flex flex-col font-sans selection:bg-primary selection:text-primary-content relative overflow-hidden">
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
    </div>
  );
}

export default App;
