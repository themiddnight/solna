import React, { Fragment, useCallback, useRef, useState } from 'react';
import { Activity, Bug, ChevronDown, Cloud, CloudOff, CloudUpload, FileDown, FilePlus, Save, Upload } from 'lucide-react';
import { reportManualIncident } from '@/store/incidentReporter';
import { defaultSaveName } from '@/utils/driveBrowser';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject, type ProjectParseResult } from '@/store/projectFile';
import type { ProjectSaveResult } from '@/store/projectSlice';
import type { FeedbackTone } from '@/store/feedback';
import { selectExportBusy } from '@/store/exportSlice';
import type { ProjectSource } from '@/store/projectSource';
import type { DriveUserProfile } from '@/store/driveClient';
import type { AppStore } from '@/store/types';
import { pickLocalOpenHandle, readTextFromHandle, type PickHandleResult } from '@/utils/localFileSave';
import { DOWNLOAD_FAILED_MESSAGE, UNREADABLE_FILE_MESSAGE, downloadTextFile, projectFileName, readFileAsText, type FileReadResult } from '@/utils/projectFileIO';
import { ProjectLoading } from '../ProjectLoading';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveStore } from '../ui/useLiveStore';
import { Popup } from '../ui/Popup';
import { usePopupMenu } from '../ui/usePopupMenu';
import { DriveFileBrowserModal, type DriveFileBrowserModalProps } from './DriveFileBrowserModal';

// Compile-time guard: production builds fold `import.meta.env.DEV` to false, so the
// dynamic import (and its chunk) never ships. Incident reports are the only production surface.
const DiagnosticPanel = import.meta.env.DEV
  ? React.lazy(() => import('@/diagnostics/DiagnosticPanel'))
  : null;

export type ProjectMenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'open-drive'
  | 'save-as-drive'
  | 'disconnect-drive'
  | 'diagnostics'
  | 'report-bug';

/**
 * Only the actions that REPLACE the one autosaved project confirm. Save writes
 * to a target the user already chose, Save As creates a new file (locally or in
 * Drive), and Disconnect Drive costs no work at all — none of them can lose
 * anything, so none of them may put a dialog in the way of a deliberate save.
 */
export type ReplacingAction = 'open' | 'open-drive' | 'new';

export const REPLACING_ACTIONS: ReadonlyArray<ReplacingAction> = ['open', 'open-drive', 'new'];

/**
 * The type predicate is load-bearing: it is what lets `choose` hand `action`
 * straight to a `ReplacingAction | null` state with no cast, and it is the one
 * statement of which rows the confirm protects.
 */
export function replacesProject(action: ProjectMenuAction): action is ReplacingAction {
  return REPLACING_ACTIONS.some((replacing) => replacing === action);
}

interface ProjectMenuRow {
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}

export interface ProjectMenuSection {
  /** A stable id for placement logic — never rendered and never a display string. */
  id: 'document' | 'local' | 'drive' | 'tools';
  /** Rendered as a non-interactive menu title; null for the unlabelled first group. */
  heading: string | null;
  /** A second, muted line under the heading — the Drive account, when connected. */
  subtitle?: string;
  rows: readonly ProjectMenuRow[];
}

/**
 * The menu in three groups: the document itself (New), the local filesystem
 * (Open/Save/Save As), and the optional Drive surface. Drive is a section
 * rather than a few rows scattered among the local ones because it is the one
 * group that vanishes entirely when the deployment has no client id.
 */
/** The Save row as one literal, placed into Local or Drive — never written twice. */
const SAVE_ROW: ProjectMenuRow = { action: 'save', label: 'Save', icon: Save };

/** Tools rows: `Diagnostics` (the recorder panel) is a maintainer tool and never ships to production. */
export function toolsRows({ development }: { development: boolean }): ProjectMenuRow[] {
  const report: ProjectMenuRow = { action: 'report-bug', label: 'Report a Bug', icon: Bug };
  return development ? [{ action: 'diagnostics', label: 'Diagnostics', icon: Activity }, report] : [report];
}

