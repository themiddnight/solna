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
    />
  );
}
