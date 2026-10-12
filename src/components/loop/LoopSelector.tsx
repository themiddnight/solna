import React from 'react';
import { loadLoop } from '@/store/loadLoop';
import { loopLabel } from '@/store/loop';
import { useAppStore } from '@/store/store';
import { FIELD_LABEL, GROUP_LABEL, HEADER_FIELD_SHELL, HEADER_SELECT } from '../ui/fieldClasses';
import { Modal } from '../ui/Modal';
import { useLoopRename } from './useLoopRename';
import type { UseLoopRename } from './useLoopRename';

/**
 * The value of the picker's Rename action. A loop id is never blank:
 * `newLoopId` always writes one and `sanitizeLoops` replaces a blank id on
 * load, so this cannot name a loop.
 */
export const RENAME_LOOP_VALUE = '';

/**
 * Pure handler behind the dropdown, exported for a store-driven test. The
 * Rename action asks for the dialog and leaves the active loop alone; any
 * other value is a loop id.
 */
export const onSelectLoop = (value: string, openRename: () => void) => {
  if (value === RENAME_LOOP_VALUE) openRename();
  else loadLoop(value);
};

/** The dialog behind `Rename loop…`: one name input, Cancel and Rename pinned in the footer (R339). */
export function LoopRenameModal({ rename }: { rename: UseLoopRename }) {
  const { isOpen, formId, inputRef, draft, placeholder, setDraft, cancel, submit } = rename;
  return (
    <Modal
      open={isOpen}
      onClose={cancel}
      size="sm"
      title="Rename loop"
      footer={
        <div className="modal-action">
          <button type="button" onClick={cancel} className="btn btn-sm btn-ghost">
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-sm btn-primary">
            Rename
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit}>
        <label className={FIELD_LABEL} htmlFor={`${formId}-name`}>Name</label>
        <input
          id={`${formId}-name`}
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="input input-sm w-full"
        />
      </form>
    </Modal>
  );
}

/**
 * The loop picker, shown in the header on the loop layer. Picking calls the
 * same atomic loadLoop swap as the Arrange tab, so it changes WHICH loop the
 * editing tabs target. After the loops, set apart by a rule, it offers
 * `Rename loop…` (UX F-10: newcomers open the picker looking for a rename).
 * That entry is an action, not a loop: the select stays controlled by
 * `activeLoopId`, so choosing it shows the active loop again and opens a
 * `Modal`. Saving stays in the project menu (R295, R317).
 *
 * It carries its own caption, in the same shell the key/scale pair wears: a
 * bare ghost select in the navbar showed a loop NAME with nothing saying it was
 * a loop, which read as a label rather than a control. The caption shows at
 * every width (UX F-10): on the phone it used to drop, and the header then
 * showed a bare name that read as a title. The room for it comes from the
 * wordmark, whose text hides below `sm` (Wordmark.tsx), so the select keeps
 * `w-32` from 360px up; only a 320px phone narrows it to `w-24`, where the
 * shell would otherwise run over the wordmark (measured, review 4123990330).
 * The rename entry lives in the option list for that reason: a button beside
 * the field has no room at 360px.
 */
export function LoopSelector() {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  const rename = useLoopRename();
  return (
    <>
      <div className={HEADER_FIELD_SHELL}>
        <span className={GROUP_LABEL}>Loop</span>
        <select
          id="select-loop"
          value={activeLoopId}
          onChange={(e) => onSelectLoop(e.target.value, rename.open)}
          className={`${HEADER_SELECT} text-primary w-24 min-[360px]:w-32`}
          title="Active Loop"
        >
          {loops.map((loop) => (
            <option key={loop.id} value={loop.id}>
              {loopLabel(loop)}
            </option>
          ))}
          <hr />
          <option value={RENAME_LOOP_VALUE}>Rename loop…</option>
        </select>
      </div>
      <LoopRenameModal rename={rename} />
    </>
  );
}
