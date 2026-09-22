/**
 * One timed-Undo alert (loop delete, batch key change). Presentational only:
 * the owner holds the timer and the restore. ArrangeView wraps every pending
 * alert in ONE daisyUI `toast` container so two pending Undos stack instead of
 * overlapping.
 */
export function LoopUndoToast({
  message,
  buttonId,
  onUndo,
}: {
  message: string;
  buttonId: string;
  onUndo: () => void;
}) {
  return (
    <div role="status" className="alert alert-info alert-soft py-1.5 px-3 text-xs gap-3">
      <span>{message}</span>
      <button id={buttonId} type="button" className="btn btn-xs" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
