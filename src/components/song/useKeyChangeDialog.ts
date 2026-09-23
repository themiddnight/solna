import { useMemo, useState } from 'react';
import { loopLabel } from '@/store/loop';
import type { KeyChangeOptions } from '@/store/keyChange';
import { targetKeyFor, type BatchKeyTarget } from '@/store/loopKeyChange';
import type { Loop } from '@/store/types';
import { formatKeyLabel } from '@/utils/noteSpelling';

export interface KeyChangePreviewRow {
  id: string;
  label: string;
  /** Display-spelled, e.g. "A minor" — never stored or compared. */
  from: string;
  to: string;
  changes: boolean;
}

export const TRANSPOSE_STEPS: readonly number[] = [
  -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
];

/** The old → new key of every loop under `target`; ROOTS comparison, spelled labels. */
export function keyChangePreview(loops: readonly Loop[], target: BatchKeyTarget): KeyChangePreviewRow[] {
  return loops.map((loop) => {
    const key = targetKeyFor(loop, target);
    const from = formatKeyLabel(loop.scaleRoot, loop.scaleType);
    return {
      id: loop.id,
      label: loopLabel(loop),
      from,
      to: key ? formatKeyLabel(key.root, key.scaleType) : from,
      changes: key !== null,
    };
  });
}

export function canApplyKeyChange(rows: readonly KeyChangePreviewRow[], selected: ReadonlySet<string>): boolean {
  return rows.some((row) => row.changes && selected.has(row.id));
}

export interface KeyChangeDialogProps {
  loops: readonly Loop[];
  activeLoopId: string;
  onApply: (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => void;
  onClose: () => void;
}

export interface UseKeyChangeDialog {
  mode: 'set' | 'transpose';
  setMode: (mode: 'set' | 'transpose') => void;
  root: string;
  setRoot: (root: string) => void;
  scaleType: string;
  setScaleType: (scaleType: string) => void;
  semitones: number;
  setSemitones: (semitones: number) => void;
  harmonizeChords: boolean;
  setHarmonizeChords: (on: boolean) => void;
  selected: ReadonlySet<string>;
  toggleLoop: (id: string) => void;
  rows: KeyChangePreviewRow[];
  canApply: boolean;
  apply: () => void;
}

/** The dialog's state. Set defaults to the active loop's key; every loop starts ticked; harmonize starts on. */
export function useKeyChangeDialog({ loops, activeLoopId, onApply, onClose }: KeyChangeDialogProps): UseKeyChangeDialog {
  const active = loops.find((loop) => loop.id === activeLoopId) ?? loops[0];
  const [mode, setMode] = useState<'set' | 'transpose'>('set');
  const [root, setRoot] = useState(active.scaleRoot);
  const [scaleType, setScaleType] = useState(active.scaleType);
  const [semitones, setSemitones] = useState(2);
  const [harmonizeChords, setHarmonizeChords] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(loops.map((l) => l.id)));

  const target = useMemo<BatchKeyTarget>(
    () => (mode === 'set' ? { mode, root, scaleType } : { mode, semitones }),
    [mode, root, scaleType, semitones],
  );
  const rows = useMemo(() => keyChangePreview(loops, target), [loops, target]);

  const toggleLoop = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canApply = canApplyKeyChange(rows, selected);
  const apply = () => {
    if (!canApply) return;
    onApply([...selected], target, { harmonizeChords });
    onClose();
  };

  return {
    mode, setMode, root, setRoot, scaleType, setScaleType, semitones, setSemitones,
    harmonizeChords, setHarmonizeChords, selected, toggleLoop, rows, canApply, apply,
  };
}
