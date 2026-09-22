import React from "react";
import { Layer, layerForTab, ViewMode } from "../types";
import { defaultTabForLayer, tabsForLayer } from "../routing/tabRouting";
import { useAppStore } from "../store/store";
import { HEADER_GROUP } from "./ui/fieldClasses";
import { ProjectMenu } from "./project/ProjectMenu";
import { VIEW_META } from "./viewMeta";
import { headerToolsFor } from "./header/headerTools";

/** The two layers in toggle order. Labels are user-facing copy. */
export const LAYER_META: ReadonlyArray<{ layer: Layer; label: string }> = [
  { layer: 'loop', label: 'Loop' },
  { layer: 'song', label: 'Song' },
];

/**
 * The tab to navigate to when the user clicks the layer toggle for `target`
 * while on `current`. Returns `null` when already on `target` — clicking the
 * active layer is a no-op (it must not reset the layer's current sub-tab).
 */
export function layerToggleTarget(current: Layer, target: Layer): ViewMode | null {
  return current === target ? null : defaultTabForLayer(target);
}

interface TabButtonProps {
  view: ViewMode;
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
  labelClassName?: string;
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
export function TabButton({ view, activeTab, onSelect, labelClassName }: TabButtonProps) {
  const isActive = activeTab === view;
  const { icon: Icon, tabLabel } = VIEW_META[view];

  return (
    <button
      id={`tab-${view}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={tabLabel}
      onClick={() => onSelect(view)}
      /* `btn-soft`, where the LAYER switch beside it is solid: this group is
         the SUBSET of the layer the user has already chosen — Loop offers
         Sound and Pattern, Song offers Arrange and Master — and two identical
         solid-primary groups in one bar read as peers when one is the other's
         child. The subordinate cue is WEIGHT, not hue: a second colour would
         say "a different kind of control", which is the opposite of true
         here, and `btn-secondary` already means "selected" inside a panel
         (the Beat bus filter's LPF/BPF/HPF). Same hue, lighter fill. */
      className={`btn btn-sm join-item min-w-0 px-2 sm:px-2.5 xl:px-3 gap-1 xl:gap-1.5 text-xs font-bold ${
        isActive ? 'btn-primary btn-soft' : 'btn-ghost'
      }`}
      title={tabLabel}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className={labelClassName ?? 'truncate hidden xl:inline'}>{tabLabel}</span>
    </button>
  );
}


/** The Loop/Song toggle; clicking the layer already shown is a no-op. */
function LayerSwitcher({
  layer,
  onSelectTab,
}: {
  layer: Layer;
  onSelectTab: (tab: ViewMode) => void;
}) {
  return (
    <div className={HEADER_GROUP}>
      {LAYER_META.map(({ layer: l, label }) => {
        const isActive = layer === l;
        return (
          <button
            key={l}
            id={`layer-${l}`}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              const target = layerToggleTarget(layer, l);
              if (target) onSelectTab(target);
            }}
            className={`btn btn-sm join-item text-xs font-bold ${
              isActive ? 'btn-active btn-primary' : 'btn-ghost'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** One run of Header tools: those of `group` available on `layer`, in `HEADER_TOOLS` order. */
function HeaderToolRun({ layer, group }: { layer: Layer; group: Parameters<typeof headerToolsFor>[1] }) {
  return (
    <>
      {headerToolsFor(layer, group).map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}

export const Header = React.memo(function Header() {
  const activeTab = useAppStore((s) => s.activeTab);
  const layer = layerForTab(activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <header className="navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-4 py-2 select-none sticky top-0 z-40 flex flex-nowrap items-center justify-between gap-x-3 text-sm">
      {/* Brand & Layer Switcher */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* The desktop frame only: the phone has its own top bar
            (`shell/MobileTopBar.tsx`). */}
        <ProjectMenu />
        <LayerSwitcher layer={layer} onSelectTab={setActiveTab} />
      </div>

      {/* Subject, Key/Scale, Tabs & Theme Actions, in that order — broad to
          specific, left to right: WHAT is being edited (loop picker or project
          name), the key it is in, then WHICH view of it (Sound/Pattern or
          Arrange/Master FX) as one `join`, per the loop/song layer switcher's
          own idiom, so the whole right-hand cluster reads as one row. */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* What the tabs are editing leads the cluster, ahead of the tabs
            themselves — the loop picker on the loop layer, the project name on
            the song layer, exactly one of the two per layer. Reading the row
            left to right now says "this loop → this view of it" rather than
            the other way round, and the two layers open the same way: subject,
            then what Arrange does with it while it plays (song layer only),
            then export (song layer only), then the key it is in (loop layer
            only) — all before the tabs, per `HEADER_TOOLS`' order, which then
            stay anchored beside the theme toggle on both layers. */}
        <HeaderToolRun layer={layer} group="subject" />
        {/* Primary navigation: the active layer's tabs.
            ONE branch over `tabsForLayer`, the same function the router
            validates a URL with, so the nav and the routes cannot name
            different tabs. The two layers rendered identical markup for
            everything except the song tabs' `labelClassName`, and keeping
            them apart meant restyling a tab button in two places. */}
        <nav className={`${HEADER_GROUP} flex items-center`}>
          {tabsForLayer(layer).map((view) => (
            <TabButton
              key={view}
              view={view}
              activeTab={activeTab}
              onSelect={setActiveTab}
              labelClassName={layer === 'song' ? 'truncate sm:inline' : undefined}
            />
          ))}
        </nav>


        <HeaderToolRun layer={layer} group="actions" />
      </div>
    </header>
  );
});
