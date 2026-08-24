import React from "react";
import { Bookmark } from "lucide-react";

interface QuickSavePopoverProps {
  open: boolean;
  onClose: () => void;
  heading: string;
  placeholder: string;
  saveLabel: string;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  categories?: { id: string; label: string }[];
  category?: string;
  onCategoryChange?: (category: string) => void;
  // The two original popovers differ in their form/input/button classes: the
  // synth variant is wider (max-w-xl, wrap-capable), gives the name input a
  // min-w-[140px], and its buttons carry cursor-pointer. Defaults match the
  // chord variant exactly.
  formClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
}

export const QuickSavePopover: React.FC<QuickSavePopoverProps> = ({
  open,
  onClose,
  heading,
  placeholder,
  saveLabel,
  name,
  onNameChange,
  onSubmit,
  categories,
  category,
  onCategoryChange,
  formClassName = "flex items-center gap-2 flex-1 max-w-md",
  inputClassName = "flex-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500",
  buttonClassName = "",
}) => {
  if (!open) return null;
  return (
    <div className="bg-[#171B38] border border-indigo-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xl animate-in fade-in">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
        <Bookmark className="w-4 h-4 text-indigo-400" />
        <span>{heading}</span>
      </div>
      <form onSubmit={onSubmit} className={formClassName}>
        <input
          type="text"
          required
          autoFocus
          placeholder={placeholder}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className={inputClassName}
        />
        {categories && onCategoryChange && (
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="bg-[#0B0D19] border border-[#2D355A] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className={`bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors shrink-0${buttonClassName}`}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={`bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#252B48] transition-colors shrink-0${buttonClassName}`}
        >
          Cancel
        </button>
      </form>
    </div>
  );
};
