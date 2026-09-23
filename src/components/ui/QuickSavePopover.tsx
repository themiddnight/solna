import React from "react";
import { Bookmark } from "lucide-react";
import { useQuickSavePopover } from "./useQuickSavePopover";

export { isDismissKey, popupShift } from "./useQuickSavePopover";

/** The trigger button a call site hands the popover; it renders it, so the
 * `dropdown` wrapper and the panel share one anchor point (R328). */
interface QuickSaveTrigger {
  id: string;
  label: string;
  icon: React.ReactNode;
  className: string;
  title: string;
}

interface QuickSavePopoverProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  trigger: QuickSaveTrigger;
  heading: string;
  placeholder: string;
  saveLabel: string;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  categories?: { id: string; label: string }[];
  category?: string;
  onCategoryChange?: (category: string) => void;
}

function QuickSaveTriggerButton({
  trigger,
  open,
  onOpen,
  onClose,
}: {
  trigger: QuickSaveTrigger;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <button
      id={trigger.id}
      type="button"
      onClick={open ? onClose : onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={trigger.title}
      className={trigger.className}
    >
      {trigger.icon}
      <span className="hidden sm:inline">{trigger.label}</span>
    </button>
  );
}

function QuickSavePanel({
  panelRef,
  inputRef,
  shift,
  heading,
  placeholder,
  saveLabel,
  name,
  onNameChange,
  onSubmit,
  categories,
  category,
  onCategoryChange,
  onClose,
}: Pick<
  QuickSavePopoverProps,
  | 'heading'
  | 'placeholder'
  | 'saveLabel'
  | 'name'
  | 'onNameChange'
  | 'onSubmit'
  | 'categories'
  | 'category'
  | 'onCategoryChange'
  | 'onClose'
> & {
  panelRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  shift: number;
}) {
  return (
    <div
      ref={panelRef}
      style={shift ? { transform: `translateX(${shift}px)` } : undefined}
      className="dropdown-content z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] card bg-base-100 border border-primary/40 p-3.5 shadow-xl animate-fade-in"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-base-content mb-2">
        <Bookmark className="w-4 h-4 text-primary" />
        <span>{heading}</span>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="text"
          required
          placeholder={placeholder}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="input input-sm w-full"
        />
        {categories && onCategoryChange && (
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="select select-sm w-full"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-sm btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-primary">
            {saveLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function QuickSavePopover({
  open,
  onOpen,
  onClose,
  trigger,
  heading,
  placeholder,
  saveLabel,
  name,
  onNameChange,
  onSubmit,
  categories,
  category,
  onCategoryChange,
}: QuickSavePopoverProps) {
  const { wrapperRef, panelRef, inputRef, shift } = useQuickSavePopover(open, onClose);

  return (
    <div ref={wrapperRef} className={`dropdown dropdown-end${open ? ' dropdown-open' : ''}`}>
      <QuickSaveTriggerButton trigger={trigger} open={open} onOpen={onOpen} onClose={onClose} />
      {open && (
        <QuickSavePanel
          panelRef={panelRef}
          inputRef={inputRef}
          shift={shift}
          heading={heading}
          placeholder={placeholder}
          saveLabel={saveLabel}
          name={name}
          onNameChange={onNameChange}
          onSubmit={onSubmit}
          categories={categories}
          category={category}
          onCategoryChange={onCategoryChange}
          onClose={onClose}
        />
      )}
    </div>
  );
}
