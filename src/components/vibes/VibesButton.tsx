import { Sparkles } from 'lucide-react';
import { MenuRowButton, type ToolVariantProps } from '@/components/ui/MenuRowButton';
import { VibePickerModal } from './VibePickerModal';
import { prefetchVibePreview, useVibesButton } from './useVibePicker';

const ICON = <Sparkles className="w-4 h-4" aria-hidden="true" />;

/**
 * The only way to the vibes (R333): a loop-layer `HEADER_TOOLS` row. `bar` in
 * the desktop Header, `row` in the phone's menu sheet — where the picker is a
 * dialog nested in the sheet's dialog (R320). Hover/focus warms the preview module.
 */
export function VibesButton({ variant = 'bar' }: ToolVariantProps) {
  const { open, show, hide } = useVibesButton();
  return (
    <>
      {variant === 'row' ? (
        <MenuRowButton id="btn-vibes" aria-haspopup="dialog" label="Vibes" icon={ICON}
          onClick={show} onMouseEnter={prefetchVibePreview} onFocus={prefetchVibePreview} />
      ) : (
        <button id="btn-vibes" type="button" className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"
          aria-haspopup="dialog" aria-label="Vibes" title="Vibes"
          onClick={show} onMouseEnter={prefetchVibePreview} onFocus={prefetchVibePreview}>
          {ICON}
          <span className="hidden lg:inline">Vibes</span>
        </button>
      )}
      <VibePickerModal open={open} onClose={hide} />
    </>
  );
}
