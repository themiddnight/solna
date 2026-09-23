/**
 * The four members `syncDialogOpen` touches. `HTMLDialogElement` satisfies it
 * structurally, and so does a plain object — which is what makes this testable
 * in a runner with no DOM.
 */
export interface DialogHandle {
  open: boolean;
  show(): void;
  showModal(): void;
  close(): void;
}

/**
 * Brings a native `<dialog>` in line with a React `open` prop.
 *
 * `showModal()` — not the `modal-open` class — is what gives a modal dialog its
 * focus trap, its Escape handling and its top-layer stacking; all four dialogs
 * in this app used the class and had none of the three. A non-modal dialog
 * (`modal: false`, the transport sheet) opens with `show()` instead: no
 * backdrop, no top layer, the page behind it stays interactive. Calling either
 * on an already-open dialog throws `InvalidStateError`, and the effect that
 * calls this re-runs on every render, so both no-op branches are load-bearing.
 */
export function syncDialogOpen(el: DialogHandle | null, open: boolean, modal = true): void {
  if (!el) return;
  if (open && !el.open) {
    if (modal) el.showModal();
    else el.show();
  } else if (!open && el.open) el.close();
}
