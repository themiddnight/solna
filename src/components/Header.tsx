import React from "react";
import {
  Sun,
  Moon,
  ChevronDown,
} from "lucide-react";
import { ViewMode } from "../types";
import { ROOTS, SCALES } from "../utils/musicTheory";
import { readGuardedStorageValue, persistGuardedStorageValue } from "../utils/storage";
import { useAppStore } from "../store/store";
import type { PlayerModule } from "../store/types";
import { PlayerTransport } from "./ui/PlayerTransport";
import { Wordmark } from "./ui/Wordmark";
import { VIEW_META } from "./viewMeta";

/** The two automation players. Each gets its own play / soft-stop button. */
export const AUTOMATION_TABS: ReadonlyArray<{ view: ViewMode; module: PlayerModule }> = [
  { view: 'sequencer', module: 'sequencer' },
  { view: 'chords', module: 'chords' },
];

/** Views with nothing to play: the instrument and the master rack. */
export const SOLO_TABS: readonly ViewMode[] = ['synth', 'effects'];

/**
 * One view-switch button. Deliberately NOT daisyUI's `tab` component: an
 * automation group joins this button to a transport control, and daisyUI's
 * tabs expect a `role="tablist"` holding only `role="tab"` children. This is
 * the documented join + btn + btn-active segmented-control pattern instead,
 * so every group is one `join` whose direct children all carry `join-item`.
 *
 * Icon and label come from VIEW_META, never from a local literal.
 */
const TabButton: React.FC<{
  view: ViewMode;
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
}> = ({ view, activeTab, onSelect }) => {
  const isActive = activeTab === view;
  const { icon: Icon, tabLabel } = VIEW_META[view];
  return (
    <button
      id={`tab-${view}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onSelect(view)}
      className={`btn btn-sm join-item gap-1.5 text-xs font-bold whitespace-nowrap ${
        isActive ? 'btn-active btn-primary' : 'btn-ghost'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="hidden xl:inline">{tabLabel}</span>
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
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const play = useAppStore((s) => s.play);
  const softStop = useAppStore((s) => s.softStop);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  const [currentTheme, setCurrentTheme] = React.useState<SolnaTheme>(() =>
    resolveInitialTheme(
      document.documentElement.getAttribute("data-theme"),
      typeof window !== "undefined" &&
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
    // Side columns are `minmax(max-content, 1fr)`: equal (so the nav sits dead-
    // centre in the viewport) whenever there is room, and floored at their own
    // content width when there isn't — which degrades to an off-centre nav
    // instead of the side groups overlapping or overflowing the header.
    <header className="navbar min-h-0 bg-base-100 border-b border-base-300 px-3 py-2 flex xl:grid xl:grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center justify-between gap-2 text-sm select-none sticky top-0 z-40">
      {/* Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <Wordmark />
      </div>

      {/* Primary navigation: three join groups of view-switch buttons. It owns
          the header's only overflow scroller, so a nav too wide for the viewport
          scrolls within its own column instead of pushing the right-hand group
          off-screen (the app shell is `overflow-hidden`, so pushed-out controls
          are unreachable, not merely off-layout). */}
      <nav className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
        {/* Synth stands alone, mirroring Master FX on the right. */}
        <div className={NAV_GROUP_CLASS}>
          <TabButton view={SOLO_TABS[0]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>

        <div className='divider divider-horizontal m-0' />

        {/* The automation players: view button and transport side by side, all
            of them direct join-item children of one join. A <button> must
            never nest inside another <button>. */}
        <div className="flex items-center gap-1.5 shrink-0">
          {AUTOMATION_TABS.map((tab) => {
            const state = tab.module === 'sequencer' ? sequencerPlayer : chordsPlayer;
            return (
              <div key={tab.view} className={NAV_GROUP_CLASS}>
                <TabButton view={tab.view} activeTab={activeTab} onSelect={setActiveTab} />
                <PlayerTransport
                  id={`btn-header-play-${tab.module}`}
                  state={state}
                  // Matches TabButton's own btn-sm so the joined pair is flush.
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

        <div className='divider divider-horizontal m-0' />

        <div className={NAV_GROUP_CLASS}>
          <TabButton view={SOLO_TABS[1]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>
      </nav>

      {/* Key, Scale & Global Actions */}
      <div className="flex items-center gap-1.5 shrink-0 xl:justify-self-end">
        {/* Scale Picker Compact */}
        <div className="hidden md:flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-field">
          <ScaleSelects idPrefix="select-master-scale" />
        </div>

        {/* Below `md` the inline picker would leave the nav about 20px of room,
            so the same two selects move behind a root-note pill instead. */}
        <details className="dropdown dropdown-end md:hidden">
          <summary
            id="btn-scale-dropdown"
            className="btn btn-sm btn-ghost gap-1 text-xs font-bold list-none"
            title={`Key & Scale — ${scaleRoot} ${SCALES[scaleType]?.name ?? scaleType}`}
          >
            <span className="text-primary">{scaleRoot}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </summary>
          <div className="dropdown-content z-50 mt-1 w-56 p-2 flex flex-col gap-2 bg-base-100 border border-base-300 rounded-box shadow-xl">
            <ScaleSelects idPrefix="select-master-scale-compact" stacked />
          </div>
        </details>

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

