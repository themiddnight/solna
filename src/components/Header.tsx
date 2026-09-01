import React from "react";
import {
  Sun,
  Moon,
  ChevronDown,
} from "lucide-react";
import { Layer, layerForTab, ViewMode } from "../types";
import { defaultTabForLayer } from "../routing/tabRouting";
import { ROOTS, SCALES } from "../utils/musicTheory";
import { readGuardedStorageValue, persistGuardedStorageValue } from "../utils/storage";
import { useAppStore } from "../store/store";
import type { PlayerModule, PlayerState } from "../store/types";
import { PlayerTransport } from "./ui/PlayerTransport";
import { Wordmark } from "./ui/Wordmark";
import { LoopSelector } from "./loop/LoopSelector";
import { VIEW_META } from "./viewMeta";

/** The three loop-layer tabs. Each gets its own play / soft-stop button. The
 *  synth page edits the synth patch but plays the lead melody, so it joins the
 *  `lead` transport. */
export const AUTOMATION_TABS: ReadonlyArray<{ view: ViewMode; module: PlayerModule }> = [
  { view: 'synth', module: 'lead' },
  { view: 'sequencer', module: 'sequencer' },
  { view: 'chords', module: 'chords' },
];

/** The two song-layer tabs: the arrangement and the global master rack. */
export const SONG_NAV_TABS: readonly ViewMode[] = ['arrange', 'effects'];

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

/**
 * One view-switch button. Deliberately NOT daisyUI's `tab` component: an
 * automation group joins this button to a transport control, and daisyUI's
 * tabs expect a `role="tablist"` holding only `role="tab"` children. This is
 * the documented join + btn + btn-active segmented-control pattern instead,
 * so every group is one `join` whose direct children all carry `join-item`.
 *
 * Icon and label come from VIEW_META, never from a local literal.
 */
