/**
 * The confirmation a loop delete leaves behind: the loop's label and an Undo
 * button. Presentational only — ArrangeView owns the timer and the restore, so
 * this renders the same under `renderToString` as in the browser.
 */
export function LoopUndoToast({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div className="toast toast-bottom toast-center z-30 animate-fade-in">
      <div role="status" className="alert alert-info alert-soft py-1.5 px-3 text-xs gap-3">
        <span>{`${label} deleted`}</span>
        <button id="btn-undo-loop-delete" type="button" className="btn btn-xs" onClick={onUndo}>
          Undo
        </button>
      </div>
    </div>
  );
}
