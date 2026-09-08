interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
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

export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
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
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={className}
      title={title}
      onDoubleClick={onDoubleClick}
      aria-label={ariaLabel}
    />
  );
}
