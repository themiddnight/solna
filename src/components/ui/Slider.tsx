interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  title?: string;
}

export function Slider({ id, value, min, max, step = 1, onChange, className = 'w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500', title }: SliderProps) {
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
