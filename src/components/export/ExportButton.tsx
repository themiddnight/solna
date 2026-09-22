import { Download } from 'lucide-react';
import type { Layer } from '@/types';
import { EXPORT_KINDS } from '@/store/exportKinds';
import { ExportDialog } from './ExportDialog';
import { useExportDialog, type ExportTriggerView } from './useExportDialog';

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
      {trigger.busy ? (
        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      {trigger.text !== null && (
        <span className={trigger.busy ? 'tabular-nums' : 'hidden sm:inline'}>{trigger.text}</span>
      )}
    </button>
  );
}

/**
 * The export feature's root, rendered by the Header on the song layer only.
 * Takes `layer` as a prop for the reason the Header's other song-layer
 * controls do: under `renderToString` a rendered `<Header />` can never reach
 * the song layer, so the prop is what makes "song layer only" assertable.
 */
export function ExportButton({ layer }: { layer: Layer }) {
  const d = useExportDialog();
  if (layer !== 'song') return null;
  return (
    <>
      <ExportTrigger trigger={d.trigger} onOpen={d.openDialog} />
      <ExportDialog open={d.open} onClose={d.closeDialog} kinds={EXPORT_KINDS} busy={d.busy}
        status={d.status} onStart={d.start} onCancel={d.cancel} />
    </>
  );
}
