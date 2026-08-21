import { t } from "@lingui/core/macro";
import type { NoteEditOp } from "@jam-band/shared";
import type { AiNote } from "@/shared/api/aiGeneration";

/**
 * Short human-readable summary of an edit-mode turn, derived from the ops
 * the model returned. Used both as the chat-thread summary card and as the
 * "model" turn fed back into `historyForApi` for the next request.
 */
export function summarizeEditOps(ops: NoteEditOp[]): string {
  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const op of ops) {
    switch (op.op) {
      case "add":
        added += 1;
        break;
      case "modify":
        modified += 1;
        break;
      case "remove":
        removed += 1;
        break;
    }
  }

  const parts: string[] = [];
  if (added > 0) parts.push(t`added ${added}`);
  if (modified > 0) parts.push(t`modified ${modified}`);
  if (removed > 0) parts.push(t`removed ${removed}`);

  return parts.length > 0 ? parts.join(", ") : t`no changes`;
}

/**
 * Short human-readable summary of a generate-mode turn.
 */
export function summarizeGeneratedNotes(notes: AiNote[]): string {
  return t`generated ${notes.length} notes`;
}
