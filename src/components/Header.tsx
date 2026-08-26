import React from "react";
import {
  Sliders,
  Grid,
  FolderOpen,
  Music,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { ViewMode } from "../types";
import { ROOTS, SCALES } from "../utils/musicTheory";
import { readGuardedStorageValue, persistGuardedStorageValue } from "../utils/storage";
import { useAppStore } from "../store/store";
import type { PlayerModule } from "../store/types";
import { PlayerTransport } from "./ui/PlayerTransport";
import { Wordmark } from "./ui/Wordmark";

interface NavTab {
  view: ViewMode;
  label: string;
  icon: LucideIcon;
}

/** The two automation players. Each gets its own play / soft-stop button. */
export const AUTOMATION_TABS: Array<NavTab & { module: PlayerModule }> = [
  { view: 'sequencer', label: 'Beat Step', icon: Grid, module: 'sequencer' },
  { view: 'chords', label: 'Chords', icon: Music, module: 'chords' },
];

/** Views with nothing to play: the instrument and the master rack. */
export const SOLO_TABS: NavTab[] = [
  { view: 'synth', label: 'Synth', icon: Sliders },
  { view: 'effects', label: 'Master FX', icon: Sliders },
];

/**
 * One view-switch button. Deliberately NOT daisyUI's `tab` component: an
 * automation group joins this button to a transport control, and daisyUI's
 * tabs expect a `role="tablist"` holding only `role="tab"` children. This is
 * the documented join + btn + btn-active segmented-control pattern instead,
 * so every group is one `join` whose direct children all carry `join-item`.
 */
const TabButton: React.FC<{
  tab: { view: ViewMode; label: string; icon: LucideIcon };
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
}> = ({ tab, activeTab, onSelect }) => {
  const isActive = activeTab === tab.view;
  return (
    <button
      id={`tab-${tab.view}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onSelect(tab.view)}
      className={`btn btn-sm join-item gap-1.5 text-xs font-bold whitespace-nowrap ${
        isActive ? 'btn-active btn-primary' : 'btn-ghost'
      }`}
    >
      <tab.icon className="w-4 h-4 shrink-0" />
      <span className="hidden md:inline">{tab.label}</span>
    </button>
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
  const openProjectsModal = useAppStore((s) => s.openProjectsModal);
  const projectTitle = useAppStore((s) => s.projectTitle);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const setScaleRoot = useAppStore((s) => s.setScaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);

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
    <header className="navbar min-h-0 bg-base-100 border-b border-base-300 px-3 py-2 flex items-center justify-between gap-2 text-sm select-none sticky top-0 z-40">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-2.5 shrink-0">
        <Wordmark />
        <span className="hidden sm:inline-block text-[11px] text-base-content/60 font-medium truncate max-w-30 md:max-w-40">
          · {projectTitle}
        </span>
      </div>

      {/* Primary navigation: three join groups of view-switch buttons. */}
      <nav className="flex items-center gap-2">
        {/* Synth stands alone, mirroring Master FX on the right. */}
        <div className={NAV_GROUP_CLASS}>
          <TabButton tab={SOLO_TABS[0]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>

        <div className='divider divider-horizontal m-0' />

        {/* The automation players: view button and transport side by side, all
            of them direct join-item children of one join. A <button> must
            never nest inside another <button>. */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar shrink-0">
          {AUTOMATION_TABS.map((tab) => {
            const state = tab.module === 'sequencer' ? sequencerPlayer : chordsPlayer;
            return (
              <div key={tab.view} className={NAV_GROUP_CLASS}>
                <TabButton tab={tab} activeTab={activeTab} onSelect={setActiveTab} />
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
          <TabButton tab={SOLO_TABS[1]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>
      </nav>

      {/* Key, Scale & Global Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Scale Picker Compact */}
        <div className="hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-field">
          <select
            id="select-master-scale-root"
            value={scaleRoot}
            onChange={(e) => setScaleRoot(e.target.value)}
            className="select select-sm select-ghost font-bold text-primary max-w-14"
            title="Root Note"
          >
            {ROOTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            id="select-master-scale-type"
            value={scaleType}
            onChange={(e) => setScaleType(e.target.value)}
            className="select select-sm select-ghost font-bold text-base-content/80 min-w-48"
            title="Scale Type"
          >
            {Object.keys(SCALES).map((s) => (
              <option key={s} value={s}>
                {SCALES[s].name}
              </option>
            ))}
          </select>
        </div>

        {/* Projects Action */}
        <button
          id="btn-open-projects"
          onClick={openProjectsModal}
          className="btn btn-sm btn-ghost gap-1 text-xs font-medium"
          title="Projects (Save / Export)"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Projects</span>
        </button>

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