export const PROJECT_MENU_SECTIONS: readonly ProjectMenuSection[] = [
  {
    id: 'document',
    heading: null,
    rows: [{ action: 'new', label: 'New project', icon: FilePlus }],
  },
  {
    id: 'local',
    heading: 'Local',
    rows: [
      { action: 'open', label: 'Open .solna', icon: Upload },
      SAVE_ROW,
      { action: 'save-as', label: 'Save as…', icon: FileDown },
    ],
  },
  {
    id: 'drive',
    heading: 'Drive',
    rows: [
      { action: 'open-drive', label: 'Open from Drive', icon: Cloud },
      { action: 'save-as-drive', label: 'Save as to Drive…', icon: CloudUpload },
      { action: 'disconnect-drive', label: 'Disconnect Drive', icon: CloudOff },
    ],
  },
  {
    id: 'tools',
    heading: 'Tools',
    rows: toolsRows({ development: import.meta.env.DEV === true }),
  },
];

/** Save names its target only when that target is not obvious — a Drive-bound file. */
export function saveLabel(sourceKind: ProjectSource['kind']): string {
  return sourceKind === 'drive' ? 'Save to Drive' : 'Save';
}

/** The connected account's email, or name when Drive hides the email. Null when signed out. */
export function driveAccountLabel(user: DriveUserProfile | null): string | null {
  const identity = user && (user.email || user.name);
  return identity || null;
}

/**
 * Which sections this session can actually use, with the Save row placed and
 * labelled. A pure function, not several `&&`s in the render: the rule is
 * testable without a DOM and lives in one place.
 *
 * The Drive rows need a configured deployment; Disconnect additionally needs a
 * connection to end — a token held now, or an account remembered from an
 * earlier page (a sign-out row with neither is a row that does nothing). A section whose rows all vanish drops out entirely, so an
 * unconfigured build renders no "Drive" heading. Save is the one
 * source-dependent row: it follows the file into the section that binds it —
 * Local for a local/untitled file, Drive for a Drive-bound one — and the Drive
 * heading carries the connected account.
 */
export function visibleMenuSections(
  driveAvailable: boolean,
  driveSignedIn: boolean,
  sourceKind: ProjectSource['kind'],
  driveUser: DriveUserProfile | null,
): readonly ProjectMenuSection[] {
  const isDrive = sourceKind === 'drive';

  const sections = PROJECT_MENU_SECTIONS.map((section) => ({
    id: section.id,
    heading: section.heading,
    rows: section.rows.filter(({ action }) => {
      if (action === 'open-drive' || action === 'save-as-drive') return driveAvailable;
      if (action === 'disconnect-drive') return driveAvailable && (driveSignedIn || driveUser !== null);
      return true;
    }),
  }));

  if (isDrive) {
    for (const section of sections) {
      if (section.id === 'local') {
        section.rows = section.rows.filter((row) => row.action !== 'save');
      } else if (section.id === 'drive') {
        section.rows = section.rows.flatMap((row) =>
          row.action === 'open-drive' ? [row, SAVE_ROW] : [row],
        );
      }
    }
  }

  return sections
    .filter((section) => section.rows.length > 0)
    .map((section) => ({
      ...section,
      subtitle: section.id === 'drive' ? (driveAccountLabel(driveUser) ?? undefined) : undefined,
      rows: section.rows.map((row) =>
        row.action === 'save' ? { ...row, label: saveLabel(sourceKind) } : row,
      ),
    }));
}

/** Only the three replacing actions ever reach the confirm — see replacesProject. */
const CONFIRM_COPY: Record<ReplacingAction, { title: string; label: string }> = {
  open: { title: 'Open a project file', label: 'Choose a file' },
  'open-drive': { title: 'Open from Google Drive', label: 'Browse Drive' },
  new: { title: 'Start a new project', label: 'New project' },
};

export const REPLACE_CONFIRM_MESSAGE =
  'This replaces your current project. It is autosaved, so the one you are editing now will be gone.';

export function replaceConfirmMessage(exporting: boolean): string {
  return exporting
    ? `${REPLACE_CONFIRM_MESSAGE} The export in progress will be cancelled.`
    : REPLACE_CONFIRM_MESSAGE;
}

/**
 * The wordmark IS the project menu. There is no project list any more, so the
 * brand mark is the one place a project-level action can live, and it is
 * present on both layers because a project spans the whole app.
 *
 * Open, Open from Drive and New all replace the single autosaved project, which
 * is destructive and irreversible once the slot is overwritten, so all three
 * pass through one confirm. Save, Save As and Disconnect Drive write a file the
 * user chose or touch nothing at all, so they need none.
 */
/** Which half of the Drive browser the menu opened. */
type ProjectBrowseMode = 'open' | 'save-as';

