import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProjectLoading } from './components/ProjectLoading';
import { PlaybackHost } from './components/playback/PlaybackHost';
import { DesktopShell } from './components/shell/DesktopShell';
import { MobileShell } from './components/shell/MobileShell';
import { useLayoutMode } from './components/shell/useLayoutMode';
import { IncidentDialog } from './components/ui/IncidentDialog';
import { MidiSettingsModal } from './components/ui/MidiSettingsModal';
import { ProjectNotice } from './components/project/ProjectNotice';
import { installGlobalIncidentCapture } from './incidents/globalCapture';
import { reportOperationFailure } from './incidents/operationFailure';
import { hydrateLatestIncident } from './incidents/incidentStore';
import { reportGlobalIncident, reportRenderIncident } from './store/incidentReporter';
import { audioEngine } from './audio/engine';
import { bootProject } from './store/store';
import { applyEngineSnapshot, useEngineSync } from './store/engineSync';
import { startAudioRecoveryBridge } from './store/audioRecovery';
import { useRouteSync } from './routing/useRouteSync';
import { usePlayheadSync } from './components/usePlayheadSync';
import { useInputDeck } from './components/useInputDeck';
import { useSongModeSync } from './store/songMode';
import { useFocusPanelSync } from './store/focusPanelSync';
import { useSoloNavClear } from './store/soloNav';
import { useVibeNavClear } from './store/vibeNav';
import { useReharmonizeNavClear } from './store/reharmonizeNav';
import { useServiceWorkerUpdate } from './pwa/useServiceWorkerUpdate';

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
 * `resolveInitialTheme` in `components/header/useTheme.ts` — so it is unit-testable
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

function Workspace() {
  // One-way bridge: store state -> audioEngine singleton (replaces the
  // engine-sync useEffect blocks that used to live here).
  useEngineSync();

  // Two-way sync: URL /loop|/song ?tab= & ?loopId= <-> store (called exactly once).
  useRouteSync();

  // Shared clock -> store playhead, so every tab can show the beat position.
  // The lane controllers are NOT hooks here: they live in <PlaybackHost />
  // below, whose tree position fixes their clock-listener order.
  usePlayheadSync();

  // Song-mode coordinator (store-level, mounted once). The loop live-write
  // sync-back is no longer a subscription — it rides along inside the store's
  // own set(), see store/loopSync.ts.
  useSongModeSync();
  // Track solo is a session gesture, cleared by leaving the Loop layer or by
  // changing the active loop — NOT by a Sound <-> Pattern tab change and NOT
  // by a focusTrack change. One subscription owns that rule for every writer
  // of layer/activeLoopId — see store/soloNav.ts.
  useSoloNavClear();
  // The input deck's panel follows focus (melodic keyboard vs. drum pads), so
  // a focus change never leaves the dock showing a panel that focus has
  // nothing to play on — see store/focusPanelSync.ts.
  useFocusPanelSync();
  // The vibe chip highlight means "the loop this vibe was applied to is in
  // focus", so it clears on any activeLoopId change, whoever the writer —
  // see store/vibeNav.ts.
  useVibeNavClear();
  // The reharmonized badge describes the active loop's chords; it clears on
  // a loop change or project install — see store/reharmonizeNav.ts.
  useReharmonizeNavClear();

  // Desktop or mobile frame, by viewport width only (R315). Everything above
  // and every element outside the shell below survives a switch (R316).
  const mode = useLayoutMode();
  const Shell = mode === 'desktop' ? DesktopShell : MobileShell;

  // Global input: owns the QWERTY listeners + note playing, feeds the dock.
  // Given the mode because a switch remounts the on-screen keyboard mid-press:
  // the deck releases every held note on a mode change (DEV-430).
  const { keyboardProps, drumProps } = useInputDeck(mode);

  // PWA: registers the worker and reports a waiting version. It never applies
  // one on its own — see useServiceWorkerUpdate for why a reload is the user's
  // call in an app that is usually making sound.
  const { updateReady, applyPendingUpdate, dismissUpdate } = useServiceWorkerUpdate();

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

  // Audio health -> recovery store (stops players and offers a user-triggered
  // recovery when the realtime clock is confirmed unhealthy).
  useEffect(() => startAudioRecoveryBridge(), []);

  return (
    <div
      // The left/right display-cutout insets, once for the whole app: a phone
      // held in landscape puts the notch column over the navbar's brand and
      // the transport bar's master fader otherwise. `env()` is 0px in a normal
      // tab, so this is inert outside an installed, rotated app. The bottom
      // inset is on the transport bar itself on desktop, and on the mobile
      // tab bar on mobile (R321) — one consumer per frame, each so that
      // element's own background sits under the home indicator.
      className="h-dvh bg-canvas text-base-content flex flex-col font-sans selection:bg-primary selection:text-primary-content relative overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      {/* Every transport controller, mounted once (DEV-422, R312): a lane
          sounds because this is mounted, never because its grid is. Outside
          the shell, so a layout switch never remounts it; before it, so its
          hook order stays ahead of every page's clock listener. */}
      <PlaybackHost />

      <Shell
        keyboardProps={keyboardProps}
        drumProps={drumProps}
        updateReady={updateReady}
        onApplyUpdate={applyPendingUpdate}
        onDismissUpdate={dismissUpdate}
      />

      <IncidentDialog />

      {/* MIDI Settings Modal */}
      <MidiSettingsModal />

      {/* The one surface for a parse/export/autosave failure — mounted at the
          app root because the notice outlives whichever view raised it. */}
      <ProjectNotice />
    </div>
  );
}

/** Mount route, input and engine coordinators only against the loaded project. */
function ProjectBootGate() {
  // The project slot is read asynchronously, so the workspace is gated until
  // it settles — rendering it early would flash factory content over the real
  // project, and an edit made in that window would autosave over it.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void bootProject()
      .catch((err: unknown) => {
        // A rejected load must not be an unhandled rejection: `loadProject`
        // turns every storage failure into a typed result, so reaching here
        // means something threw outright — the store keeps its factory
        // content and the workspace is still revealed below.
        console.error('[boot] project load failed; continuing with factory content', err);
        reportOperationFailure('boot', err, 'degraded');
      })
      .finally(() => {
        if (!cancelled) setBooted(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return booted ? <Workspace /> : <ProjectLoading />;
}

/**
 * The crash boundary wraps the workspace rather than sitting inside it: an
 * error thrown by Workspace's own render — a slice selector, a theme lookup —
 * could not be caught by a boundary that Workspace rendered itself.
 */
function App() {
  // Installed once at the root, ahead of boot, so a failure while loading the
  // project is captured too. Also restores the last stored incident (closed).
  useEffect(() => {
    void hydrateLatestIncident();
    return installGlobalIncidentCapture(window, reportGlobalIncident);
  }, []);

  return (
    <ErrorBoundary showDetails={import.meta.env.DEV === true} onIncident={reportRenderIncident}>
      <ProjectBootGate />
    </ErrorBoundary>
  );
}

export default App;
