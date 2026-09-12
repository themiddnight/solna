import React from "react";
import {
  Sun,
  Moon,
  ChevronDown,
  Download,
  LocateFixed,
  LocateOff,
} from "lucide-react";
import { Layer, layerForTab, ViewMode } from "../types";
import { selectMixdownBusy, type MixdownProgress, type MixdownResult } from "@/store/mixdownSlice";
import { defaultTabForLayer, tabsForLayer } from "../routing/tabRouting";
import { SCALES } from "@/data/scales";
import { KEY_OPTIONS, formatKeyLabel, getTonicSpelling } from "@/utils/noteSpelling";
import { downloadBlob } from "@/utils/projectFileIO";
import { readGuardedStorageValue, persistGuardedStorageValue } from "../utils/storage";
import { useAppStore } from "../store/store";
import { useLiveStore } from "./ui/useLiveStore";
import { GROUP_LABEL, HEADER_FIELD_SHELL, HEADER_GROUP, HEADER_SELECT } from "./ui/fieldClasses";
import { IconButton } from "./ui/IconButton";
import { LoopCopyButton } from "./loop/LoopCopyButton";
import { LoopSelector } from "./loop/LoopSelector";
import { ProjectMenu } from "./project/ProjectMenu";
import { VIEW_META } from "./viewMeta";

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
      className={`btn btn-sm join-item min-w-0 px-2 sm:px-2.5 xl:px-3 gap-1 xl:gap-1.5 text-xs font-bold ${
        isActive ? 'btn-active btn-primary' : 'btn-ghost'
      }`}
      title={tabLabel}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className={labelClassName ?? 'truncate hidden xl:inline'}>{tabLabel}</span>
    </button>
  );
}


interface ScaleSelectsProps {
  idPrefix: string;
  stacked?: boolean;
}

/**
 * The two master scale selects. They render twice — inline from `md` up, and
 * inside a dropdown below it — so each instance takes its own id prefix rather
 * than duplicating ids into the DOM (the hidden copy is still rendered).
 */