/** What each row does, as one dispatch — this is why the JSX holds no action logic. */
interface MenuActionHandlers {
  confirm: (action: ReplacingAction) => void;
  save: () => void;
  saveAs: () => void;
  browseSaveAs: () => void;
  disconnectDrive: () => void;
  diagnostics: () => void;
  reportBug: () => void;
}

function runMenuAction(action: ProjectMenuAction, handlers: MenuActionHandlers): void {
  if (replacesProject(action)) {
    handlers.confirm(action);
    return;
  }
  if (action === 'save') {
    handlers.save();
    return;
  }
  if (action === 'save-as') {
    handlers.saveAs();
    return;
  }
  if (action === 'save-as-drive') {
    handlers.browseSaveAs();
    return;
  }
  if (action === 'disconnect-drive') {
    // No confirm: it costs no work. The body, the autosaved slot and the
    // local session are untouched — only the Drive pointer and the token go.
    handlers.disconnectDrive();
    return;
  }
  if (action === 'diagnostics') handlers.diagnostics();
  if (action === 'report-bug') handlers.reportBug();
}

/** The store's own `openProjectFile` shape, named here so the pure helpers below need no store import. */
export type OpenProjectFile = AppStore['openProjectFile'];

/**
 * The one path a parsed body takes: a parse failure reports and stops; an
 * open failure reports unless it is the "storage unavailable" degrade, which
 * is the same notice-free outcome as a missing slot. `parsed.warnings` — an
 * incompatible synth patch reset to its track default, an unresolved library
 * id — is carried through to `openProjectFile` so it lands in the same notice
 * the install path already writes, rather than being read here and dropped.
 *
 * Exported standalone rather than left as a hook-local closure, so it is
 * testable the way this repo tests helpers: called directly, with no render.
 */
export async function openParsedProjectFile(
  parsed: ProjectParseResult,
  openProjectFile: OpenProjectFile,
  report: (message: string | null) => void,
  notify: (message: string, tone: FeedbackTone) => void,
  source?: ProjectSource,
): Promise<void> {
  if (parsed.ok === false) {
    // A malformed / newer-version file: the result of THIS open attempt, not a
    // persistent problem, so it is a toast (§5.6), not the banner.
    notify(parsed.message, 'error');
    return;
  }
  const result = await openProjectFile(parsed.body, source, parsed.warnings);
  // Install failure here is the same storage-unavailable/failed/quota family
  // `openProjectFile` already wrote to the banner (§5.6) — reported through
  // `report`, never a toast, so the two stay in the same surface.
  if (result.ok === false && result.error !== 'unavailable') report(result.message);
}

/**
 * The full path from a raw read to an installed project. A read failure is
 * reported as itself (UNREADABLE_FILE_MESSAGE) and never reaches the JSON
 * parser — laundering it through `parseProjectFile` used to report a file
 * that was never actually read as "not a Solna project", discarding the real
 * cause (a revoked permission, a moved or deleted file) along the way.
 */
export async function openReadResult(
  read: FileReadResult,
  openProjectFile: OpenProjectFile,
  report: (message: string | null) => void,
  notify: (message: string, tone: FeedbackTone) => void,
  source?: ProjectSource,
): Promise<void> {
  if (read.ok === false) {
    notify(UNREADABLE_FILE_MESSAGE, 'error');
    return;
  }
  await openParsedProjectFile(parseProjectFile(read.text), openProjectFile, report, notify, source);
}

/**
 * The writable open, from the picker to an installed project.
 *
 * Two ways to end up on the `<input type=file>` fallback, and the second is
 * the one a user reported. The first is the picker being absent (Safari,
 * Firefox, a permissions-policy iframe): `pickLocalOpenHandle` reports
 * `unavailable` and the `<input>` yields a read-only `File`, so the project
 * opens untitled — the honest degradation. The second is the picker being
 * PRESENT and its handle still not reading: in an embedded webview
 * `showOpenFilePicker` exists, so the capability probe answers yes and
 * `unavailable` never fires, and the read through the handle fails anyway.
 * Feature detection standing in for the capability working is what had the app
 * blaming a valid project; only a successful READ confirms the probe.
 *
 * So a failed read takes the same fallback, and still reports: the second
 * dialog is a route forward, not a denial that the first attempt failed. A
 * `cancelled` pick does nothing at all.
 *
 * Exported standalone, and its four seams injected, for the same reason
 * `openReadResult` is: this repo tests helpers by calling them, never by
 * driving a rendered menu.
 */
