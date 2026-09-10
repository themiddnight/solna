import React, { useRef, useState } from 'react';
import { Download, FilePlus, Upload } from 'lucide-react';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject } from '@/store/projectFile';
import { downloadTextFile, projectFileName, readFileAsText } from '@/utils/projectFileIO';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveStore } from '../ui/useLiveStore';
import { Wordmark } from '../ui/Wordmark';

export type ProjectMenuAction = 'open' | 'export' | 'new';

/** Open and New replace the one autosaved project; Export never touches it. */
export const PROJECT_MENU_ACTIONS: ReadonlyArray<{
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}> = [
  { action: 'open', label: 'Open .solna', icon: Upload },
  { action: 'export', label: 'Export .solna', icon: Download },
  { action: 'new', label: 'New project', icon: FilePlus },
];

export const REPLACE_CONFIRM_MESSAGE =
  'This replaces your current project. It is autosaved, so the one you are editing now will be gone.';

/**
 * The wordmark IS the project menu. There is no project list any more, so the
 * brand mark is the one place a project-level action can live, and it is
 * present on both layers because a project spans the whole app.
 *
 * Open and New both replace the single autosaved project, which is destructive
 * and irreversible once the slot is overwritten, so both pass through one
 * confirm. Export is the manual save-to-file action and needs none.
 */
export function ProjectMenu({ textClassName }: { textClassName?: string }) {
  const [confirming, setConfirming] = useState<ProjectMenuAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openProjectFile = useLiveStore((s) => s.openProjectFile);
  const exportProjectFile = useLiveStore((s) => s.exportProjectFile);
  const newProject = useLiveStore((s) => s.newProject);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);

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

  const choose = (action: ProjectMenuAction) => {
    if (action === 'export') {
      runExport();
      return;
    }
    setConfirming(action);
  };

  const confirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === 'open') fileInputRef.current?.click();
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
        {PROJECT_MENU_ACTIONS.map(({ action, label, icon: Icon }) => (
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
      {confirming && (
        <ConfirmDialog
          title={confirming === 'open' ? 'Open a project file' : 'Start a new project'}
          message={REPLACE_CONFIRM_MESSAGE}
          confirmLabel={confirming === 'open' ? 'Choose a file' : 'New project'}
          onConfirm={confirmReplace}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
