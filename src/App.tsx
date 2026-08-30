import { useEffect } from 'react';
import { AmbientBackdrop } from './components/ui/AmbientBackdrop';
import { Header } from './components/Header';
import { InstantVibesBar } from './components/InstantVibesBar';
import { LoopPage } from './components/loop/LoopPage';
import { SongPage } from './components/song/SongPage';
import { TransportBar } from './components/TransportBar';
import { MidiSettingsModal } from './components/ui/MidiSettingsModal';
import { audioEngine } from './audio/engine';
import { useAppStore } from './store/store';
import { applyEngineSnapshot, useEngineSync } from './store/engineSync';
import { useRouteSync } from './routing/useRouteSync';
import { usePlayheadSync } from './components/usePlayheadSync';
import { useLoopSync } from './store/loopSync';
import { useSongModeSync } from './store/songMode';
import { isSongLayer } from './types';

/** Minimal event-target shape `registerFirstGesture` needs — satisfied by
 * `window` in the app and by a fake target in tests (no DOM required). */
type GestureEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Any one of these counts as the user's "first gesture": SynthView and
 * DrumPads can both start audio purely from the keyboard, so `click` alone
 * missed those paths (see App.test.tsx for the regression this covers). */
const FIRST_GESTURE_EVENTS = ['click', 'keydown', 'pointerdown'] as const;

/**
 * Registers a one-shot handler across click / keydown / pointerdown: the
 * first of the three to fire runs `onFirstGesture` exactly once, and every
 * listener is removed at that point (whether or not a gesture ever arrives —
 * the returned cleanup function removes them all too, for React's effect
 * teardown on unmount).
 *
 * Exported as a pure, DOM-injectable helper — same pattern as
 * `resolveInitialTheme` in `components/Header.tsx` — so it is unit-testable
 * without a real DOM or testing-library.
 */
export function registerFirstGesture(
  target: GestureEventTarget,
  onFirstGesture: () => void,
): () => void {
  function cleanup() {
    FIRST_GESTURE_EVENTS.forEach((event) => target.removeEventListener(event, handleGesture));
  }
  function handleGesture() {
    cleanup();
    onFirstGesture();
  }
  FIRST_GESTURE_EVENTS.forEach((event) => target.addEventListener(event, handleGesture));
  return cleanup;
}

export function App() {
  // One-way bridge: store state -> audioEngine singleton (replaces the
  // engine-sync useEffect blocks that used to live here).
  useEngineSync();

  // Two-way sync: URL /loop|/song ?tab= & ?loopId= <-> store (called exactly once).
  useRouteSync();

  // Shared clock -> store playhead, so every tab can show the beat position.
  usePlayheadSync();

  // Loop live-write sync-back + song-mode coordinator (store-level, mounted once).
  useLoopSync();
  useSongModeSync();

  // UI slice
  const activeTab = useAppStore((s) => s.activeTab);

  // Initialize audio engine on first user interaction (click, keydown, or
  // pointerdown — SynthView's and DrumPads' keyboard shortcuts can start
  // audio before any click ever happens).
  useEffect(() => {
    return registerFirstGesture(window, () => {
      audioEngine.init();
      // setMasterVolume / updateEffects were no-ops before the engine existed
      // (engine.ts guards on this.ctx), so re-apply the persisted audio
      // snapshot now that the engine is live.
      applyEngineSnapshot();
    });
  }, []);

  return (
    <div className="h-dvh bg-canvas text-base-content flex flex-col font-sans selection:bg-primary selection:text-primary-content relative overflow-hidden">
      {/* Low-contrast analyser-driven field behind the whole workspace, so
          every tab shows continuous "audio is live" feedback. Must stay the
          first child at z-0 — see AmbientBackdrop.tsx's doc comment for why
          `fixed`/`-z-10` would paint behind the root's opaque bg-canvas. */}
      <AmbientBackdrop />

      {/* Navigation Header */}
      <Header />

      {/* 1-Click Instant Vibes Quick Starter Bar */}
      <InstantVibesBar />

      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity.
          Both layers stay mounted; the active layer gates which page is visible,
          and each page toggles its own sub-tabs (block/hidden). */}
      <main className="flex-1 min-h-0 relative overflow-y-auto">
        <div className={isSongLayer(activeTab) ? 'hidden' : 'block'}>
          <LoopPage />
        </div>
        <div className={isSongLayer(activeTab) ? 'block' : 'hidden'}>
          <SongPage />
        </div>
      </main>

      {/* Persistent Transport Bar at bottom */}
      <TransportBar />

      {/* MIDI Settings Modal */}
      <MidiSettingsModal />
    </div>
  );
}

export default App;
