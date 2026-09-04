import React, { useEffect, useRef, useState } from 'react';
import type { ProjectMeta } from '../../store/projectFormat';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { isValidProjectName } from './projectManagerFlow';

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
    <Modal open onClose={onCancel} title={title} boxClassName="space-y-4">
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
    </Modal>
  );
};

export const DirtyGuardDialog: React.FC<{
  onDiscard: () => void;
  onCancel: () => void;
  onSaveAndContinue: () => void;
}> = ({ onDiscard, onCancel, onSaveAndContinue }) => (
  <Modal open onClose={onCancel} title="Unsaved changes" boxClassName="space-y-4">
    <p className="text-sm">This session has unsaved changes. Save them before continuing?</p>
    <div className="modal-action">
      <button type="button" className="btn btn-ghost text-error" onClick={onDiscard}>Discard</button>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- Cancel is the safe initial focus target for a dialog raised by an action that would lose work. */}
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={onSaveAndContinue}>Save &amp; Continue</button>
    </div>
  </Modal>
);

export const DeleteConfirmDialog: React.FC<{ name: string; onConfirm: () => void; onCancel: () => void }> = ({ name, onConfirm, onCancel }) => (
  <ConfirmDialog
    title="Delete project"
    message={<>Delete <strong>{name}</strong>? This cannot be undone.</>}
    confirmLabel="Delete"
    danger
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export const ImportConflictDialog: React.FC<{
  existing: ProjectMeta;
  incoming: ProjectMeta;
  onOverwrite: () => void;
  onCopy: () => void;
  onCancel: () => void;
}> = ({ existing, incoming, onOverwrite, onCopy, onCancel }) => (
  <Modal open onClose={onCancel} title="Import project" boxClassName="space-y-4">
    <p className="text-sm">A project with this id already exists.</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="opacity-60">existing</dt>
      <dd>{existing.name} — {new Date(existing.updatedAt).toLocaleString()}</dd>
      <dt className="opacity-60">in file</dt>
      <dd>{incoming.name} — {new Date(incoming.updatedAt).toLocaleString()}</dd>
    </dl>
    <div className="modal-action">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- Cancel is the safe initial focus target for a dialog raised by an action that would lose work. */}
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn" onClick={onCopy}>Import as Copy</button>
      <button type="button" className="btn btn-error" onClick={onOverwrite}>Overwrite</button>
    </div>
  </Modal>
);
