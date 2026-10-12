import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { loopLabel, renameFromDraft } from '@/store/loop';
import { useAppStore } from '@/store/store';
import type { Loop } from '@/store/types';

/**
 * What submitting the picker's rename dialog should write, or null for
 * "write nothing".
 *
 * The dialog is prefilled with the loop's LABEL, so an unnamed loop opens as
 * `untitled-1`. Submitting that untouched prefill must not promote the app's
 * `tempName` into the user's permanent `name` (R282), which is what
 * `renameFromDraft` alone would do for an unnamed loop. Arrange prefills the
 * stored name instead, so it has no such case. Anything else goes through
 * `renameFromDraft`, so an emptied field on a named loop still clears the
 * name, and typing the label over a different user name is still an explicit
 * choice.
 */
export function nameToWrite(draft: string, loop: Pick<Loop, 'name' | 'tempName'>): string | null {
  return draft.trim() === loopLabel(loop) ? null : renameFromDraft(draft, loop.name);
}

/**
 * Applies a submitted draft to the loop the dialog was opened on, through the
 * given writer (the store's `setLoopName`). A loop that is gone writes nothing.
 * It is passed `loopId`, not "the active loop", because the song can advance
 * the active loop while the dialog is open.
 */
export function renameLoop(
  loops: readonly Loop[],
  loopId: string,
  draft: string,
  write: (id: string, name: string) => void,
): void {
  const loop = loops.find((l) => l.id === loopId);
  if (!loop) return;
  const next = nameToWrite(draft, loop);
  if (next !== null) write(loopId, next);
}

export interface UseLoopRename {
  isOpen: boolean;
  formId: string;
  /** The name input: focused and its text selected each time the dialog opens. */
  inputRef: RefObject<HTMLInputElement | null>;
  draft: string;
  /** The loop's `tempName`, which an emptied field falls back to. */
  placeholder: string;
  setDraft: (draft: string) => void;
  /** Opens the dialog on the active loop. */
  open: () => void;
  cancel: () => void;
  submit: (e: FormEvent<HTMLFormElement>) => void;
}

/**
 * The header loop picker's Rename loop dialog: which loop it was opened on, the
 * draft text, and the commit. The draft is local, like Arrange's: it is a draft
 * of `name`, gone on close, so it is never store state (R016).
 */
export function useLoopRename(): UseLoopRename {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  const setLoopName = useAppStore((s) => s.setLoopName);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = `${useId()}-rename-loop`;
  const isOpen = targetId !== null;

  useEffect(() => {
    if (!isOpen) return;
    // Modal is a child, so its showModal() effect has already run; the dialog
    // would otherwise focus its close button first.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen]);

  const open = () => {
    const loop = loops.find((l) => l.id === activeLoopId);
    if (!loop) return;
    setDraft(loopLabel(loop));
    setTargetId(loop.id);
  };

  const cancel = () => {
    setTargetId(null);
    setDraft('');
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (targetId !== null) renameLoop(loops, targetId, draft, setLoopName);
    cancel();
  };

  const placeholder = loops.find((l) => l.id === targetId)?.tempName ?? '';

  return { isOpen, formId, inputRef, draft, placeholder, setDraft, open, cancel, submit };
}
