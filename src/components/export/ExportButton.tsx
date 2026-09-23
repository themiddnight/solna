import { Download } from 'lucide-react';
import { EXPORT_KINDS } from '@/store/exportKinds';
import { MenuRowButton, type ToolVariantProps } from '@/components/ui/MenuRowButton';
import { ExportDialog } from './ExportDialog';
import { useExportDialog, type ExportTriggerView } from './useExportDialog';

function ExportTriggerIcon({ busy }: { busy: boolean }) {
  return busy
    ? <span className="loading loading-spinner loading-sm" aria-hidden="true" />
    : <Download className="w-4 h-4" aria-hidden="true" />;
}

/**
 * Never disabled: while a job runs it is the way back into the dialog, where
 * the user can watch or cancel. Starting twice is prevented by the dialog's
 * disabled rows and by `startExport` itself (R292).
 */
function ExportTrigger({ trigger, onOpen }: { trigger: ExportTriggerView; onOpen: () => void }) {
  return (
    <button id="btn-export" type="button" className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"
      aria-haspopup="dialog" aria-label={trigger.ariaLabel} title={trigger.ariaLabel}
      aria-busy={trigger.busy} onClick={onOpen}>
      <ExportTriggerIcon busy={trigger.busy} />
      {trigger.text !== null && (
        <span className={trigger.busy ? 'tabular-nums' : 'hidden lg:inline'}>{trigger.text}</span>
      )}
    </button>
  );
}

/** The menu-row trigger: same id and dialog semantics, a visible label for a touch menu. */
function ExportRowTrigger({ trigger, onOpen }: { trigger: ExportTriggerView; onOpen: () => void }) {
  return (
    <MenuRowButton id="btn-export" aria-haspopup="dialog" aria-busy={trigger.busy}
      label={trigger.busy ? trigger.ariaLabel : 'Export'}
      icon={<ExportTriggerIcon busy={trigger.busy} />}
      onClick={onOpen} />
  );
}

/**
 * The export feature's root: a song-layer Header tool whose `HEADER_TOOLS`
 * row (`header/headerTools.ts`) is its only layer gate (R317).
 *
 * `variant="row"` is the mobile menu's form; the dialog renders beside either trigger.
 */
export function ExportButton({ variant = 'bar' }: ToolVariantProps) {
  const d = useExportDialog();
  return (
    <>
      {variant === 'row'
        ? <ExportRowTrigger trigger={d.trigger} onOpen={d.openDialog} />
        : <ExportTrigger trigger={d.trigger} onOpen={d.openDialog} />}
      <ExportDialog open={d.open} onClose={d.closeDialog} kinds={EXPORT_KINDS} busy={d.busy}
        status={d.status} onStart={d.start} onCancel={d.cancel} />
    </>
  );
}
