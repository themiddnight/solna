import React from 'react';
import type { ViewMode } from '@/types';
import { VIEW_META, VIEW_ORDER } from '@/components/viewMeta';

/**
 * The mobile frame's four tabs: every view, loop layer first — `VIEW_ORDER`,
 * the roster the desktop nav and the router already share. The tab implies
 * the layer (`layerForTab`), so the phone has no Loop/Song switch.
 */
export const MOBILE_TABS: readonly ViewMode[] = VIEW_ORDER;

interface MobileTabBarProps {
  activeTab: ViewMode;
  /** The store's `setActiveTab` — the same action the desktop tabs call; the URL follows via useRouteSync. */
  onSelect: (view: ViewMode) => void;
}

/**
 * Bottom navigation (daisyUI `dock`). `relative` puts the dock, fixed by
 * default, back in the frame's flex column; the dock's own height and padding
 * consume the bottom safe-area inset, so the transport above it does not.
 */
export const MobileTabBar = React.memo(function MobileTabBar({ activeTab, onSelect }: MobileTabBarProps) {
  return (
    <nav aria-label="Views" className="dock relative z-40 shrink-0 border-t border-base-300">
      {MOBILE_TABS.map((view) => {
        const { icon: Icon, tabLabel } = VIEW_META[view];
        const isActive = view === activeTab;
        return (
          <button
            key={view}
            id={`tab-${view}`}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'dock-active text-primary' : undefined}
            onClick={() => onSelect(view)}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="dock-label">{tabLabel}</span>
          </button>
        );
      })}
    </nav>
  );
});