export function ScaleSelects({
  idPrefix,
  stacked,
}: ScaleSelectsProps) {
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
        // `w-*`, never `min-w-*`: a min-width keeps the select from ever
        // shrinking, which is what makes HEADER_SELECT's ellipsis unreachable.
        // The widths are tuned against how much room the navbar has; a name
        // too long for one ellipsises and stays whole in `title`. The dropdown
        // copy is `w-full`, where there is room for all of it.
        className={`${HEADER_SELECT} text-primary ${stacked ? 'w-full' : 'w-18'}`}
        title="Root Note"
      >
        {KEY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        id={`${idPrefix}-type`}
        value={scaleType}
        onChange={(e) => setScaleType(e.target.value)}
        className={`${HEADER_SELECT} text-base-content/80 ${stacked ? 'w-full' : 'w-36'}`}
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
}

/** What an unnamed project reads as, in the header and in the menu. */
export const UNTITLED_PROJECT_LABEL = 'Untitled project';

/**
 * The one place a project's name becomes display text. `null` is the store's
 * spelling of "never named" (see projectSlice's `normalizeName`), so the
 * label is derived rather than stored — a stored label would go stale the
 * moment the name changed.
 */
export function projectDisplayName(name: string | null): string {
  return name ?? UNTITLED_PROJECT_LABEL;
}

interface ProjectNameLabelProps {
  layer: Layer;
}

/**
 * The project's name, song layer only, editable in place. Takes `layer` as a
 * prop (rather than reading `activeTab` itself) so it can be unit-tested
 * directly: under `renderToString`, `Header`'s own `activeTab` read is a plain
 * `useAppStore` selector, which serves the store's CREATION-time value and
 * never reflects a test's `setState` (see .claude/rules/testing.md) — there is
 * no way to reach the song layer through a rendered `<Header />` in a test.
 *
 * `draft` is local state, never a store value: a keystroke must not write the
 * store (each write would re-render every mounted view, and the name is
 * envelope rather than content). Commit is Enter or blur; Escape reverts.
 */
export function ProjectNameLabel({ layer }: ProjectNameLabelProps) {
  const name = useLiveStore((s) => s.projectName);
  const setProjectName = useLiveStore((s) => s.setProjectName);
  const [draft, setDraft] = React.useState<string | null>(null);
  if (layer !== 'song') return null;
  const label = projectDisplayName(name);
  const value = draft ?? name ?? '';
  const commit = () => {
    setProjectName(value);
    setDraft(null);
  };
  return (
    // Same shell and caption as the loop picker on the other layer, in the same
    // place in the row: each layer opens with what its tabs are editing — a
    // loop there, the project here.
    <div className={HEADER_FIELD_SHELL}>
      <label className={GROUP_LABEL} htmlFor="header-project-name">
        Project
      </label>
      <input
        id="header-project-name"
        type="text"
        value={value}
        placeholder={UNTITLED_PROJECT_LABEL}
        aria-label="Project name"
        title={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
        className="input input-xs w-20 sm:w-32 max-w-[10rem] text-xs font-semibold bg-transparent border-0 focus:outline-none"
      />
    </div>
  );
}

/**
 * Arrange's follow-the-playhead toggle. Song layer only — it is the same
 * `layer !== 'song'` gate `ProjectNameLabel` uses, and for the same reason it
 * sits beside it: the control belongs to what the song tabs are editing, not
 * to the tabs.
 *
 * Deliberately shown on BOTH song tabs rather than only on Arrange. It is a
 * stored preference, so setting it from Master FX is meaningful, and gating it
 * on the tab would shift the tab row sideways every time the user crossed
 * between the two — moving the buttons out from under the pointer that is
 * clicking them.
 *
 * Takes `layer` as a prop for the same testability reason ProjectNameLabel
 * does: a rendered `<Header />` can never reach the song layer under
 * `renderToString` (see .claude/rules/testing.md).
 */
export function FollowPlayheadToggle({ layer }: { layer: Layer }) {
  // useLiveStore, not a plain useAppStore selector: this component is rendered
  // standalone in the suite and a plain selector would serve the store's
  // creation-time value under renderToString, making the "off" state
  // untestable (see ui/useLiveStore.ts and .claude/rules/testing.md).
  const followPlayhead = useLiveStore((s) => s.followPlayhead);
  const toggleFollowPlayhead = useLiveStore((s) => s.toggleFollowPlayhead);
  if (layer !== 'song') return null;
  return (
    <IconButton
      id="btn-follow-playhead"
      label={followPlayhead ? 'Following the playing loop — click to stop' : 'Follow the playing loop'}
      aria-pressed={followPlayhead}
      active={followPlayhead}
      icon={
        followPlayhead ? (
          <LocateFixed className="w-4 h-4 text-primary" />
        ) : (
          <LocateOff className="w-4 h-4 opacity-60" />
        )
      }
      onClick={toggleFollowPlayhead}
    />
  );
}

/** What a click handler needs, injected so the wiring is testable with no DOM. */
export interface MixdownExportDeps {
  exportMixdown: () => Promise<MixdownResult>;
  download: (fileName: string, blob: Blob) => void;
  setNotice: (message: string) => void;
  setProgress: (progress: MixdownProgress | null) => void;
  isCancelled: () => boolean;
  yieldToBrowserPaint: () => Promise<void>;
}

/**
 * What a download that threw reads as. The same sentence — and the same
 * reasoning — as `ProjectMenu`'s `downloadCopy`: the anchor/blob path can throw
 * in a restricted embedding, and downloading is best-effort.
 */
export const MIXDOWN_DOWNLOAD_FAILED_MESSAGE =
  'Could not write the file. Check the browser’s download settings.';

/**
 * The click handler's whole body: run the export, download on success, and say
 * so.
 *
 * Extracted and dependency-injected for the reason it is a plain function
 * rather than an inline arrow: the suite has no DOM and no testing-library, so
 * a handler that called `downloadBlob` and `setProjectNotice` directly would be
 * untestable — the buttons would render and nothing would prove they were
 * wired to anything.
 *
 * A RENDER failure writes NO notice here. The slice already wrote one, and a
 * second message on top of it would be the same fact told twice in two voices.
 * A DOWNLOAD failure is the opposite case and is the reason the download is
 * guarded: `downloadBlob` revokes in a `finally` but catches nothing, so it
 * rethrows — and on that path the user has waited out a full render, has no
 * file, and would otherwise be told nothing at all. The success notice is
 * written only after the download has actually returned.
 */
export async function runMixdownExport(deps: MixdownExportDeps): Promise<MixdownResult> {
  const result = await deps.exportMixdown();
  if (result.ok) {
    deps.setProgress({ phase: 'downloading' });
    try {
      await deps.yieldToBrowserPaint();
      if (deps.isCancelled()) {
        return { ok: false, reason: { kind: 'cancelled' } };
      }
      deps.download(result.fileName, result.blob);
    } catch {
      deps.setNotice(MIXDOWN_DOWNLOAD_FAILED_MESSAGE);
      return result;
    } finally {
      deps.setProgress(null);
    }
    deps.setNotice(`Exported ${result.fileName}.`);
  }
  return result;
}

function mixdownProgressLabel(progress: MixdownProgress | null): string {
  if (!progress || progress.phase === 'preparing') return 'Preparing arrangement…';
  if (progress.phase === 'rendering') return `Rendering mixdown… ${progress.percent}%`;
  if (progress.phase === 'encoding') return 'Encoding WAV…';
  if (progress.phase === 'cancelling') return 'Cancelling…';
  return 'Downloading…';
}

/** Let React commit the delivery phase for one visible frame before download. */
function yieldToBrowserPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Export ▾ — the song layer's one arrangement-wide action.
 *
 * Takes `layer` as a prop rather than deriving it, for the same testability
 * reason `FollowPlayheadToggle` and `ProjectNameLabel` do: `Header` derives
 * `layer` from `activeTab` through a plain `useAppStore` selector, which under
 * `renderToString` serves the store's creation-time state, so a rendered
 * `<Header />` can never reach the song layer. The prop is what makes
 * "song layer only" an assertable statement.
 *
 * The menu is SHAPED to take a stem row later — one row per export kind, each
 * owning its own action — and no row is built for it. A control that can never
 * work on this build must not be advertised.
 *
 * `busy` disables the trigger AND the row across rendering and browser
 * delivery: the row can otherwise be clicked twice before either phase
 * resolves, and the disabled attribute closes that gap for the pointer.
 */
export function ExportButton({ layer }: { layer: Layer }) {
  const busy = useLiveStore(selectMixdownBusy);
  const mixdownProgress = useLiveStore((s) => s.mixdownProgress);
  const setMixdownProgress = useLiveStore((s) => s.setMixdownProgress);
  const cancelMixdown = useLiveStore((s) => s.cancelMixdown);
  const isMixdownCancelled = useLiveStore((s) => s.isMixdownCancelled);
  const exportMixdown = useLiveStore((s) => s.exportMixdown);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  if (layer !== 'song') return null;
  const progressLabel = mixdownProgressLabel(mixdownProgress);

  return (
    <div className="flex items-center gap-1">
      <div className="dropdown dropdown-end">
        <button
          id="btn-export"
          type="button"
          disabled={busy}
          className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"
          aria-label={busy ? progressLabel : 'Export'}
          aria-live="polite"
          aria-busy={busy}
        >
          {busy ? (
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span className={busy ? undefined : 'hidden sm:inline'}>
            {busy ? progressLabel : 'Export'}
          </span>
          {!busy && <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />}
        </button>
        <ul
          id="export-menu"
          // daisyUI's dropdown holds itself open on :focus-within, so the panel
          // must be focusable or the menu closes the moment a pointer-down lands
          // inside it. It is a plain container, not a control; the <li><button>
          // row inside is what the keyboard actually reaches.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="dropdown-content menu menu-sm z-50 mt-2 min-w-44 max-w-[calc(100vw-2rem)] rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
        >
          <li>
            <button
              id="btn-export-mixdown"
              type="button"
              disabled={busy}
              onClick={() => {
                void runMixdownExport({
                  exportMixdown,
                  download: downloadBlob,
                  setNotice: setProjectNotice,
                  setProgress: setMixdownProgress,
                  isCancelled: isMixdownCancelled,
                  yieldToBrowserPaint,
                });
              }}
            >
              {busy ? progressLabel : 'Export mixdown (WAV)'}
            </button>
          </li>
        </ul>
      </div>
      {busy && mixdownProgress?.phase !== 'cancelling' && (
        <button
          id="btn-cancel-export"
          type="button"
          className="btn btn-sm btn-ghost px-2 text-xs"
          onClick={cancelMixdown}
        >
          Cancel export
        </button>
      )}
    </div>
  );
}

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

/**
 * The header's theme, from the DOM attribute the index.html bootstrap already
 * resolved (that is what prevents the FOUC) through to the toggle that writes
 * the attribute and localStorage.
 */
function useTheme(): { currentTheme: SolnaTheme; toggleTheme: () => void } {
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

  return { currentTheme, toggleTheme };
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

/** The master key/scale group: an inline field from `xl` up, a dropdown below it. */
function ScaleMenu({ scaleRoot, scaleType }: { scaleRoot: string; scaleType: string }) {
  return (
    <>
      {/* Scale Picker Compact (Desktop >= xl) */}
      <div className={`hidden xl:flex ${HEADER_FIELD_SHELL}`}>
        <ScaleSelects idPrefix="select-master-scale" />
      </div>

      {/* Below `xl` (mobile and landscape/portrait tablet): Compact Scale Picker Dropdown */}
      {/* Centre-aligned on a phone, NOT `dropdown-end`. The panel is
          224px wide and this summary's right edge sits ~169px into a
          375px phone, so right-aligning it put both selects 50px off the
          left of the screen — and the header clips (the app root is
          `overflow-hidden`), so there was nothing to scroll to.
          Start-aligning fixes that width and breaks 320px, where the
          summary sits far enough right to push the panel off the other
          edge; centring on the summary is the one alignment that clears
          BOTH, because the summary sits near the middle of a phone
          header either way. From `sm` up there is room to spare and the
          panel goes back to hanging off the trigger's right edge. */}
      <details className="dropdown dropdown-center sm:dropdown-end xl:hidden">
        <summary
          id="btn-scale-dropdown"
          className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold list-none bg-base-200/70 border border-base-300"
          title={`Key & Scale — ${formatKeyLabel(scaleRoot, scaleType, { long: true })}`}
        >
          <span className="text-primary">{getTonicSpelling(scaleRoot, scaleType)}</span>
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
  );
}

export const Header = React.memo(function Header() {
  const activeTab = useAppStore((s) => s.activeTab);
  const layer = layerForTab(activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  const { currentTheme, toggleTheme } = useTheme();

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
        <IconButton
          id="btn-toggle-theme"
          label={`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`}
          icon={
            currentTheme === 'solna-dark' ? (
              <Sun className="w-4 h-4 text-primary" />
            ) : (
              <Moon className="w-4 h-4 text-primary" />
            )
          }
          size="sm"
          onClick={toggleTheme}
        />
      </div>
    </header>
  );
});
