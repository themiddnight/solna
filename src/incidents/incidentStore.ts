import { createStore } from 'zustand/vanilla';
import { createIncidentStore, type IncidentStore } from './storage';
import type { IncidentReportV1 } from './types';

/**
 * External state for the latest incident. Deliberately not the app store: it
 * is session UI state plus one report, and must never see project state.
 */
interface IncidentState {
  current: IncidentReportV1 | null;
  open: boolean;
  storage: 'ready' | 'memory';
}

export interface IncidentStateStore {
  subscribe(listener: (state: IncidentState, previous: IncidentState) => void): () => void;
  getState(): IncidentState;
  publishIncident(report: IncidentReportV1): void;
  /** Replaces the report in place (e.g. a recovery attempt was appended) without touching `open`. */
  updateIncident(report: IncidentReportV1): void;
  hydrateLatestIncident(): Promise<void>;
  openIncident(): void;
  dismissIncident(): void;
  clearIncident(): Promise<void>;
}

export function createIncidentState(persistence: IncidentStore = createIncidentStore()): IncidentStateStore {
  const store = createStore<IncidentState>(() => ({ current: null, open: false, storage: 'ready' }));

  persistence.subscribeFailure?.(() => set({ storage: 'memory' }));

  function set(patch: Partial<IncidentState>): void {
    const state = store.getState();
    const changed = (Object.keys(patch) as (keyof IncidentState)[]).some((k) => patch[k] !== state[k]);
    if (changed) store.setState(patch);
  }

  return {
    subscribe: (listener) => store.subscribe(listener),
    getState: () => store.getState(),
    publishIncident: (report) => set({ current: report, open: true }),
    updateIncident: (report) => {
      if (store.getState().current?.id === report.id) set({ current: report });
    },
    hydrateLatestIncident: async () => {
      const latest = await persistence.load();
      // A live incident published while loading is newer than what was stored.
      if (latest !== null && store.getState().current === null) set({ current: latest, open: false });
    },
    openIncident: () => {
      if (store.getState().current !== null) set({ open: true });
    },
    dismissIncident: () => set({ open: false }),
    clearIncident: async () => {
      set({ current: null, open: false });
      await persistence.clear();
    },
  };
}

/** The one persistence slot, shared with the recorder so memory fallback and clear agree. */
export const incidentPersistence = createIncidentStore();
const incidents = createIncidentState(incidentPersistence);

export const incidentStore = { subscribe: incidents.subscribe, getState: incidents.getState };
export const { publishIncident, updateIncident, hydrateLatestIncident, openIncident, dismissIncident, clearIncident } =
  incidents;
