import { useEffect } from 'react';
import type { ViewMode } from '../types';
import { useAppStore } from '../store/store';
import { TAB_VALUES, parseTabParam, pushTabToUrl, replaceTabInUrl } from './tabRouting';

/**
 * Resolve the tab the app should start with from a search string, and whether
 * the URL needs normalizing.
 *
 * Pure function — safe to unit test. `needsNormalize` is true whenever the
 * `tab` param is missing, empty or not one of the four valid values; in that
 * case the caller should rewrite the URL with replaceState (no history entry).
 */
export function resolveInitialTab(search: string): { tab: ViewMode; needsNormalize: boolean } {
  // parseTabParam is the source of truth for tab parsing — change parsing there, not here.
  const tab = parseTabParam(search);
  const query = search.startsWith('?') ? search.slice(1) : search;
  const rawTab = new URLSearchParams(query).get('tab');
  return { tab, needsNormalize: rawTab === null || !TAB_VALUES.includes(rawTab as ViewMode) };
}

/**
 * Two-way sync between `uiSlice.activeTab` and the `?tab=` query param.
 * Called exactly once at the app root.
 *
 * - On mount the URL wins: activeTab is adopted, and a missing/invalid param
 *   is normalized via replaceState (no extra history entry).
 * - popstate (back/forward) mirrors the URL into the store without pushing —
 *   a push there would fork the history chain.
 * - Store changes push the tab to the URL, but only when the URL doesn't
 *   already carry it. That single check covers both the mount adoption and
 *   popstate-driven changes (URL and store are already in sync there, so no
 *   push happens) without needing a ref flag.
 *
 * StrictMode-safe: every step is idempotent, and the listener/subscription
 * are fully cleaned up.
 */
export function useTabRouting(): void {
  useEffect(() => {
    // Mount: adopt the URL's tab and normalize a missing/invalid param.
    const { tab, needsNormalize } = resolveInitialTab(window.location.search);
    useAppStore.getState().setActiveTab(tab);
    if (needsNormalize) {
      replaceTabInUrl(tab);
    }

    // Back/forward navigation: mirror the URL into the store, never push.
    const handlePopState = () => {
      useAppStore.getState().setActiveTab(parseTabParam(window.location.search));
    };
    window.addEventListener('popstate', handlePopState);

    // Store-driven tab switches push the URL, skipped when it already
    // matches the tab (mount adoption and popstate never push).
    const unsubscribe = useAppStore.subscribe(
      (state) => state.activeTab,
      (activeTab) => {
        if (parseTabParam(window.location.search) !== activeTab) {
          pushTabToUrl(activeTab);
        }
      }
    );

    return () => {
      window.removeEventListener('popstate', handlePopState);
      unsubscribe();
    };
  }, []);
}
