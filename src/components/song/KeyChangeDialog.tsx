import { Modal } from '@/components/ui/Modal';
import { ScaleTypeOptions } from './ScaleTypeOptions';
import { KEY_OPTIONS } from '@/utils/noteSpelling';
import {
  TRANSPOSE_STEPS,
  useKeyChangeDialog,
  type KeyChangeDialogProps,
  type KeyChangePreviewRow,
  type UseKeyChangeDialog,
} from './useKeyChangeDialog';

const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-base-content/50';

function ModeToggle({ mode, onChange }: { mode: UseKeyChangeDialog['mode']; onChange: UseKeyChangeDialog['setMode'] }) {
  return (
    <div className="join">
      <input className="join-item btn btn-sm" type="radio" name="key-change-mode" aria-label="Set key"
        checked={mode === 'set'} onChange={() => onChange('set')} />
      <input className="join-item btn btn-sm" type="radio" name="key-change-mode" aria-label="Transpose"
        checked={mode === 'transpose'} onChange={() => onChange('transpose')} />
    </div>
  );
}

function SetKeyFields({ root, scaleType, onRoot, onScale }: {
  root: string; scaleType: string; onRoot: (r: string) => void; onScale: (t: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <select id="select-key-change-root" aria-label="Key" value={root}
        onChange={(e) => onRoot(e.target.value)} className="select select-sm flex-1 text-xs">
        {KEY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select id="select-key-change-scale" aria-label="Scale" value={scaleType}
        onChange={(e) => onScale(e.target.value)} className="select select-sm flex-1 text-xs">
        <ScaleTypeOptions />
      </select>
    </div>
  );
}

function TransposeField({ semitones, onChange }: { semitones: number; onChange: (n: number) => void }) {
  return (
    <select id="select-key-change-semitones" aria-label="Semitones" value={semitones}
      onChange={(e) => onChange(Number(e.target.value))} className="select select-sm text-xs">
      {TRANSPOSE_STEPS.map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : n} semitones</option>)}
    </select>
  );
}

function LoopChecklist({ rows, selected, onToggle }: {
  rows: KeyChangePreviewRow[]; selected: ReadonlySet<string>; onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Loops</legend>
      {rows.map((row) => (
        <label key={row.id} className="label gap-2 text-xs">
          <input id={`chk-key-change-loop-${row.id}`} type="checkbox" className="checkbox checkbox-sm"
            checked={selected.has(row.id)} onChange={() => onToggle(row.id)} />
          <span className="flex-1 truncate">{row.label}</span>
          <span className="text-base-content/60">{row.changes ? `${row.from} → ${row.to}` : `${row.from} (unchanged)`}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function KeyChangeDialog(props: KeyChangeDialogProps) {
  const d = useKeyChangeDialog(props);
  return (
    <Modal open onClose={props.onClose} title="Change key" size="md" bodyClassName="space-y-4" footer={
      <div className="modal-action">
        <button id="btn-key-change-cancel" type="button" className="btn btn-ghost" onClick={props.onClose}>Cancel</button>
        <button id="btn-key-change-apply" type="button" className="btn btn-primary"
          disabled={!d.canApply} onClick={d.apply}>Apply</button>
      </div>
    }>
      <ModeToggle mode={d.mode} onChange={d.setMode} />
      {d.mode === 'set' ? (
        <SetKeyFields root={d.root} scaleType={d.scaleType} onRoot={d.setRoot} onScale={d.setScaleType} />
      ) : (
        <TransposeField semitones={d.semitones} onChange={d.setSemitones} />
      )}
      <label className="label gap-2 text-xs">
        <input id="chk-key-change-harmonize" type="checkbox" className="checkbox checkbox-sm checkbox-primary"
          checked={d.harmonizeChords} onChange={(e) => d.setHarmonizeChords(e.target.checked)} />
        <span className={LABEL}>Harmonize chords</span>
      </label>
      <LoopChecklist rows={d.rows} selected={d.selected} onToggle={d.toggleLoop} />
    </Modal>
  );
}
