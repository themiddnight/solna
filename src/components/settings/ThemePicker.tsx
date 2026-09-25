import { Check, ChevronDown, Monitor } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { themeChoiceLabel, type ThemeChoice, type ThemeId, type ThemeScheme } from './themes';
import { useThemePicker } from './useThemePicker';

const SCHEME_TABS: readonly { readonly id: ThemeScheme; readonly label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const DOT = 'h-3 w-3 rounded-full border border-base-100';

/** Colour dots painted by whichever theme the nearest `data-theme` names. */
function Swatches({ accent }: { accent: boolean }) {
  return (
    <span className="flex -space-x-1" aria-hidden="true">
      <span className={cx(DOT, 'bg-primary')} />
      <span className={cx(DOT, 'bg-secondary')} />
      {accent && <span className={cx(DOT, 'bg-accent')} />}
    </span>
  );
}

interface ThemeOptionProps {
  id: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
  /** Paints the row in this theme (daisyUI sets the row's colours from `data-theme`); System has none. */
  theme?: ThemeId;
}

function ThemeOption({ id, label, checked, onSelect, theme }: ThemeOptionProps) {
  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={checked}
      data-theme={theme}
      onClick={onSelect}
      className={cx(
        'flex w-full min-h-11 items-center justify-between gap-3 rounded-field px-2 text-left text-sm transition-colors hover:bg-base-300',
        checked && 'ring-1 ring-primary/40',
      )}
    >
      <span className="flex items-center gap-3">
        {theme ? <Swatches accent /> : <Monitor className="w-4 h-4" aria-hidden="true" />}
        <span className="font-medium">{label}</span>
      </span>
      {checked && <Check className="w-4 h-4 text-success" aria-hidden="true" />}
    </button>
  );
}

export interface ThemePickerProps {
  preview: ThemeChoice;
  resolved: ThemeId;
  isPreviewing: boolean;
  onSelect: (choice: ThemeChoice) => void;
  onApply: () => void;
}

/**
 * The Settings tab's theme row, modelled on murva's ThemePicker: a dropdown
 * trigger showing the previewed choice, and Apply. Picking a row previews it
 * at once; only Apply persists (R346).
 */
export function ThemePicker({ preview, resolved, isPreviewing, onSelect, onApply }: ThemePickerProps) {
  const { scheme, selectScheme, themes } = useThemePicker(resolved);
  const label = themeChoiceLabel(preview);
  return (
    <div className="flex items-center gap-2">
      <div className="dropdown flex-1">
        {/* A focusable <span>, not a <button>: see DROPDOWN_TRIGGER_NOTE in ui/BottomInputDock.tsx. */}
        <span
          id="btn-theme-picker"
          role="button"
          tabIndex={0}
          aria-label={`Theme: ${label}`}
          className={cx('btn btn-outline w-full justify-between gap-2 font-normal', isPreviewing && 'border-warning/50')}
        >
          <span className="flex min-w-0 items-center gap-2">
            {isPreviewing && <span className="status status-warning" aria-hidden="true" />}
            <Swatches accent={false} />
            <span className="truncate">{label}</span>
          </span>
          <span className="flex items-center gap-2">
            {isPreviewing && <span className="badge badge-warning badge-sm">Previewing</span>}
            <ChevronDown className="w-4 h-4 opacity-60" aria-hidden="true" />
          </span>
        </span>
        <div
          // Focusable so a tap inside keeps the dropdown's :focus-within
          // (Safari never focuses a tapped <button>). Picking a row does NOT
          // blur, unlike DockMenu: the panel stays open while the user previews.
          tabIndex={0}
          role="radiogroup"
          aria-label="Theme"
          className="dropdown-content z-50 mt-2 w-full space-y-2 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          <ThemeOption
            id="theme-option-system"
            label="System (follows OS)"
            checked={preview === 'system'}
            onSelect={() => onSelect('system')}
          />
          <div role="tablist" aria-label="Scheme" className="tabs tabs-box tabs-sm">
            {SCHEME_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`theme-scheme-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={scheme === tab.id}
                onClick={() => selectScheme(tab.id)}
                className={cx('tab flex-1', scheme === tab.id && 'tab-active')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="max-h-90 space-y-1 overflow-y-auto overscroll-contain">
            {themes.map((entry) => (
              <ThemeOption
                key={entry.id}
                id={`theme-option-${entry.id}`}
                theme={entry.id}
                label={entry.label}
                checked={preview === entry.id}
                onSelect={() => onSelect(entry.id)}
              />
            ))}
          </div>
        </div>
      </div>
      <button id="btn-theme-apply" type="button" className="btn btn-primary" disabled={!isPreviewing} onClick={onApply}>
        Apply
      </button>
    </div>
  );
}
