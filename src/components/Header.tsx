import React from "react";
import { layerForTab, LOOP_TABS, SONG_TABS, ViewMode } from "../types";
import { useAppStore } from "../store/store";
import { HEADER_GROUP } from "./ui/fieldClasses";
import { ProjectMenu } from "./project/ProjectMenu";
import { AppWordmark } from "./settings/AppWordmark";
import { VIEW_META } from "./viewMeta";
import { headerToolsOn } from "./header/headerTools";

interface TabButtonProps {
  view: ViewMode;
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
}

/**
 * One view-switch button. Deliberately NOT daisyUI's `tab` component: an
 * automation group joins this button to a transport control, and daisyUI's
 * tabs expect a `role="tablist"` holding only `role="tab"` children. This is
 * the documented join + btn + btn-active segmented-control pattern instead,
 * so every group is one `join` whose direct children all carry `join-item`.
 *
 * Icon and label come from VIEW_META, never from a local literal.
 */
export function TabButton({ view, activeTab, onSelect }: TabButtonProps) {
  const isActive = activeTab === view;
  const { icon: Icon, tabLabel } = VIEW_META[view];

  return (
    <button
      id={`tab-${view}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={tabLabel}
      onClick={() => onSelect(view)}
      // Solid primary, the segmented-control idiom PatternSegmentRow shares:
      // these four are the frame's top navigation, with no parent control
      // above them to defer to.
      className={`btn btn-sm join-item min-w-0 px-2 sm:px-2.5 xl:px-3 gap-1 xl:gap-1.5 text-xs font-bold ${
        isActive ? 'btn-active btn-primary' : 'btn-ghost'
      }`}
      title={tabLabel}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate hidden lg:inline">{tabLabel}</span>
    </button>
  );
}

/**
 * Every view, one click away: the loop layer's tabs and the song layer's as
 * two joins side by side, in MobileTabBar's order. The layer is what the tab
 * implies (`layerForTab`), exactly as on the phone — there is no layer switch.
 */
function ViewNav({ activeTab, onSelect }: { activeTab: ViewMode; onSelect: (view: ViewMode) => void }) {
  return (
    <nav aria-label="Views" className="flex items-center gap-1.5">
      {[LOOP_TABS, SONG_TABS].map((tabs) => (
        <div key={tabs[0]} className={`${HEADER_GROUP} flex items-center`}>
          {tabs.map((view) => (
            <TabButton key={view} view={view} activeTab={activeTab} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export const Header = React.memo(function Header() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <header className="navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-4 py-2 select-none sticky top-0 z-40 flex flex-nowrap items-center justify-between gap-x-3 text-sm">
      {/* Brand & navigation. The tabs sit here, not in the right cluster,
          because that cluster changes with the layer (loop picker and key on
          one, project name, follow and export on the other): tabs placed after
          it would slide sideways on every layer crossing, and a one-click nav
          is only one click if the target stays where the hand expects it. */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* The desktop frame only: the phone has its own top bar
            (`shell/MobileTopBar.tsx`). The wordmark opens the app modal; the
            chevron right after it is the project menu (R348). */}
        <div className="flex items-center">
          <AppWordmark />
          <ProjectMenu />
        </div>
        <ViewNav activeTab={activeTab} onSelect={setActiveTab} />
      </div>

      {/* The vibes first on the loop layer (where a project starts), then WHAT
          is being edited and what you do with it: the subject run (the
          loop picker on the loop layer, the project name on the song layer,
          exactly one of the two per layer), then what Arrange does with it
          while it plays and export (song layer only), then the key it is in
          (loop layer only), per `HEADER_TOOLS`' order. This
          run is what tells the two layers apart at a glance. */}
      <div className="flex items-center gap-1.5 shrink-0">
        {headerToolsOn(layerForTab(activeTab)).map(({ id, Component }) => (
          <Component key={id} />
        ))}
      </div>
    </header>
  );
});
