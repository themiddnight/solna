import { ROOTS } from '@/musicCore';
import type { LoopContent } from './loop';
import { changeKey, type KeyChangeOptions, type KeyChangeSource } from './keyChange';
import type { Loop } from './types';

/** Set: every selected loop to one key. Transpose: each root shifted, each loop keeps its scale type. */
export type BatchKeyTarget =
  | { mode: 'set'; root: string; scaleType: string }
  | { mode: 'transpose'; semitones: number };

/** Exactly the fields `changeKey` can write — the undo snapshot restores these and nothing else. */
export type KeyChangeField = keyof KeyChangeSource;

/** The five key fields, read off any loop-shaped value — the one place their names are listed. */
export function keyFieldsOf(loop: Pick<LoopContent, KeyChangeField>): Pick<LoopContent, KeyChangeField> {
  return {
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    chords: loop.chords,
    leadMelodySteps: loop.leadMelodySteps,
    fxMelodySteps: loop.fxMelodySteps,
  };
}

export interface LoopKeySnapshot {
  loopId: string;
  content: Pick<LoopContent, KeyChangeField>;
}

/** A pending batch Undo: session-only, single level, never persisted. */
export interface LoopKeyChangeUndo {
  snapshots: LoopKeySnapshot[];
}

/** `root` moved by `semitones` through `ROOTS`, ROOTS-spelled; null for a root outside `ROOTS`. */
export function transposeRoot(root: string, semitones: number): string | null {
  const index = (ROOTS as readonly string[]).indexOf(root);
  if (index < 0) return null;
  const shifted = (((index + semitones) % 12) + 12) % 12;
  return ROOTS[shifted];
}

/** The key one loop lands in, or null when its root cannot be read. */
export function targetKeyFor(
  loop: Pick<Loop, 'scaleRoot' | 'scaleType'>,
  target: BatchKeyTarget,
): { root: string; scaleType: string } | null {
  if (target.mode === 'set') return { root: target.root, scaleType: target.scaleType };
  const root = transposeRoot(loop.scaleRoot, target.semitones);
  return root === null ? null : { root, scaleType: loop.scaleType };
}

function snapshotOf(loop: Loop): LoopKeySnapshot {
  return { loopId: loop.id, content: keyFieldsOf(loop) };
}

/**
 * `changeKey` over every selected loop. Pure: reads no store and no
 * activeLoopId — the caller decides how the active loop is written. Loops not
 * selected, not found, unreadable or already in their target key keep their
 * object reference and are absent from `changed`, which holds each changed
 * loop's PRE-change key fields (the undo snapshot).
 */
export function changeKeyAcrossLoops(
  loops: readonly Loop[],
  ids: readonly string[],
  target: BatchKeyTarget,
  opts: KeyChangeOptions,
): { loops: Loop[]; changed: LoopKeySnapshot[] } {
  const selected = new Set(ids);
  const changed: LoopKeySnapshot[] = [];
  const next = loops.map((loop) => {
    if (!selected.has(loop.id)) return loop;
    const key = targetKeyFor(loop, target);
    if (!key || (key.root === loop.scaleRoot && key.scaleType === loop.scaleType)) return loop;
    changed.push(snapshotOf(loop));
    return { ...loop, ...changeKey(loop, { root: key.root, scaleType: key.scaleType }, opts) };
  });
  return { loops: next, changed };
}
