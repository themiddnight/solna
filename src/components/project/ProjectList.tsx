import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { ProjectMeta } from '../../store/projectFormat';
import { formatRelativeTime } from '../../utils/relativeTime';
import { isValidProjectName } from './projectManagerFlow';

export interface ProjectListProps {
  projects: ProjectMeta[];
  currentProjectId: string | null;
  now: number;
  disabled: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onExport: (id: string) => void;
  onDelete: (project: ProjectMeta) => void;
}

/** Click the name to rename in place. Enter/blur commit, Escape cancels. */
const InlineName: React.FC<{ name: string; disabled: boolean; onCommit: (name: string) => void }> = ({ name, disabled, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (isValidProjectName(next) && next !== name) onCommit(next);
    else setDraft(name);
  };
  if (!editing) {
    return (
      <button
        type="button"
        className="text-left font-semibold truncate hover:underline disabled:no-underline"
        title="Click to rename"
        disabled={disabled}
        onClick={() => { setDraft(name); setEditing(true); }}
      >
        {name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      aria-label="Project name"
      className="input input-sm w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(name); setEditing(false); }
      }}
    />
  );
};

export const ProjectList: React.FC<ProjectListProps> = ({ projects, currentProjectId, now, disabled, onOpen, onRename, onExport, onDelete }) => {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-base-content/70 rounded-box border border-dashed border-base-300 p-4">
        {disabled ? (
          // Degraded mode: Save is disabled, so pointing at it would send the
          // user to a button that cannot be pressed. Name the two paths that
          // still work.
          <>This device cannot store projects. You can still <strong>Import</strong> a <code>.solna</code> file, or <strong>Export current session</strong> to keep this work as a file.</>
        ) : (
          <>The current session is not yet a project. Use <strong>Save</strong> above to keep it on this device, or import a <code>.solna</code> file.</>
        )}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-base-300 rounded-box border border-base-300">
      {projects.map((p) => (
        <li key={p.id} className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <InlineName name={p.name} disabled={disabled} onCommit={(name) => onRename(p.id, name)} />
              {p.id === currentProjectId && <span className="badge badge-sm badge-primary">Current</span>}
            </div>
            <time className="text-xs text-base-content/60" dateTime={new Date(p.updatedAt).toISOString()} title={new Date(p.updatedAt).toLocaleString()}>
              {formatRelativeTime(p.updatedAt, now)}
            </time>
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={disabled} onClick={() => onOpen(p.id)}>Open</button>
          <div className="dropdown dropdown-end">
            <button type="button" tabIndex={0} className="btn btn-sm btn-ghost btn-square" aria-label={`More actions for ${p.name}`} disabled={disabled}>
              <MoreVertical className="w-4 h-4" />
            </button>
            <ul tabIndex={-1} className="dropdown-content menu bg-base-100 rounded-box z-10 w-40 p-2 shadow-sm border border-base-300">
              <li><button type="button" onClick={() => onExport(p.id)}>Export</button></li>
              <li><button type="button" className="text-error" onClick={() => onDelete(p)}>Delete</button></li>
            </ul>
          </div>
        </li>
      ))}
    </ul>
  );
};
