import React, { useCallback, useRef, useState } from 'react';
import { Cloud, CloudOff, Download, FileDown, FilePlus, Save, Upload } from 'lucide-react';
import { defaultSaveName } from '@/utils/driveBrowser';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject } from '@/store/projectFile';
import type { ProjectSaveResult } from '@/store/projectSlice';
import { pickLocalOpenHandle, readTextFromHandle } from '@/utils/localFileSave';
import { downloadTextFile, projectFileName, readFileAsText } from '@/utils/projectFileIO';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveStore } from '../ui/useLiveStore';
import { Wordmark } from '../ui/Wordmark';
import { DriveFileBrowserModal } from './DriveFileBrowserModal';
import { SaveAsTargetDialog } from './SaveAsTargetDialog';

export type ProjectMenuAction =
  | 'open'
  | 'open-drive'
  | 'save'
  | 'save-as'
  | 'export'
  | 'new'
  | 'disconnect-drive';

/**
 * Only the actions that REPLACE the one autosaved project confirm. Save writes
 * to a target the user already chose, Save As asks where first and then creates
 * a new file, Export only reads, and Disconnect Drive costs no work at all —
 * none of the four can lose anything, so none of them may put a dialog in the
 * way of a deliberate save.
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

/** Open, Open from Drive and New replace the one autosaved project; the rest never touch it. */
export const PROJECT_MENU_ACTIONS: ReadonlyArray<{
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}> = [
  { action: 'open', label: 'Open .solna', icon: Upload },
  { action: 'open-drive', label: 'Open from Drive', icon: Cloud },
  { action: 'save', label: 'Save', icon: Save },
  { action: 'save-as', label: 'Save as…', icon: FileDown },
  { action: 'export', label: 'Export .solna', icon: Download },
  { action: 'new', label: 'New project', icon: FilePlus },
  { action: 'disconnect-drive', label: 'Disconnect Drive', icon: CloudOff },
];

/**
 * Which rows this session can actually use. A pure function, not two `&&`s in
 * the render: the rule is testable without a DOM and lives in one place.
 *
 * `open-drive` needs a configured deployment but NOT a connection — the modal
 * is where connecting happens. `disconnect-drive` needs an actual connection,
 * because a sign-out row on a signed-out app is a row that does nothing.
 */
export function visibleMenuActions(
  driveAvailable: boolean,
  driveSignedIn: boolean,
): typeof PROJECT_MENU_ACTIONS {
  return PROJECT_MENU_ACTIONS.filter(({ action }) => {
    if (action === 'open-drive') return driveAvailable;
    if (action === 'disconnect-drive') return driveAvailable && driveSignedIn;
    return true;
  });
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
 * pass through one confirm. Save, Save As, Export and Disconnect Drive write a
 * file the user chose or touch nothing at all, so they need none.
 */
export function ProjectMenu({ textClassName }: { textClassName?: string }) {
  const [confirming, setConfirming] = useState<ReplacingAction | null>(null);
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [browser, setBrowser] = useState<'open' | 'save-as' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openProjectFile = useLiveStore((s) => s.openProjectFile);
  const exportProjectFile = useLiveStore((s) => s.exportProjectFile);
  const newProject = useLiveStore((s) => s.newProject);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  const saveProject = useLiveStore((s) => s.saveProject);
  const saveProjectAsLocal = useLiveStore((s) => s.saveProjectAsLocal);
  const projectName = useLiveStore((s) => s.projectName);
  const driveAvailable = useLiveStore((s) => s.driveAvailable);
  const driveSignedIn = useLiveStore((s) => s.driveSignedIn);
  const connectDrive = useLiveStore((s) => s.connectDrive);
  const disconnectDrive = useLiveStore((s) => s.disconnectDrive);
  const openFromDrive = useLiveStore((s) => s.openFromDrive);
  const listDriveProjects = useLiveStore((s) => s.listDriveProjects);
  const saveAsToDrive = useLiveStore((s) => s.saveAsToDrive);

  const report = (message: string | null) => setProjectNotice(message);

  const runExport = () => {
    const body = exportProjectFile();
    try {
      downloadTextFile(projectFileName(body.name), serializeProject(body), PROJECT_FILE_MIME);
      report(null);
    } catch {
      // downloadTextFile's anchor/blob path can throw in a restricted
      // embedding; exporting is best-effort and the live session is untouched.
      report('Could not write the file. Check the browser’s download settings.');
    }
  };

  /**
   * The one place a save result becomes UI. `download` is the no-File-System-
   * Access fallback (Safari, Firefox): Save degrades to writing a copy, which is
   * exactly what Export does — so it reuses it rather than duplicating it.
   * `cancelled` is a dismissed picker: nothing happened, so nothing is said.
   */
  const finishSave = (result: ProjectSaveResult) => {
    if (result.ok === false) {
      report(result.message);
      return;
    }
    if (result.destination === 'download') {
      runExport();
      return;
    }
    if (result.destination !== 'cancelled') report(null);
  };

  const runSave = async () => finishSave(await saveProject());
  const runSaveAs = async () => finishSave(await saveProjectAsLocal());
  const runSaveAsToDrive = async (name: string) => finishSave(await saveAsToDrive(name));

  const runOpenFromDrive = async (fileId: string) => {
    setBrowser(null);
    await openFromDrive(fileId);
  };

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
    const parsed = parseProjectFile(await readFileAsText(file));
    if (parsed.ok === false) {
      report(parsed.message);
      return;
    }
    const result = await openProjectFile(parsed.body);
    if (result.ok === false && result.error !== 'unavailable') report(result.message);
  };

  /**
   * The writable open, and the whole reason Save can overwrite: the picker
   * hands back a handle, the handle is read for the parse and then KEPT as the
   * source. `unavailable` falls through to the `<input>`, which yields a
   * read-only File and therefore an untitled project — the honest degradation,
   * not a silent one. `cancelled` does nothing at all.
   */
  const runOpenLocal = async () => {
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
  };

  const choose = (action: ProjectMenuAction) => {
    if (replacesProject(action)) {
      setConfirming(action);
      return;
    }
    if (action === 'export') {
      runExport();
      return;
    }
    if (action === 'save') {
      void runSave();
      return;
    }
    if (action === 'disconnect-drive') {
      // No confirm: it costs no work. The body, the autosaved slot and the
      // local session are untouched — only the Drive pointer and the token go.
      void disconnectDrive();
      return;
    }
    setChoosingTarget(true);
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
      <Wordmark textClassName={textClassName} ariaLabel="Project menu" />
      <ul
        // daisyUI's dropdown holds itself open on :focus-within, so the panel
        // must be focusable or the menu closes the moment a pointer-down lands
        // inside it. It is a plain container, not a control; the <li><button>
        // rows inside are what the keyboard actually reaches.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="dropdown-content menu menu-sm z-50 mt-2 w-44 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
      >
        {visibleMenuActions(driveAvailable, driveSignedIn).map(({ action, label, icon: Icon }) => (
          <li key={action}>
            <button type="button" id={`project-menu-${action}`} onClick={() => choose(action)}>
              <Icon className="w-4 h-4" aria-hidden="true" />
              {label}
            </button>
          </li>
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
      {choosingTarget && (
        <SaveAsTargetDialog
          open
          driveAvailable={driveAvailable}
          onClose={() => setChoosingTarget(false)}
          onLocal={() => {
            setChoosingTarget(false);
            void runSaveAs();
          }}
          onDrive={() => {
            setChoosingTarget(false);
            setBrowser('save-as');
          }}
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
    </div>
  );
}
