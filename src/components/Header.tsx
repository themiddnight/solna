import React from "react";
import {
  Sliders,
  Grid,
  FolderOpen,
  Music,
  Radio,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { ViewMode } from "../types";
import { ROOTS, SCALES } from "../utils/musicTheory";
import { useAppStore } from "../store/store";

const NAV_TABS: Array<
  | {
      view: ViewMode;
      label: string;
      icon: LucideIcon;
      playingKey?: "sequencer" | "chords";
    }
  | "divider"
> = [
  { view: "synth", label: "Synth", icon: Sliders },
  {
    view: "sequencer",
    label: "Step Matrix",
    icon: Grid,
    playingKey: "sequencer",
  },
  { view: "chords", label: "Chords", icon: Music, playingKey: "chords" },
];

const MASTER_TABS: Array<{
  view: ViewMode;
  label: string;
  icon: LucideIcon;
}> = [{ view: "effects", label: "Master FX", icon: Sliders }];

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
 * preference") if storage access throws. Safari private browsing, "block
 * all cookies" and some embedded webviews throw on the *property access*
 * itself, not just on read failure, so a bare `localStorage.getItem(...)`
 * call is unsafe. Mirrors the try/catch the index.html bootstrap script
 * already performs around the identical read.
 */
export function readStoredTheme(storage?: Pick<Storage, 'getItem'>): string | null {
  try {
    const s = storage ?? localStorage;
    return s.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Best-effort persistence: swallows a throwing `setItem` so the toggle still
 * updates the in-memory theme and the DOM attribute for the session — only
 * cross-session persistence is lost when storage is blocked.
 */
export function persistTheme(theme: SolnaTheme, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Blocked storage (private mode, cookies disabled, some webviews): the
    // session still works, it just won't remember the choice next visit.
  }
}

export const Header: React.FC = React.memo(() => {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const isSequencerPlaying = useAppStore((s) => s.isSequencerPlaying);
  const isChordsPlaying = useAppStore((s) => s.isChordsPlaying);
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
        <div className="w-7 h-7 rounded-selector bg-linear-to-tr from-primary to-secondary flex items-center justify-center shadow-md shadow-primary/20">
          <Radio className="w-3.5 h-3.5 text-primary-content" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-sm tracking-tight text-base-content">
            Solna
          </span>
          <span className="hidden sm:inline-block text-[11px] text-base-content/60 font-medium truncate max-w-30 md:max-w-40">
            · {projectTitle}
          </span>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="flex items-center gap-2">
        <div role="tablist" className="tabs tabs-box tabs-sm bg-base-200 border border-base-300 p-1 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-1 shrink-0">
          {NAV_TABS.map((tab, index) => {
            if (tab === "divider") {
              return (
                <div
                  key={`divider-${index}`}
                  className="w-px h-4 bg-base-300 mx-0.5 shrink-0 hidden sm:block"
                />
              );
            }

            const isTabPlaying =
              tab.playingKey === "sequencer"
                ? isSequencerPlaying
                : tab.playingKey === "chords"
                  ? isChordsPlaying
                  : false;

            return (
              <button
                key={tab.view}
                id={`tab-${tab.view}`}
                role="tab"
                onClick={() => setActiveTab(tab.view)}
                className={`tab gap-1.5 text-xs font-bold whitespace-nowrap relative ${
                  activeTab === tab.view ? "tab-active bg-primary text-primary-content" : ""
                }`}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                <span className="hidden md:inline">{tab.label}</span>
                {isTabPlaying && (
                  <span
                    className="flex h-1.5 w-1.5 relative ml-0.5"
                    title="Playing"
                  >
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div role="tablist" className="tabs tabs-box tabs-sm bg-base-200 border border-base-300 p-1 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-1 shrink-0">
          {MASTER_TABS.map((tab) => {
            return (
              <button
                key={tab.view}
                id={`tab-${tab.view}`}
                role="tab"
                onClick={() => setActiveTab(tab.view)}
                className={`tab gap-1.5 text-xs font-bold whitespace-nowrap relative ${
                  activeTab === tab.view ? "tab-active bg-primary text-primary-content" : ""
                }`}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            );
          })}
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

