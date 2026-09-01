import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyUpdate,
  registerServiceWorker,
  type WorkerRegistration,
} from './serviceWorker';

/** How often a long-lived tab re-checks for a new deploy. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

export interface ServiceWorkerUpdate {
  /** True once a new version is installed and waiting for this page to yield. */
  updateReady: boolean;
  /** Hands over to the waiting worker and reloads. Stops audio, by definition. */
  applyPendingUpdate: () => void;
  /** Leaves the waiting worker in place; it applies on the next cold start. */
  dismissUpdate: () => void;
}

/**
 * Registers the service worker and reports when a newer one is waiting.
 *
 * Deliberately does NOT apply the update itself. Taking a new worker means
 * reloading, and this app is very often making sound when that would happen —
 * so the decision is the user's, and dismissing is a real option: the waiting
 * worker stays waiting and takes over on the next cold start regardless.
 *
 * Safe to mount on the server or in a browser without service workers; it
 * simply never reports an update.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const [updateReady, setUpdateReady] = useState(false);
  const registrationRef = useRef<WorkerRegistration | null>(null);

  useEffect(() => {
    // Only the production build emits /sw.js, so registering in dev would
    // 404 — which `registerServiceWorker` swallows, but which Chrome logs to
    // the console on every page load regardless of the catch. Skipping also
    // keeps a stale precache from serving yesterday's modules over HMR.
    const container =
      import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker
        : undefined;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    registerServiceWorker(container, () => setUpdateReady(true)).then((result) => {
      if (!result) return;
      if (cancelled) {
        result.cleanup();
        return;
      }
      registrationRef.current = result.registration;
      cleanup = result.cleanup;
    });

    // A tab left open for days would otherwise never notice a deploy: the
    // browser only re-fetches the worker on navigation.
    const poll = setInterval(() => {
      void registrationRef.current?.update();
    }, UPDATE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      cleanup?.();
    };
  }, []);

  const applyPendingUpdate = useCallback(() => {
    const registration = registrationRef.current;
    if (!registration) return;
    applyUpdate(navigator.serviceWorker, registration, () => window.location.reload());
  }, []);

  const dismissUpdate = useCallback(() => setUpdateReady(false), []);

  return { updateReady, applyPendingUpdate, dismissUpdate };
}