export async function openPickedLocalFile({
  pick,
  readHandle,
  openWithInput,
  openProjectFile,
  report,
  notify,
}: {
  pick: () => Promise<PickHandleResult>;
  readHandle: (handle: FileSystemFileHandle) => Promise<FileReadResult>;
  openWithInput: () => void;
  openProjectFile: OpenProjectFile;
  report: (message: string | null) => void;
  notify: (message: string, tone: FeedbackTone) => void;
}): Promise<void> {
  const picked = await pick();
  if (picked.ok === false) {
    if (picked.reason === 'unavailable') openWithInput();
    return;
  }
  const read = await readHandle(picked.handle);
  if (read.ok === false) {
    notify(UNREADABLE_FILE_MESSAGE, 'error');
    openWithInput();
    return;
  }
  await openReadResult(read, openProjectFile, report, notify, { kind: 'local', handle: picked.handle });
}

/**
 * Every project-file command the menu can run, with the store actions behind
 * it. The component below owns only which dialog is open; what a row DOES
 * lives here, so the markup and the operations can be read separately.
 */
function useProjectFileCommands({
  setPending,
  setBrowser,
  fileInputRef,
}: {
  setPending: (label: string | null) => void;
  setBrowser: (mode: ProjectBrowseMode | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const openProjectFile = useLiveStore((s) => s.openProjectFile);
  const exportProjectFile = useLiveStore((s) => s.exportProjectFile);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  const showFeedback = useLiveStore((s) => s.showFeedback);
  const saveProject = useLiveStore((s) => s.saveProject);
  const saveProjectAsLocal = useLiveStore((s) => s.saveProjectAsLocal);
  const disconnectDrive = useLiveStore((s) => s.disconnectDrive);
  const openFromDrive = useLiveStore((s) => s.openFromDrive);
  const listDriveProjects = useLiveStore((s) => s.listDriveProjects);
  const saveAsToDrive = useLiveStore((s) => s.saveAsToDrive);

  /** The banner (§5.6): a persistent storage problem, cleared the same way. */
  const report = (message: string | null) => setProjectNotice(message);
  /** A one-shot toast (§5.6), keyed `project-file` so a repeat replaces rather than stacks. */
  const notify = (message: string, tone: FeedbackTone) => showFeedback({ key: 'project-file', message, tone });

  /**
   * The no-File-System-Access fallback for Save As (Safari, Firefox): a
   * download is the closest those browsers can get to a local save, and it
   * leaves the source untitled rather than pretending a handle was kept.
   */
  const downloadCopy = () => {
    const body = exportProjectFile();
    try {
      downloadTextFile(projectFileName(body.name), serializeProject(body), PROJECT_FILE_MIME);
      report(null);
    } catch {
      // downloadTextFile's anchor/blob path can throw in a restricted
      // embedding; downloading is best-effort and the live session is untouched.
      notify(DOWNLOAD_FAILED_MESSAGE, 'error');
    }
  };

  /**
   * The one place a save result becomes UI. `download` is the no-File-System-
   * Access fallback (Safari, Firefox): Save As degrades to a downloaded copy.
   * `cancelled` is a dismissed picker: nothing happened, so nothing is said.
   */
  const finishSave = (result: ProjectSaveResult) => {
    if (result.ok === false) {
      // An explicit save failure / handle denial (§5.6): the result of THIS
      // action, so a toast, never the persistent banner.
      notify(result.message, 'error');
      return;
    }
    if (result.destination === 'download') {
      downloadCopy();
      return;
    }
    if (result.destination !== 'cancelled') report(null);
  };

  /**
   * One pending overlay for every explicit save/open, cleared in `finally` so a
   * failure still dismisses it. The autosave is deliberately NOT wrapped — it is
   * background and must stay invisible.
   */
  const run = async (label: string, op: () => Promise<void>): Promise<void> => {
    setPending(label);
    try {
      await op();
    } finally {
      setPending(null);
    }
  };

  const runSaveOp = (label: string, op: () => Promise<ProjectSaveResult>) =>
    run(label, async () => finishSave(await op()));
  const runSave = () => runSaveOp('Saving…', saveProject);
  const runSaveAs = () => runSaveOp('Saving…', saveProjectAsLocal);
  const runSaveAsToDrive = (name: string) => runSaveOp('Saving to Drive…', () => saveAsToDrive(name));

  const runOpenFromDrive = (fileId: string) =>
    run('Opening from Drive…', async () => {
      setBrowser(null);
      await openFromDrive(fileId);
    });

  /**
   * Wrapped in useCallback because the modal lists from an effect keyed on it:
   * a fresh arrow each render would re-list on every keystroke in the save-name
   * field. The store's action is stable, so this is stable too.
   */
  const listDrive = useCallback(
    (pageToken?: string) => listDriveProjects(pageToken),
    [listDriveProjects],
  );

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run('Opening…', async () => {
      await openReadResult(await readFileAsText(file), openProjectFile, report, notify);
    });
  };

  /**
   * The writable open, and the whole reason Save can overwrite: the picker
   * hands back a handle, the handle is read for the parse and then KEPT as the
   * source. See `openPickedLocalFile` for the two routes to the `<input>`.
   */
  const runOpenLocal = () =>
    run('Opening…', () =>
      openPickedLocalFile({
        pick: pickLocalOpenHandle,
        readHandle: readTextFromHandle,
        openWithInput: () => fileInputRef.current?.click(),
        openProjectFile,
        report,
        notify,
      }),
    );

  return {
    runSave,
    runSaveAs,
    runOpenLocal,
    runOpenFromDrive,
    runSaveAsToDrive,
    listDrive,
    onPickFile,
    disconnectDrive,
  };
}

export interface UseProjectMenu {
  sections: readonly ProjectMenuSection[];
  choose: (action: ProjectMenuAction) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  confirming: ReplacingAction | null;
  exporting: boolean;
  onConfirmReplace: () => void;
  cancelConfirm: () => void;
  browser: ProjectBrowseMode | null;
  driveSignedIn: boolean;
  projectName: AppStore['projectName'];
  closeBrowser: () => void;
  connectDrive: () => void;
  listDrive: DriveFileBrowserModalProps['onList'];
  openDriveFile: (fileId: string) => void;
  saveAsDriveFile: (name: string) => void;
  pending: string | null;
  diagnosticsOpen: boolean;
  closeDiagnostics: () => void;
}

/**
 * The project menu's state and commands, called once per frame (R268): the
 * desktop dropdown and the mobile menu sheet render the same rows and the
 * same dialogs from it. Which dialog is open is local UI state.
 */
export function useProjectMenu(): UseProjectMenu {
  const [confirming, setConfirming] = useState<ReplacingAction | null>(null);
  const [browser, setBrowser] = useState<ProjectBrowseMode | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectName = useLiveStore((s) => s.projectName);
  const exporting = useLiveStore(selectExportBusy);
  const projectSource = useLiveStore((s) => s.projectSource);
  const driveAvailable = useLiveStore((s) => s.driveAvailable);
  const driveSignedIn = useLiveStore((s) => s.driveSignedIn);
  const driveUser = useLiveStore((s) => s.driveUser);
  const connectDrive = useLiveStore((s) => s.connectDrive);
  const newProject = useLiveStore((s) => s.newProject);

  const commands = useProjectFileCommands({ setPending, setBrowser, fileInputRef });

  const choose = (action: ProjectMenuAction) =>
    runMenuAction(action, {
      confirm: setConfirming,
      save: () => void commands.runSave(),
      saveAs: () => void commands.runSaveAs(),
      browseSaveAs: () => setBrowser('save-as'),
      disconnectDrive: () => void commands.disconnectDrive(),
      diagnostics: () => setDiagnosticsOpen(true),
      reportBug: () => reportManualIncident(),
    });

  const onConfirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === null) return;
    if (action === 'open') void commands.runOpenLocal();
    if (action === 'open-drive') setBrowser('open');
    if (action === 'new') newProject();
  };

  return {
    sections: visibleMenuSections(driveAvailable, driveSignedIn, projectSource.kind, driveUser),
    choose,
    fileInputRef,
    onPickFile: commands.onPickFile,
    confirming,
    exporting,
    onConfirmReplace,
    cancelConfirm: () => setConfirming(null),
    browser,
    driveSignedIn,
    projectName,
    closeBrowser: () => setBrowser(null),
    connectDrive: () => void connectDrive(),
    listDrive: commands.listDrive,
    openDriveFile: (fileId) => void commands.runOpenFromDrive(fileId),
    saveAsDriveFile: (name) => {
      setBrowser(null);
      void commands.runSaveAsToDrive(name);
    },
    pending,
    diagnosticsOpen,
    closeDiagnostics: () => setDiagnosticsOpen(false),
  };
}

