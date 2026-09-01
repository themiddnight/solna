import { describe, expect, test } from 'bun:test';
import {
  applyUpdate,
  isWaitingUpdate,
  registerServiceWorker,
  SKIP_WAITING_MESSAGE,
  watchForUpdate,
  type WorkerRegistration,
} from './serviceWorker';

/**
 * A minimal EventTarget stand-in, the same shape App.test.tsx uses for
 * `registerFirstGesture`: no DOM, just enough of add/removeEventListener to
 * dispatch synchronously and to assert that listeners were cleaned up.
 */
class FakeTarget {
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  addEventListener(type: string, handler: (...args: unknown[]) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (...args: unknown[]) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  dispatch(type: string): void {
    [...(this.listeners.get(type) ?? [])].forEach((handler) => handler());
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** A worker whose `state` the test drives, as the browser would. */
class FakeWorker extends FakeTarget {
  state = 'installing';
  posted: unknown[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  reach(state: string): void {
    this.state = state;
    this.dispatch('statechange');
  }
}

class FakeRegistration extends FakeTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updateCalls = 0;

  update(): Promise<void> {
    this.updateCalls += 1;
    return Promise.resolve();
  }
}

const asRegistration = (r: FakeRegistration) => r as unknown as WorkerRegistration;

describe('isWaitingUpdate', () => {
  test('an installed worker on a controlled page is a new version', () => {
    expect(isWaitingUpdate('installed', true)).toBe(true);
  });

  test('an installed worker with no controller is the FIRST install', () => {
    // The distinction the prompt depends on: nothing on screen is stale here,
    // so asking the user to reload a page they just opened would be nonsense.
    expect(isWaitingUpdate('installed', false)).toBe(false);
  });

  test('no other lifecycle state counts, controlled or not', () => {
    for (const state of ['installing', 'activating', 'activated', 'redundant']) {
      expect(isWaitingUpdate(state, true)).toBe(false);
      expect(isWaitingUpdate(state, false)).toBe(false);
    }
  });
});

describe('watchForUpdate', () => {
  test('reports a worker that was already waiting when the page loaded', () => {
    // The update finished during a previous visit: there is no `updatefound`
    // to come, so reading `waiting` up front is the only signal.
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    let calls = 0;

    watchForUpdate(asRegistration(registration), () => true, () => calls++);

    expect(calls).toBe(1);
  });

  test('a worker waiting on an UNcontrolled page is not reported', () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    let calls = 0;

    watchForUpdate(asRegistration(registration), () => false, () => calls++);

    expect(calls).toBe(0);
  });

  test('reports an update that lands while the page is open', () => {
    const registration = new FakeRegistration();
    let calls = 0;
    watchForUpdate(asRegistration(registration), () => true, () => calls++);

    const installing = new FakeWorker();
    registration.installing = installing;
    registration.dispatch('updatefound');
    expect(calls).toBe(0); // still installing

    installing.reach('installed');
    expect(calls).toBe(1);
  });

  test('fires once per update, not once per statechange after it', () => {
    const registration = new FakeRegistration();
    let calls = 0;
    watchForUpdate(asRegistration(registration), () => true, () => calls++);

    const installing = new FakeWorker();
    registration.installing = installing;
    registration.dispatch('updatefound');
    installing.reach('installed');
    installing.reach('installed');
    installing.reach('activated');

    expect(calls).toBe(1);
    expect(installing.count('statechange')).toBe(0);
  });

  test('the returned cleanup stops it listening for further updates', () => {
    const registration = new FakeRegistration();
    let calls = 0;
    const cleanup = watchForUpdate(asRegistration(registration), () => true, () => calls++);

    cleanup();
    registration.installing = new FakeWorker();
    registration.dispatch('updatefound');

    expect(calls).toBe(0);
    expect(registration.count('updatefound')).toBe(0);
  });
});

describe('registerServiceWorker', () => {
  const containerFor = (registration: FakeRegistration, controller: unknown) => ({
    register: () => Promise.resolve(registration as unknown as ServiceWorkerRegistration),
    addEventListener: () => {},
    controller: controller as ServiceWorker | null,
  });

  test('returns the registration so the caller can apply the update later', async () => {
    const registration = new FakeRegistration();
    const result = await registerServiceWorker(
      containerFor(registration, {}) as never,
      () => {},
    );

    expect(result?.registration).toBe(asRegistration(registration));
  });

  test('a browser with no service-worker support is not an error', async () => {
    expect(await registerServiceWorker(undefined, () => {})).toBe(null);
  });

  test('a rejected registration is swallowed — the app still has to run', async () => {
    // Registration fails on insecure origins and wherever the user has blocked
    // storage; none of that should take the workstation down with it.
    const container = {
      register: () => Promise.reject(new Error('insecure origin')),
      addEventListener: () => {},
      controller: null,
    };

    expect(await registerServiceWorker(container as never, () => {})).toBe(null);
  });
});

describe('applyUpdate', () => {
  test('tells the waiting worker to take over, and reloads only once it has', () => {
    // skipWaiting is asynchronous: reloading straight after the message would
    // just serve the old assets again and leave the prompt on screen.
    const waiting = new FakeWorker();
    const container = new FakeTarget();
    let reloads = 0;

    applyUpdate(
      container as unknown as ServiceWorkerContainer,
      { waiting: waiting as unknown as ServiceWorker },
      () => reloads++,
    );

    expect(waiting.posted).toEqual([SKIP_WAITING_MESSAGE]);
    expect(reloads).toBe(0);

    container.dispatch('controllerchange');
    expect(reloads).toBe(1);
  });

  test('with nothing waiting it just reloads', () => {
    let reloads = 0;
    applyUpdate(new FakeTarget() as never, { waiting: null }, () => reloads++);
    expect(reloads).toBe(1);
  });
});
