import React from "react";
import { Layer, layerForTab, ViewMode } from "../types";
import { defaultTabForLayer, tabsForLayer } from "../routing/tabRouting";
import { useAppStore } from "../store/store";
import { HEADER_GROUP } from "./ui/fieldClasses";
import { LoopCopyButton } from "./loop/LoopCopyButton";
import { LoopSelector } from "./loop/LoopSelector";
import { ProjectMenu } from "./project/ProjectMenu";
import { ExportButton } from "./export/ExportButton";
import { VIEW_META } from "./viewMeta";
import { ProjectNameLabel } from "./header/ProjectNameLabel";
import { FollowPlayheadToggle } from "./header/FollowPlayheadToggle";
import { ScaleMenu } from "./header/ScaleMenu";
import { ThemeToggle } from "./header/ThemeToggle";

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

export const Header = React.memo(function Header() {
  const activeTab = useAppStore((s) => s.activeTab);
  const layer = layerForTab(activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  return (
    <header className="navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-2.5 sm:px-4 py-2 select-none sticky top-0 z-40 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-2 sm:gap-x-3 gap-y-2 text-sm">
      {/* Brand & Layer Switcher */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Below `sm` the wordmark text costs ~74px, which is exactly what
            pushes the loop/scale/theme group off the brand's row and gives the
            navbar a third row on a phone. The mark alone still identifies the
            app. */}
        <ProjectMenu textClassName="hidden sm:inline" />
        <LayerSwitcher layer={layer} onSelectTab={setActiveTab} />
      </div>

      {/* Subject, Key/Scale, Tabs & Theme Actions, in that order — broad to
          specific, left to right: WHAT is being edited (loop picker or project
          name), the key it is in, then WHICH view of it (Sound/Pattern or
          Arrange/Master FX) as one `join`, per the loop/song layer switcher's
          own idiom, so the whole right-hand cluster reads as one row. */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* What the tabs are editing leads the cluster, ahead of the tabs
            themselves — the loop picker on the loop layer, the project name on
            the song layer, exactly one of the two per layer. Reading the row
            left to right now says "this loop → this view of it" rather than
            the other way round, and the two layers open the same way. */}
        {layer === 'loop' && (
          <>
            <LoopCopyButton />
            <LoopSelector />
          </>
        )}
        <ProjectNameLabel layer={layer} />

        {/* Between the subject and the tabs, on the song layer only: what
            Arrange does with the scroll position while the song plays. */}
        <FollowPlayheadToggle layer={layer} />

        {/* Beside it, song layer only: the arrangement-wide export. It sits
        with the song's own controls rather than in the project menu, because
        what it writes is the arrangement — not the project file. */}
        <ExportButton layer={layer} />

        {/* The key/scale group belongs with the subject, not with the theme
            button it used to sit beside: "which loop, in which key" is one
            question, and a master-scale field parked inside the actions zone
            read as a third kind of thing. Putting it before the tabs also
            anchors THEM — the most-clicked control in the header — immediately
            left of the theme toggle on both layers, instead of jumping ~200px
            sideways whenever the layer changed and this loop-only group
            appeared or vanished. */}
        {layer === 'loop' && <ScaleMenu scaleRoot={scaleRoot} scaleType={scaleType} />}
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


        {/* Theme Toggle Button */}
        <ThemeToggle />
      </div>
    </header>
  );
});
