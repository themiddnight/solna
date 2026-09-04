import React, { useEffect, useRef } from "react";
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
  // The two popovers differ in their form/input/button classes: the synth
  // variant is wider (max-w-xl, wrap-capable) and gives the name input a
  // min-w-[140px]. Defaults are the shared daisyUI chrome; every override is
  // appended or replaced verbatim.
  formClassName?: string;
  inputClassName?: string;
  selectClassName?: string;
  buttonClassName?: string;
}

/**
 * Escape dismisses the popover. Exported because the key rule is the only part
 * of the dismissal that can be tested here — this runner has no DOM, so the
 * listener that calls it cannot be exercised.
 */
export function isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean {
  return e.key === 'Escape';
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
  inputClassName = "input input-sm flex-1",
  selectClassName = "select select-sm",
  buttonClassName = "",
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Recorded before focus moves. The popover is a plain card, not a
    // <dialog>, so the platform does nothing for it: without this the user is
    // dropped at the top of the document when the popover closes, several tab
    // stops away from the button they opened it with.
    triggerRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      // The popover overlays a page full of shortcut-bound keys; stopping here
      // keeps Escape from also reaching a transport or keyboard handler.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="card bg-base-100 border border-primary/40 p-3.5 flex flex-row flex-wrap items-center justify-between gap-3 shadow-xl animate-fade-in">
      <div className="flex items-center gap-2 text-xs font-semibold text-base-content">
        <Bookmark className="w-4 h-4 text-primary" />
        <span>{heading}</span>
      </div>
      <form onSubmit={onSubmit} className={formClassName}>
        <input
          ref={inputRef}
          type="text"
          required
          placeholder={placeholder}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className={inputClassName}
        />
        {categories && onCategoryChange && (
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className={selectClassName}
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
          className={['btn btn-sm btn-primary shrink-0', buttonClassName]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={['btn btn-sm btn-ghost shrink-0', buttonClassName]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()}
        >
          Cancel
        </button>
      </form>
    </div>
  );
};
