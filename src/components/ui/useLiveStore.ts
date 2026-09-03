import { useSyncExternalStore } from 'react';
import { useAppStore } from '../../store/store';
import type { AppStore } from '../../store/types';

/**
 * Reads the store through useSyncExternalStore with getState() served for
 * BOTH snapshots. zustand's own hook serves getInitialState() as the server
 * snapshot, so under renderToString a plain useAppStore(selector) renders
 * creation-time values and a test's setState() has no effect — see
 * .claude/rules/testing.md and BottomInputDock.tsx.
 */
export function useLiveStore<T>(selector: (state: AppStore) => T): T {
  return useSyncExternalStore(
    useAppStore.subscribe,
    () => selector(useAppStore.getState()),
    () => selector(useAppStore.getState()),
  );
}
