import React, { Fragment, useCallback, useRef, useState } from 'react';
import { Cloud, CloudOff, CloudUpload, FileDown, FilePlus, Save, Upload } from 'lucide-react';
import { defaultSaveName } from '@/utils/driveBrowser';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject } from '@/store/projectFile';
import type { ProjectSaveResult } from '@/store/projectSlice';
import type { ProjectSource } from '@/store/projectSource';
import type { DriveUserProfile } from '@/store/driveClient';
import { pickLocalOpenHandle, readTextFromHandle } from '@/utils/localFileSave';
import { downloadTextFile, projectFileName, readFileAsText } from '@/utils/projectFileIO';
import { ProjectLoading } from '../ProjectLoading';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveStore } from '../ui/useLiveStore';
import { Wordmark } from '../ui/Wordmark';
import { DriveFileBrowserModal } from './DriveFileBrowserModal';

export type ProjectMenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'open-drive'
  | 'save-as-drive'
  | 'disconnect-drive';

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

export interface ProjectMenuRow {
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}

export interface ProjectMenuSection {
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
export const PROJECT_MENU_SECTIONS: readonly ProjectMenuSection[] = [
  {
    heading: null,
    rows: [{ action: 'new', label: 'New project', icon: FilePlus }],
  },
  {
    heading: 'Local',
    rows: [
      { action: 'open', label: 'Open .solna', icon: Upload },
      { action: 'save', label: 'Save', icon: Save },
      { action: 'save-as', label: 'Save as…', icon: FileDown },
    ],
  },
  {
    heading: 'Drive',
    rows: [
      { action: 'open-drive', label: 'Open from Drive', icon: Cloud },
      { action: 'save-as-drive', label: 'Save as to Drive…', icon: CloudUpload },
      { action: 'disconnect-drive', label: 'Disconnect Drive', icon: CloudOff },
    ],
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
 * The Drive rows need a configured deployment; Disconnect additionally needs an
 * actual connection (a sign-out row on a signed-out app is a row that does
 * nothing). A section whose rows all vanish drops out entirely, so an
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
    heading: section.heading,
    rows: section.rows.filter(({ action }) => {
      if (action === 'open-drive' || action === 'save-as-drive') return driveAvailable;
      if (action === 'disconnect-drive') return driveAvailable && driveSignedIn;
      return true;
    }),
  }));

  if (isDrive) {
    for (const section of sections) {
      if (section.heading === 'Local') {
        section.rows = section.rows.filter((row) => row.action !== 'save');
      } else if (section.heading === 'Drive') {
        section.rows = section.rows.flatMap((row) =>
          row.action === 'open-drive' ? [row, { action: 'save', label: 'Save', icon: Save }] : [row],
        );
      }
    }
  }

  return sections
    .filter((section) => section.rows.length > 0)
    .map((section) => ({
      ...section,
      subtitle: section.heading === 'Drive' ? (driveAccountLabel(driveUser) ?? undefined) : undefined,
      rows: section.rows.map((row) =>
        row.action === 'save' ? { ...row, label: saveLabel(sourceKind) } : row,
      ),
    }));
}

/** Only the three replacing actions ever reach the confirm — see replacesProject. */
export const CONFIRM_TITLE: Record<ReplacingAction, string> = {
  open: 'Open a project file',
  'open-drive': 'Open from Google Drive',
  new: 'Start a new project',
};

export const CONFIRM_LABEL: Record<ReplacingAction, string> = {
  open: 'Choose a file',
  'open-drive': 'Browse Drive',
  new: 'New project',
};

