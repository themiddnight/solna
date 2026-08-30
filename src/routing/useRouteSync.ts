import { useEffect } from 'react';
import { layerForTab } from '../types';
import { useAppStore } from '../store/store';
import { loadLoop } from '../store/loadLoop';
import { buildRouteUrl, resolveRoute, parseLoopId } from './tabRouting';

export function useRouteSync(): void {
  useEffect(() => {
    // Mount: URL wins — adopt tab and loopId, then normalize a bad URL.
    const { tab, loopId, needsNormalize, layer } = resolveRoute(
      window.location.pathname,
      window.location.search,
    );
    const state = useAppStore.getState();
    state.setActiveTab(tab);
    if (loopId && loopId !== state.activeLoopId) loadLoop(loopId);
    if (needsNormalize) {
      window.history.replaceState(
        window.history.state,
        '',
        buildRouteUrl(layer, tab, loopId),
      );
    }

    // Back/forward: mirror URL into the store, never push.
    const handlePopState = () => {
      const r = resolveRoute(window.location.pathname, window.location.search);
      const s = useAppStore.getState();
      s.setActiveTab(r.tab);
      if (r.loopId && r.loopId !== s.activeLoopId) loadLoop(r.loopId);
    };
    window.addEventListener('popstate', handlePopState);

    // Store-driven changes push, skipped when the URL already matches.
    const unsubTab = useAppStore.subscribe(
      (state) => state.activeTab,
      (activeTab) => {
        const current = resolveRoute(window.location.pathname, window.location.search);
        if (current.tab !== activeTab) {
          // Derive the layer from the NEW tab, not the current URL path — a
          // cross-layer switch must move the path (/loop ↔ /song), not keep it.
          window.history.pushState(
            window.history.state,
            '',
            buildRouteUrl(layerForTab(activeTab), activeTab, parseLoopId(window.location.search)),
          );
        }
      },
    );
    const unsubLoop = useAppStore.subscribe(
      (state) => state.activeLoopId,
      (activeLoopId) => {
        const current = resolveRoute(window.location.pathname, window.location.search);
        if (current.layer === 'loop' && parseLoopId(window.location.search) !== activeLoopId) {
          window.history.pushState(
            window.history.state,
            '',
            buildRouteUrl(current.layer, current.tab, activeLoopId),
          );
        }
      },
    );

    return () => {
      window.removeEventListener('popstate', handlePopState);
      unsubTab();
      unsubLoop();
    };
  }, []);
}
