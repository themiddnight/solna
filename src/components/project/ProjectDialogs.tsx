import React, { useEffect, useRef, useState } from 'react';
import type { ProjectMeta } from '../../store/projectFormat';
import { isValidProjectName } from './projectManagerFlow';

/** Shared shell: a daisyUI modal stacked above the manager (MidiSettingsModal pattern). */
const Shell: React.FC<{ title: string; onCancel: () => void; children: React.ReactNode }> = ({ title, onCancel, children }) => (
  <dialog className="modal modal-open" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
    <div className="modal-box max-w-md bg-base-100 border border-base-300 shadow-2xl space-y-4">
      <h3 className="font-bold text-lg">{title}</h3>
      {children}
    </div>
    <form method="dialog" className="modal-backdrop">
      <button type="button" onClick={onCancel}>close</button>
    </form>
  </dialog>
);

export const NamePromptDialog: React.FC<{
  title: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}> = ({ title, initial, confirmLabel, onConfirm, onCancel }) => {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const valid = isValidProjectName(name);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (valid) onConfirm(name.trim());
  };
  return (
    <Shell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          aria-invalid={!valid}
          className={`input w-full ${valid ? '' : 'input-error'}`}
        />
        {!valid && <p className="text-xs text-error">A name is required.</p>}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>{confirmLabel}</button>
        </div>
      </form>
    </Shell>
  );
};

export const DirtyGuardDialog: React.FC<{
  onDiscard: () => void;
  onCancel: () => void;
  onSaveAndContinue: () => void;
}> = ({ onDiscard, onCancel, onSaveAndContinue }) => (
  <Shell title="Unsaved changes" onCancel={onCancel}>
    <p className="text-sm">This session has unsaved changes. Save them before continuing?</p>
    <div className="modal-action">
      <button type="button" className="btn btn-ghost text-error" onClick={onDiscard}>Discard</button>
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={onSaveAndContinue}>Save &amp; Continue</button>
    </div>
  </Shell>
);

export const DeleteConfirmDialog: React.FC<{ name: string; onConfirm: () => void; onCancel: () => void }> = ({ name, onConfirm, onCancel }) => (
  <Shell title="Delete project" onCancel={onCancel}>
    <p className="text-sm">Delete <strong>{name}</strong>? This cannot be undone.</p>
    <div className="modal-action">
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn btn-error" onClick={onConfirm}>Delete</button>
    </div>
  </Shell>
);

export const ImportConflictDialog: React.FC<{
  existing: ProjectMeta;
  incoming: ProjectMeta;
  onOverwrite: () => void;
  onCopy: () => void;
  onCancel: () => void;
}> = ({ existing, incoming, onOverwrite, onCopy, onCancel }) => (
  <Shell title="Import project" onCancel={onCancel}>
    <p className="text-sm">A project with this id already exists.</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="opacity-60">existing</dt>
      <dd>{existing.name} — {new Date(existing.updatedAt).toLocaleString()}</dd>
      <dt className="opacity-60">in file</dt>
      <dd>{incoming.name} — {new Date(incoming.updatedAt).toLocaleString()}</dd>
    </dl>
    <div className="modal-action">
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn" onClick={onCopy}>Import as Copy</button>
      <button type="button" className="btn btn-error" onClick={onOverwrite}>Overwrite</button>
    </div>
  </Shell>
);