export const REPLACE_CONFIRM_MESSAGE =
  'This replaces your current project. It is autosaved, so the one you are editing now will be gone.';

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
export function ProjectMenu({ textClassName }: { textClassName?: string }) {
  const [confirming, setConfirming] = useState<ReplacingAction | null>(null);
  const [browser, setBrowser] = useState<'open' | 'save-as' | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openProjectFile = useLiveStore((s) => s.openProjectFile);
  const exportProjectFile = useLiveStore((s) => s.exportProjectFile);
  const newProject = useLiveStore((s) => s.newProject);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  const saveProject = useLiveStore((s) => s.saveProject);
  const saveProjectAsLocal = useLiveStore((s) => s.saveProjectAsLocal);
  const projectName = useLiveStore((s) => s.projectName);
  const projectSource = useLiveStore((s) => s.projectSource);
  const driveAvailable = useLiveStore((s) => s.driveAvailable);
  const driveSignedIn = useLiveStore((s) => s.driveSignedIn);
  const driveUser = useLiveStore((s) => s.driveUser);
  const connectDrive = useLiveStore((s) => s.connectDrive);
  const disconnectDrive = useLiveStore((s) => s.disconnectDrive);
  const openFromDrive = useLiveStore((s) => s.openFromDrive);
  const listDriveProjects = useLiveStore((s) => s.listDriveProjects);
  const saveAsToDrive = useLiveStore((s) => s.saveAsToDrive);

  const report = (message: string | null) => setProjectNotice(message);

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
      report('Could not write the file. Check the browser’s download settings.');
    }
  };

  /**
   * The one place a save result becomes UI. `download` is the no-File-System-
   * Access fallback (Safari, Firefox): Save As degrades to a downloaded copy.
   * `cancelled` is a dismissed picker: nothing happened, so nothing is said.
   */
  const finishSave = (result: ProjectSaveResult) => {
    if (result.ok === false) {
      report(result.message);
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

  const runSave = () => run('Saving…', async () => finishSave(await saveProject()));
  const runSaveAs = () => run('Saving…', async () => finishSave(await saveProjectAsLocal()));
  const runSaveAsToDrive = (name: string) => run('Saving to Drive…', async () => finishSave(await saveAsToDrive(name)));

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
      const parsed = parseProjectFile(await readFileAsText(file));
      if (parsed.ok === false) {
        report(parsed.message);
        return;
      }
      const result = await openProjectFile(parsed.body);
      if (result.ok === false && result.error !== 'unavailable') report(result.message);
    });
  };

  /**
   * The writable open, and the whole reason Save can overwrite: the picker
   * hands back a handle, the handle is read for the parse and then KEPT as the
   * source. `unavailable` falls through to the `<input>`, which yields a
   * read-only File and therefore an untitled project — the honest degradation,
   * not a silent one. `cancelled` does nothing at all.
   */
  const runOpenLocal = () =>
    run('Opening…', async () => {
      const picked = await pickLocalOpenHandle();
      if (picked.ok === false) {
        if (picked.reason === 'unavailable') fileInputRef.current?.click();
        return;
      }
      const parsed = parseProjectFile(await readTextFromHandle(picked.handle));
      if (parsed.ok === false) {
        report(parsed.message);
        return;
      }
      const result = await openProjectFile(parsed.body, { kind: 'local', handle: picked.handle });
      if (result.ok === false && result.error !== 'unavailable') report(result.message);
    });

  const choose = (action: ProjectMenuAction) => {
    if (replacesProject(action)) {
      setConfirming(action);
      return;
    }
    if (action === 'save') {
      void runSave();
      return;
    }
    if (action === 'save-as') {
      void runSaveAs();
      return;
    }
    if (action === 'save-as-drive') {
      setBrowser('save-as');
      return;
    }
    if (action === 'disconnect-drive') {
      // No confirm: it costs no work. The body, the autosaved slot and the
      // local session are untouched — only the Drive pointer and the token go.
      void disconnectDrive();
      return;
    }
  };

  const confirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === 'open') void runOpenLocal();
    if (action === 'open-drive') setBrowser('open');
    if (action === 'new') newProject();
  };

  return (
    <div className="dropdown">
      <Wordmark textClassName={textClassName} ariaLabel="Project menu" chevron />
      <ul
        // daisyUI's dropdown holds itself open on :focus-within, so the panel
        // must be focusable or the menu closes the moment a pointer-down lands
        // inside it. It is a plain container, not a control; the <li><button>
        // rows inside are what the keyboard actually reaches.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="dropdown-content menu menu-sm z-50 mt-2 min-w-44 max-w-[calc(100vw-2rem)] rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
      >
        {visibleMenuSections(driveAvailable, driveSignedIn, projectSource.kind, driveUser).map((section, i) => (
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
                <button type="button" id={`project-menu-${action}`} onClick={() => choose(action)}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </Fragment>
        ))}
      </ul>
      <input
        ref={fileInputRef}
        type="file"
        accept={PROJECT_FILE_ACCEPT}
        aria-label="Open a .solna project file"
        className="hidden"
        onChange={(e) => void onPickFile(e)}
      />
      {confirming !== null && (
        <ConfirmDialog
          title={CONFIRM_TITLE[confirming]}
          message={REPLACE_CONFIRM_MESSAGE}
          confirmLabel={CONFIRM_LABEL[confirming]}
          onConfirm={confirmReplace}
          onCancel={() => setConfirming(null)}
        />
      )}
      {browser !== null && (
        <DriveFileBrowserModal
          open
          mode={browser}
          signedIn={driveSignedIn}
          initialName={defaultSaveName(projectName)}
          onClose={() => setBrowser(null)}
          onConnect={() => void connectDrive()}
          onList={listDrive}
          onOpenFile={(fileId) => void runOpenFromDrive(fileId)}
          onSaveAs={(name) => {
            setBrowser(null);
            void runSaveAsToDrive(name);
          }}
        />
      )}
      {pending !== null && <ProjectLoading overlay label={pending} />}
    </div>
  );
}
