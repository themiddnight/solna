/**
 * Service-worker registration and the update handshake.
 *
 * vite-plugin-pwa can inject all of this for us, but it injects it as a virtual
 * module (`virtual:pwa-register`) that only Vite can resolve — `bun test` could
 * not import anything downstream of it. Everything here is therefore plain DOM
 * API against injectable parameters, the same shape `registerFirstGesture` in
 * App.tsx uses, so the decision that actually matters (is this an UPDATE or a
 * first install?) is unit-testable without a browser.
 */

/** Where vite-plugin-pwa's generateSW writes the worker. */
export const SERVICE_WORKER_URL = '/sw.js';

/**
 * The message a waiting worker is told to act on. Workbox's generated worker
 * listens for exactly this string whenever `skipWaiting` is off — which it is,
 * because `registerType: 'prompt'` is what keeps a new version from reloading
 * the page (and killing the AudioContext) on its own.
 */
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

/** The slice of ServiceWorkerContainer this module needs — fakeable in tests. */
export type WorkerContainer = Pick<
  ServiceWorkerContainer,
  'register' | 'addEventListener' | 'controller'
>;

/** The slice of ServiceWorkerRegistration this module needs. */
export type WorkerRegistration = Pick<
  ServiceWorkerRegistration,
  'installing' | 'waiting' | 'addEventListener' | 'removeEventListener' | 'update'
>;

/**
 * Whether a worker reaching `state` is a NEW VERSION of an app the user is
 * already running, as opposed to the very first install.
 *
 * The distinction is the whole point of the prompt: on a first install there is
 * no controller, nothing is stale, and asking the user to reload a page they
 * just opened is nonsense. `controller` is non-null only once a worker is
 * already driving this page — which is exactly the case where the code the user
 * is looking at has been superseded.
 */
export function isWaitingUpdate(state: string, hasController: boolean): boolean {
  return state === 'installed' && hasController;
}

/**
 * Calls `onUpdateReady` once a new worker is installed and waiting behind the
 * running one.
 *
 * Both paths are needed and neither subsumes the other: `waiting` is already
 * populated when the update finished during a previous visit, while
 * `updatefound` covers one that lands while this page is open.
 *
 * Returns a cleanup function.
 */
export function watchForUpdate(
  registration: WorkerRegistration,
  hasController: () => boolean,
  onUpdateReady: () => void,
): () => void {
  if (registration.waiting && hasController()) onUpdateReady();

  const handleUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) return;
    const handleStateChange = () => {
      if (isWaitingUpdate(installing.state, hasController())) {
        installing.removeEventListener('statechange', handleStateChange);
        onUpdateReady();
      }
    };
    installing.addEventListener('statechange', handleStateChange);
  };

  registration.addEventListener('updatefound', handleUpdateFound);
  return () => registration.removeEventListener('updatefound', handleUpdateFound);
}

/**
 * Registers the worker and starts watching for updates. Resolves to the
 * registration (the caller needs it to apply the update) with its cleanup, or
 * to `null` when the browser has no service-worker support or the registration
 * is rejected — an app that cannot install a worker must still run, so every
 * failure here is swallowed rather than surfaced.
 */
export async function registerServiceWorker(
  container: WorkerContainer | undefined,
  onUpdateReady: () => void,
  url: string = SERVICE_WORKER_URL,
): Promise<{ registration: WorkerRegistration; cleanup: () => void } | null> {
  if (!container) return null;
  try {
    const registration = await container.register(url);
    const cleanup = watchForUpdate(
      registration,
      () => container.controller !== null,
      onUpdateReady,
    );
    return { registration, cleanup };
  } catch {
    return null;
  }
}

/**
 * Hands the page over to the waiting worker, then reloads once it has taken
 * control.
 *
 * The reload is driven by `controllerchange` rather than fired straight after
 * the message: skipWaiting is asynchronous, and reloading before the new worker
 * controls the page just serves the old assets again and leaves the prompt up.
 */
export function applyUpdate(
  container: Pick<ServiceWorkerContainer, 'addEventListener'>,
  registration: Pick<ServiceWorkerRegistration, 'waiting'>,
  reload: () => void,
): void {
  if (!registration.waiting) {
    reload();
    return;
  }
  container.addEventListener('controllerchange', () => reload(), { once: true });
  registration.waiting.postMessage(SKIP_WAITING_MESSAGE);
}
