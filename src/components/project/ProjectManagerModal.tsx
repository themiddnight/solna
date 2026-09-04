import React, { useEffect, useRef, useState } from 'react';
import { Download, FilePlus, Save, Upload } from 'lucide-react';
import { useLiveStore } from '../ui/useLiveStore';
import { SECTION_HEADER } from '../ui/fieldClasses';
import { Modal } from '../ui/Modal';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject, unknownLibraryReferences } from '../../store/projectFile';
import type { ProjectBody } from '../../store/projectFormat';
import { downloadTextFile, projectFileName, readFileAsText } from '../../utils/projectFileIO';
import { ProjectList } from './ProjectList';
import { DeleteConfirmDialog, DirtyGuardDialog, ImportConflictDialog, NamePromptDialog } from './ProjectDialogs';
import {
  NO_DIALOG,
  exportSessionDialog,
  guardAction,
  importDialog,
  importResultNotice,
  nameDefault,
  saveDialog,
  sessionLabel,
  storageDisabled,
  type FlowDialog,
  type ImportMode,
  type PendingAction,
} from './projectManagerFlow';

const EXPORT_TIP = 'Export the session to keep your work';

export const ProjectManagerModal: React.FC = () => {
  const isOpen = useLiveStore((s) => s.isProjectManagerOpen);
  const setIsOpen = useLiveStore((s) => s.setIsProjectManagerOpen);
  const currentProjectId = useLiveStore((s) => s.currentProjectId);
  const currentProjectName = useLiveStore((s) => s.currentProjectName);
  const dirty = useLiveStore((s) => s.dirty);
  const status = useLiveStore((s) => s.projectStoreStatus);
  const projectList = useLiveStore((s) => s.projectList);
  const notice = useLiveStore((s) => s.projectNotice);
  const setNotice = useLiveStore((s) => s.setProjectNotice);
  const refreshProjects = useLiveStore((s) => s.refreshProjects);
  const newProject = useLiveStore((s) => s.newProject);
  const openProject = useLiveStore((s) => s.openProject);
  const saveProject = useLiveStore((s) => s.saveProject);
  const saveProjectAs = useLiveStore((s) => s.saveProjectAs);
  const renameProject = useLiveStore((s) => s.renameProject);
  const deleteProject = useLiveStore((s) => s.deleteProject);
  const importProject = useLiveStore((s) => s.importProject);
  const exportStoredProject = useLiveStore((s) => s.exportStoredProject);
  const buildSessionExport = useLiveStore((s) => s.buildSessionExport);

  const [dialog, setDialog] = useState<FlowDialog>(NO_DIALOG);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Availability and the current name are resolved lazily, on first open.
  // A notice from a previous visit (e.g. a failed Delete) must not resurface.
  useEffect(() => {
    if (isOpen) {
      setNotice(null);
      void refreshProjects();
    }
  }, [isOpen, refreshProjects, setNotice]);

  if (!isOpen) return null;

  const disabled = storageDisabled(status);
  const close = () => { setDialog(NO_DIALOG); setIsOpen(false); };
  const report = (message: string | null) => setNotice(message);

  /** Open never has warnings to show, so it always closes on success. */
  const runOpen = async (id: string) => {
    const r = await openProject(id);
    if (r.ok === false) { report(r.message); return; }
    close();
  };

  /**
   * Import may have something the user needs to see — an unavailable-storage
   * caveat, unrecognised references, or both — in which case the project is
   * still installed into the session but the modal stays open so the notice
   * is reachable (closing would unmount it).
   */
  const runImport = async (body: ProjectBody, mode: ImportMode) => {
    const r = await importProject(body, mode);
    if (r.ok === false) { report(r.message); return; }
    const message = importResultNotice(unknownLibraryReferences(body.content), r.value === null);
    report(message);
    if (message === null) close(); else setDialog(NO_DIALOG);
  };

  const runAction = async (action: PendingAction) => {
    setDialog(NO_DIALOG);
    if (action.kind === 'new') { newProject(); return; }
    if (action.kind === 'open') { await runOpen(action.id); return; }
    await runImport(action.body, action.mode);
  };

  /** The full Save path: prompt for a name when there is no current project. */
  const save = async (then: PendingAction | null) => {
    const next = saveDialog(currentProjectId, then);
    if (next.kind !== 'none') { setDialog(next); return; }
    const r = await saveProject();
    if (r.ok === false) { report(r.message); setDialog(NO_DIALOG); return; } // the original action is abandoned
    report(null);
    if (then) await runAction(then); else setDialog(NO_DIALOG);
  };

  const requestAction = (action: PendingAction) => {
    const next = guardAction(dirty, action);
    if (next.kind === 'none') void runAction(action); else setDialog(next);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseProjectFile(await readFileAsText(file));
    if (parsed.ok === false) { report(parsed.message); return; }
    const next = importDialog(parsed.body, projectList, dirty);
    if (next.kind === 'none') void runAction({ kind: 'import', body: parsed.body, mode: 'new' }); else setDialog(next);
  };

  const download = (body: ProjectBody) => downloadTextFile(projectFileName(body.name), serializeProject(body), PROJECT_FILE_MIME);

  const exportRow = async (id: string) => {
    const r = await exportStoredProject(id);
    if (r.ok === false) { report(r.message); return; }
    download(r.value);
  };

  const exportSession = () => {
    const next = exportSessionDialog(currentProjectId, currentProjectName, projectList);
    if (next.kind === 'none') { download(buildSessionExport('', Date.now())); return; }
    setDialog(next);
  };

  const onNameConfirmed = async (name: string) => {
    if (dialog.kind !== 'name-prompt') return;
    const { purpose, then } = dialog;
    if (purpose === 'export-session') { download(buildSessionExport(name, Date.now())); setDialog(NO_DIALOG); return; }
    const r = await saveProjectAs(name);
    if (r.ok === false) { report(r.message); setDialog(NO_DIALOG); return; }
    report(null);
    if (then) await runAction(then); else setDialog(NO_DIALOG);
  };

  return (
    <>
      <Modal open onClose={close} size="lg" boxClassName="space-y-6" title="Projects">
        {disabled && (
          <div role="alert" className="alert alert-warning text-sm">
            Project storage is unavailable on this device (private browsing or blocked site storage). Export still works.
          </div>
        )}
        {notice && (
          <div role="status" className="alert text-sm">
            <span className="flex-1">{notice}</span>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => report(null)}>Dismiss</button>
          </div>
        )}

        <section className="space-y-2">
          <h3 className={SECTION_HEADER}>Current session</h3>
          <p className="font-semibold">
            {sessionLabel(currentProjectId, currentProjectName)}
            {dirty && <span className="ml-2 badge badge-sm badge-warning">Unsaved changes</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            <div className={disabled ? 'tooltip' : ''} data-tip={disabled ? EXPORT_TIP : undefined}>
              <button type="button" className="btn btn-sm btn-primary gap-1" disabled={disabled} onClick={() => void save(null)}><Save className="w-4 h-4" />Save</button>
            </div>
            <div className={disabled ? 'tooltip' : ''} data-tip={disabled ? EXPORT_TIP : undefined}>
              <button type="button" className="btn btn-sm gap-1" disabled={disabled} onClick={() => setDialog({ kind: 'name-prompt', purpose: 'save-copy', initial: nameDefault('save-copy', currentProjectName), then: null })}>Save as new copy</button>
            </div>
            <button type="button" className="btn btn-sm gap-1" onClick={() => requestAction({ kind: 'new' })}><FilePlus className="w-4 h-4" />New</button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className={SECTION_HEADER}>Import</h3>
          <button id="project-import-button" type="button" className="btn btn-sm gap-1" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4" />Import .solna file</button>
          <input ref={fileInputRef} type="file" accept={PROJECT_FILE_ACCEPT} className="hidden" onChange={(e) => void onImportFile(e)} />
        </section>

        <section className="space-y-2">
          <h3 className={SECTION_HEADER}>Projects on this device</h3>
          <ProjectList
            projects={projectList}
            currentProjectId={currentProjectId}
            now={Date.now()}
            disabled={disabled}
            onOpen={(id) => requestAction({ kind: 'open', id })}
            onRename={(id, name) => void renameProject(id, name).then((r) => { if (r.ok === false) report(r.message); })}
            onExport={(id) => void exportRow(id)}
            onDelete={(project) => setDialog({ kind: 'delete-confirm', project })}
          />
        </section>

        <section className="border-t border-base-300 pt-4">
          <p className="text-xs text-base-content/60 mb-2">Writes what you are hearing right now, including unsaved edits. A row's Export writes the file as last saved.</p>
          <button id="project-export-session" type="button" className="btn btn-sm btn-outline gap-1" onClick={exportSession}><Download className="w-4 h-4" />Export current session</button>
        </section>
      </Modal>

      {dialog.kind === 'dirty-guard' && (
        <DirtyGuardDialog
          onDiscard={() => void runAction(dialog.next)}
          onCancel={() => setDialog(NO_DIALOG)}
          onSaveAndContinue={() => void save(dialog.next)}
        />
      )}
      {dialog.kind === 'name-prompt' && (
        <NamePromptDialog
          title={dialog.purpose === 'export-session' ? 'Export current session' : dialog.purpose === 'save-copy' ? 'Save as new copy' : 'Save project'}
          initial={dialog.initial}
          confirmLabel={dialog.purpose === 'export-session' ? 'Export' : 'Save'}
          onConfirm={(name) => void onNameConfirmed(name)}
          onCancel={() => setDialog(NO_DIALOG)}
        />
      )}
      {dialog.kind === 'delete-confirm' && (
        <DeleteConfirmDialog
          name={dialog.project.name}
          onConfirm={() => void deleteProject(dialog.project.id).then((r) => { setDialog(NO_DIALOG); if (r.ok === false) report(r.message); })}
          onCancel={() => setDialog(NO_DIALOG)}
        />
      )}
      {dialog.kind === 'import-conflict' && (
        <ImportConflictDialog
          existing={dialog.existing}
          incoming={dialog.body}
          onOverwrite={() => { const next = guardAction(dirty, { kind: 'import', body: dialog.body, mode: 'overwrite' }); if (next.kind === 'none') void runAction({ kind: 'import', body: dialog.body, mode: 'overwrite' }); else setDialog(next); }}
          onCopy={() => { const next = guardAction(dirty, { kind: 'import', body: dialog.body, mode: 'copy' }); if (next.kind === 'none') void runAction({ kind: 'import', body: dialog.body, mode: 'copy' }); else setDialog(next); }}
          onCancel={() => setDialog(NO_DIALOG)}
        />
      )}
    </>
  );
};