/** The menu's rows, as the dropdown and the mobile sheet both render them. */
export function ProjectMenuSections({
  sections,
  onChoose,
  rowClassName,
}: {
  sections: readonly ProjectMenuSection[];
  onChoose: (action: ProjectMenuAction) => void;
  rowClassName?: string;
}) {
  return (
    <>
      {sections.map((section, i) => (
        <Fragment key={section.heading ?? `section-${i}`}>
          {section.heading !== null && (
            <li className="menu-title">
              {section.heading}
              {section.subtitle && (
                <span className="block truncate text-xs font-normal text-base-content/50">{section.subtitle}</span>
              )}
            </li>
          )}
          {section.rows.map(({ action, label, icon: Icon }) => (
            <li key={action}>
              <button type="button" id={`project-menu-${action}`} className={rowClassName} onClick={() => onChoose(action)}>
                <Icon className="w-4 h-4" aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/** Everything a row can open: the file input, the confirm, the Drive browser, the pending overlay, Diagnostics. */
export function ProjectMenuEffects({ menu }: { menu: UseProjectMenu }) {
  return (
    <>
      <input
        ref={menu.fileInputRef}
        type="file"
        accept={PROJECT_FILE_ACCEPT}
        aria-label="Open a .solna project file"
        className="hidden"
        onChange={(e) => void menu.onPickFile(e)}
      />
      {menu.confirming !== null && (
        <ConfirmDialog
          title={CONFIRM_COPY[menu.confirming].title}
          message={replaceConfirmMessage(menu.exporting)}
          confirmLabel={CONFIRM_COPY[menu.confirming].label}
          onConfirm={menu.onConfirmReplace}
          onCancel={menu.cancelConfirm}
        />
      )}
      {menu.browser !== null && (
        <DriveFileBrowserModal
          open
          mode={menu.browser}
          signedIn={menu.driveSignedIn}
          initialName={defaultSaveName(menu.projectName)}
          onClose={menu.closeBrowser}
          onConnect={menu.connectDrive}
          onList={menu.listDrive}
          onOpenFile={menu.openDriveFile}
          onSaveAs={menu.saveAsDriveFile}
        />
      )}
      {menu.pending !== null && <ProjectLoading overlay label={menu.pending} />}
      {DiagnosticPanel && menu.diagnosticsOpen && (
        <React.Suspense fallback={<ProjectLoading overlay label="Loading diagnostics…" />}>
          <DiagnosticPanel open onClose={menu.closeDiagnostics} />
        </React.Suspense>
      )}
    </>
  );
}

/** The panel's box: the look the CSS-only dropdown's list wore. */
const PROJECT_MENU_PANEL =
  'mt-2 min-w-44 max-w-[calc(100vw-2rem)] rounded-box bg-base-100 border border-base-300 p-1 shadow-lg';

/** The chevron that opens the menu: a real <button>, so a click toggles it in every browser. */
function ProjectMenuTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      id="btn-project-menu"
      aria-label="Project menu"
      aria-expanded={open}
      aria-controls="project-menu-list"
      onClick={onToggle}
      className="inline-flex min-h-11 min-w-8 items-center justify-center rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <ChevronDown className="w-4 h-4 text-base-content/60" aria-hidden="true" />
    </button>
  );
}

/**
 * The desktop project menu on `ui/Popup` (R328). Choosing a row closes the
 * menu, then runs the action: `Popup` hands focus back to the trigger as it
 * closes, and a dialog the action opens then takes it (`showModal`), handing
 * it back to the trigger when it closes. `ProjectMenuEffects` renders beside
 * the popup, never inside its panel, so the dialog outlives the menu.
 */
export function ProjectMenu() {
  const menu = useProjectMenu();
  const popup = usePopupMenu(menu.choose);
  return (
    <>
      <Popup
        open={popup.open}
        onClose={popup.close}
        align="start"
        panelClassName={PROJECT_MENU_PANEL}
        trigger={<ProjectMenuTrigger open={popup.open} onToggle={popup.toggle} />}
      >
        <ul id="project-menu-list" className="menu menu-sm w-full p-0">
          <ProjectMenuSections sections={menu.sections} onChoose={popup.pick} />
        </ul>
      </Popup>
      <ProjectMenuEffects menu={menu} />
    </>
  );
}