export const TabButton: React.FC<{
  view: ViewMode;
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
  labelClassName?: string;
}> = ({ view, activeTab, onSelect, labelClassName }) => {
  const isActive = activeTab === view;
  const { icon: Icon, tabLabel } = VIEW_META[view];

  return (
    <button
      id={`tab-${view}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={tabLabel}
      onClick={() => onSelect(view)}
      className={`btn btn-sm join-item flex-1 sm:flex-initial min-w-0 px-2 sm:px-2.5 xl:px-3 gap-1 xl:gap-1.5 text-xs font-bold ${
        isActive ? 'btn-active btn-primary' : 'btn-ghost'
      }`}
      title={tabLabel}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className={labelClassName ?? 'truncate hidden xl:inline'}>{tabLabel}</span>
    </button>
  );
};

/**
 * The two master scale selects. They render twice — inline from `md` up, and
 * inside a dropdown below it — so each instance takes its own id prefix rather
 * than duplicating ids into the DOM (the hidden copy is still rendered).
 */
const ScaleSelects: React.FC<{ idPrefix: string; stacked?: boolean }> = ({
  idPrefix,
  stacked,
}) => {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const setScaleRoot = useAppStore((s) => s.setScaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);

  return (
    <>
      <select
        id={`${idPrefix}-root`}
        value={scaleRoot}
        onChange={(e) => setScaleRoot(e.target.value)}
        className={`select select-sm select-ghost font-bold text-primary ${
          stacked ? 'w-full' : 'max-w-14'
        }`}
        title="Root Note"
      >
        {ROOTS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select
        id={`${idPrefix}-type`}
        value={scaleType}
        onChange={(e) => setScaleType(e.target.value)}
        className={`select select-sm select-ghost font-bold text-base-content/80 ${
          stacked ? 'w-full' : 'min-w-36'
        }`}
        title="Scale Type"
      >
        {Object.keys(SCALES).map((s) => (
          <option key={s} value={s}>
            {SCALES[s].name}
          </option>
        ))}
      </select>
    </>
  );
};

/** Shared shell for every header group: the daisyUI join plus this app's chrome. */
const NAV_GROUP_CLASS =
  'join bg-base-200 border border-base-300 rounded-box p-1 shrink-0';

export type SolnaTheme = 'solna-dark' | 'solna-light';

const THEME_STORAGE_KEY = 'solna_theme';

/**
 * Pure theme resolution — no DOM, no localStorage access, unit-testable.
 * Mirrors exactly what the bootstrap <script> in index.html does, so the two
 * can never disagree.
 */
export function resolveInitialTheme(stored: string | null, prefersLight: boolean): SolnaTheme {
  if (stored === 'solna-dark' || stored === 'solna-light') return stored;
  return prefersLight ? 'solna-light' : 'solna-dark';
}

/**
 * Reads the persisted theme choice, degrading to `null` (i.e. "no stored
 * preference") if storage access throws. Mirrors the try/catch the
 * index.html bootstrap script already performs around the identical read.
 */
export function readStoredTheme(storage?: Pick<Storage, 'getItem'>): string | null {
  return readGuardedStorageValue(THEME_STORAGE_KEY, storage);
}

/**
 * Best-effort persistence: swallows a throwing `setItem` so the toggle still
 * updates the in-memory theme and the DOM attribute for the session — only
 * cross-session persistence is lost when storage is blocked.
 */
export function persistTheme(theme: SolnaTheme, storage?: Pick<Storage, 'setItem'>): void {
  persistGuardedStorageValue(THEME_STORAGE_KEY, theme, storage);
}

export const Header: React.FC = React.memo(() => {
  const activeTab = useAppStore((s) => s.activeTab);
  const layer = layerForTab(activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const leadPlayer = useAppStore((s) => s.leadPlayer);
  const play = useAppStore((s) => s.play);
  const softStop = useAppStore((s) => s.softStop);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  // Module -> player state lookup, keyed on PlayerModule so it stays three-way
  // when the lead tab (and its transport button) land in a later task. A
  // two-player ternary here would silently map a future `lead` tab to the
  // chords state.
  const playerStateByModule: Record<PlayerModule, PlayerState> = {
    sequencer: sequencerPlayer,
    chords: chordsPlayer,
    lead: leadPlayer,
  };

  const [currentTheme, setCurrentTheme] = React.useState<SolnaTheme>(() =>
    resolveInitialTheme(
      typeof document !== "undefined"
        ? document.documentElement.getAttribute("data-theme")
        : null,
      typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: light)").matches,
    ),
  );

  const toggleTheme = () => {
    const next: SolnaTheme = currentTheme === "solna-dark" ? "solna-light" : "solna-dark";
    setCurrentTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    persistTheme(next);
  };

  // The <head> bootstrap script in index.html has already resolved and applied
  // the theme before React mounted (that's what prevents the FOUC). This effect
  // only re-syncs when the DOM and React state disagree — e.g. another tab wrote
  // localStorage, or the OS preference flipped on a first visit with no stored
  // value. It never clobbers an attribute that already matches.
  React.useEffect(() => {
    const resolved = resolveInitialTheme(
      readStoredTheme(),
      window.matchMedia("(prefers-color-scheme: light)").matches,
    );
    if (document.documentElement.getAttribute("data-theme") !== resolved) {
      document.documentElement.setAttribute("data-theme", resolved);
    }
    setCurrentTheme((prev) => (prev === resolved ? prev : resolved));
  }, []);

  return (
    <header className="navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-2.5 sm:px-4 py-2 select-none sticky top-0 z-40 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-2 sm:gap-x-3 gap-y-2 text-sm">
      {/* Brand & Layer Switcher */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Below `sm` the wordmark text costs ~74px, which is exactly what
            pushes the loop/scale/theme group off the brand's row and gives the
            navbar a third row on a phone. The mark alone still identifies the
            app. */}
        <Wordmark textClassName="hidden sm:inline" />
        <div className={NAV_GROUP_CLASS}>
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
                  if (target) setActiveTab(target);
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
      </div>

      {/* Primary navigation: View tabs and module transports */}
      <nav className="flex items-center justify-center order-3 md:order-2 w-full md:w-auto shrink-0">
        {layer === 'loop' && (
          <div className="flex items-center gap-1.5 sm:gap-2">
            {AUTOMATION_TABS.map((tab) => {
              const state = playerStateByModule[tab.module];
              return (
                <div
                  key={tab.view}
                  className={`${NAV_GROUP_CLASS} flex items-center`}
                >
                  <TabButton view={tab.view} activeTab={activeTab} onSelect={setActiveTab} />
                  <PlayerTransport
                    id={`btn-header-play-${tab.module}`}
                    state={state}
                    size="sm"
                    compact
                    unwrapped
                    onPlay={() => play(tab.module)}
                    onSoftStop={() => softStop(tab.module)}
                  />
                </div>
              );
            })}
          </div>
        )}
        {layer === 'song' && (
          <div className="flex items-center gap-1.5 sm:gap-2">
            {SONG_NAV_TABS.map((view) => (
              <div
                key={view}
                className={`${NAV_GROUP_CLASS} flex items-center`}
              >
                <TabButton
                  view={view}
                  activeTab={activeTab}
                  onSelect={setActiveTab}
                  labelClassName="truncate sm:inline"
                />
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Loop Selector, Key/Scale & Theme Actions */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 order-2 md:order-3">
        {layer === 'loop' && (
          <>
            <LoopSelector />
            {/* Scale Picker Compact (Desktop >= xl) */}
            <div className="hidden xl:flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-0.5 rounded-field">
              <ScaleSelects idPrefix="select-master-scale" />
            </div>

            {/* Below `xl` (mobile and landscape/portrait tablet): Compact Scale Picker Dropdown */}
            <details className="dropdown dropdown-end xl:hidden">
              <summary
                id="btn-scale-dropdown"
                className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold list-none bg-base-200/70 border border-base-300"
                title={`Key & Scale — ${scaleRoot} ${SCALES[scaleType]?.name ?? scaleType}`}
              >
                <span className="text-primary">{scaleRoot}</span>
                {/* Dropped below 390px — the width at which brand + this group
                    stop sharing one row and the navbar grows a third one. The
                    cut is `max-[390px]` rather than `sm` so the 390px+ phones
                    that DO fit keep the scale name; narrower ones keep the root
                    note, the full name in the `title`, and both selects one tap
                    away in the dropdown. */}
                <span className="text-[10px] text-base-content/70 max-w-12 truncate max-[390px]:hidden">
                  {SCALES[scaleType]?.name?.slice(0, 4) ?? scaleType}
                </span>
                <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
              </summary>
              <div className="dropdown-content z-50 mt-1 w-56 p-2.5 flex flex-col gap-2 bg-base-100 border border-base-300 rounded-box shadow-xl">
                <div className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider px-1">
                  Master Key & Scale
                </div>
                <ScaleSelects idPrefix="select-master-scale-compact" stacked />
              </div>
            </details>
          </>
        )}

        {/* Theme Toggle Button */}
        <button
          id="btn-toggle-theme"
          onClick={toggleTheme}
          className="btn btn-sm btn-square btn-ghost"
          title={`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`}
        >
          {currentTheme === 'solna-dark' ? (
            <Sun className="w-4 h-4 text-primary" />
          ) : (
            <Moon className="w-4 h-4 text-primary" />
          )}
        </button>
      </div>
    </header>
  );
});

