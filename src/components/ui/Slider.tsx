interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /**
   * Fired once when a gesture ENDS with the value the input holds then. A
   * control whose value is persisted previews through `onChange` into local
   * state and commits here, because a pointer drag must never write persisted
   * state on every move. See `commitHandlers` for which events end a gesture.
   */
  onCommit?: (value: number) => void;
  /**
   * Full class list for the <input type="range">. Defaults to
   * 'range range-primary range-xs w-full'. Callers that need another accent
   * pass the whole daisyUI class list, e.g.
   * 'range range-accent range-xs w-16'.
   */
  className?: string;
  title?: string;
  /**
   * Double-click handler. Present so a LEVEL fader can return to unity — the
   * DAW convention — without a second <input type="range"> existing in the
   * app. Optional because most sliders (cutoff, decay, swing) have no home
   * value to return to.
   */
  onDoubleClick?: () => void;
  /**
   * Accessible name, for a control with no associated <label>. Every fader in
   * this app is labelled by an adjacent icon or a heading, neither of which a
   * screen reader ties to the input.
   */
  ariaLabel?: string;
}

/** The element-held flag: the value moved since the last commit. */
interface CommitTarget { value: string; dataset: DOMStringMap }

/**
 * The commit half of a slider. A gesture ends on pointer release or key
 * release, with a cancelled pointer and a blur as backstops for a release the
 * input never sees; any of them commits, but ONLY if `onChange` moved the value
 * since the last commit. That flag is what keeps a Tab keyup (which merely
 * lands focus) from writing a no-op, and a release followed by a blur from
 * committing twice. It lives on the element (`data-moved`), not in a ref, so
 * the component stays hook-free.
 */
function commitHandlers(onChange: (value: number) => void, onCommit?: (value: number) => void) {
  const change = (e: { target: CommitTarget }) => {
    if (onCommit) e.target.dataset.moved = '1';
    onChange(parseFloat(e.target.value));
  };
  if (!onCommit) return { onChange: change };
  const commit = (e: { currentTarget: CommitTarget }) => {
    const input = e.currentTarget;
    if (input.dataset.moved !== '1') return;
    delete input.dataset.moved;
    onCommit(parseFloat(input.value));
  };
  return {
    onChange: change,
    onPointerUp: commit,
    onPointerCancel: commit,
    onKeyUp: commit,
    onBlur: commit,
  };
}

export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  className = 'range range-primary range-xs w-full',
  title,
  onDoubleClick,
  ariaLabel,
}: SliderProps) {
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      {...commitHandlers(onChange, onCommit)}
      className={className}
      title={title}
      onDoubleClick={onDoubleClick}
      aria-label={ariaLabel}
    />
  );
}
