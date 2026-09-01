import { useEffect } from 'react';
import { AmbientBackdrop } from './components/ui/AmbientBackdrop';
import { BottomInputDock } from './components/ui/BottomInputDock';
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
import { useInputDeck } from './components/useInputDeck';
import { useSongModeSync } from './store/songMode';
import { isSongLayer } from './types';

/** Minimal event-target shape `registerFirstGesture` needs — satisfied by
 * `window` in the app and by a fake target in tests (no DOM required). */
type GestureEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Any one of these counts as the user's "first gesture": the global input
 * deck can start audio purely from the keyboard, so `click` alone would miss
 * those paths (see App.test.tsx for the regression this covers). */
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

/** The two gestures that mean "the user is back" — a pointer press or a key. */
const IDLE_WAKE_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Persistent (NOT one-shot, unlike registerFirstGesture) listeners that wake
 * an idle-suspended AudioContext.
 *
 * Wired to the gesture rather than to the note-on: resuming is asynchronous,
 * so resuming at note-on time would make the first note late. A pointer press
 * happens tens of milliseconds before it reaches a key or a pad.
 *
 * DOM-injectable so it is unit-testable without a real DOM or
 * testing-library, same pattern as registerFirstGesture.
 */
export function registerIdleWake(
  target: GestureEventTarget,
  onWake: () => void,
): () => void {
  const handle = () => onWake();
  IDLE_WAKE_EVENTS.forEach((event) => target.addEventListener(event, handle));
  return () => {
    IDLE_WAKE_EVENTS.forEach((event) => target.removeEventListener(event, handle));
  };
}

export function App() {
  // One-way bridge: store state -> audioEngine singleton (replaces the
  // engine-sync useEffect blocks that used to live here).
  useEngineSync();

  // Two-way sync: URL /loop|/song ?tab= & ?loopId= <-> store (called exactly once).
  useRouteSync();

  // Shared clock -> store playhead, so every tab can show the beat position.
  usePlayheadSync();

  // Song-mode coordinator (store-level, mounted once). The loop live-write
  // sync-back is no longer a subscription — it rides along inside the store's
  // own set(), see store/loopSync.ts.
  useSongModeSync();

  // Global input: owns the QWERTY listeners + note playing, feeds the dock.
  const { keyboardProps, drumProps } = useInputDeck();

  // UI slice
  const activeTab = useAppStore((s) => s.activeTab);

  // Initialize audio engine on first user interaction (click, keydown, or
  // pointerdown — the global input deck's keyboard can start audio before any
  // click ever happens).
  useEffect(() => {
    return registerFirstGesture(window, () => {
      audioEngine.init();
      // setMasterVolume / updateEffects were no-ops before the engine existed
      // (engine.ts guards on this.ctx), so re-apply the persisted audio
      // snapshot now that the engine is live.
      applyEngineSnapshot();
    });
  }, []);

  // Wake an idle-suspended AudioContext on the first sign the user is back.
  useEffect(() => {
    return registerIdleWake(window, () => audioEngine.wakeIfIdle());
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

      {/* 1-Click Instant Vibes Quick Starter Bar. Loop-layer only: a vibe
          rewrites the loop's chords, drums, presets and BPM, which is not an
          action the song layer offers — showing it over the arrangement
          invites a click that silently rewrites the loop being arranged. */}
      {!isSongLayer(activeTab) && <InstantVibesBar />}

      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity.
          Both layers stay mounted; the active layer gates which page is visible,
          and each page toggles its own sub-tabs (block/hidden). */}
      {/* `pb-9` reserves the strip the input dock's toggle floats over. The
          dock's header is absolutely positioned above the dock body so a
          collapsed deck costs no layout height, which also means it sits ON
          TOP of whatever the page has scrolled to its bottom edge — without
          this padding it covers the last row of chord chips or FX knobs and
          swallows their clicks. */}
      <main className="flex-1 min-h-0 relative overflow-y-auto pb-9">
        <div className={isSongLayer(activeTab) ? 'hidden' : 'block'}>
          <LoopPage />
        </div>
        <div className={isSongLayer(activeTab) ? 'block' : 'hidden'}>
          <SongPage />
        </div>
      </main>

      {/* Bottom Input Dock — Keyboard | Drums, reachable from any page */}
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />

      {/* Persistent Transport Bar at bottom */}
      <TransportBar />

      {/* MIDI Settings Modal */}
      <MidiSettingsModal />
    </div>
  );
}

export default App;
