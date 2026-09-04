/**
 * The three members `syncDialogOpen` touches. `HTMLDialogElement` satisfies it
 * structurally, and so does a plain object — which is what makes this testable
 * in a runner with no DOM.
 */
export interface DialogHandle {
  open: boolean;
  showModal(): void;
  close(): void;
}

/**
 * Brings a native `<dialog>` in line with a React `open` prop.
 *
 * `showModal()` — not the `modal-open` class — is what gives the dialog its
 * focus trap, its Escape handling and its top-layer stacking; all four dialogs
 * in this app used the class and had none of the three. Calling `showModal()`
 * on an already-open dialog throws `InvalidStateError`, and the effect that
 * calls this re-runs on every render, so both no-op branches are load-bearing.
 */
export function syncDialogOpen(el: DialogHandle | null, open: boolean): void {
  if (!el) return;
  if (open && !el.open) el.showModal();
  else if (!open && el.open) el.close();
}
