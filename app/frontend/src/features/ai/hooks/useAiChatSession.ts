import { useCallback, useReducer } from "react";
import type { AiNote } from "@/shared/api/aiGeneration";

/**
 * One applied AI edit turn in a popup-local chat session.
 *
 * `snapshotNotes` is the region's notes AFTER this turn was applied — kept
 * locally only so `peekSnapshot`/`commitRewind` can restore state without a
 * server round-trip.
 */
export interface ChatTurn {
  id: string;
  prompt: string;
  summary: string;
  snapshotNotes: AiNote[];
}

export interface AiChatHistoryMessage {
  role: "user" | "model";
  content: string;
}

const DEFAULT_HISTORY_CAP = 8;

type ChatSessionAction =
  | { type: "add"; turn: ChatTurn }
  | { type: "rewind"; turnId: string }
  | { type: "reset" };

function chatSessionReducer(turns: ChatTurn[], action: ChatSessionAction): ChatTurn[] {
  switch (action.type) {
    case "add":
      return [...turns, action.turn];
    case "rewind": {
      const index = turns.findIndex((turn) => turn.id === action.turnId);
      if (index === -1) {
        return turns;
      }
      return turns.slice(0, index + 1);
    }
    case "reset":
      return [];
    default:
      return turns;
  }
}

/**
 * Ephemeral, popup-local AI chat-session state (design decision D1: no store,
 * no persistence — the conversation lives only while the popup is open).
 *
 * Tracks applied edit turns so the popup can render a running thread, rewind
 * the region to an earlier turn's snapshot, and build a capped history payload
 * for the next generation request.
 */
export function useAiChatSession() {
  const [turns, dispatch] = useReducer(chatSessionReducer, []);

  const addTurn = useCallback((prompt: string, summary: string, snapshotNotes: AiNote[]) => {
    dispatch({
      type: "add",
      turn: { id: crypto.randomUUID(), prompt, summary, snapshotNotes },
    });
  }, []);

  // Pure lookup — no dispatch. Lets a caller inspect a turn's snapshot (e.g.
  // to compare against live region state, or to show a divergence confirm)
  // without truncating the thread. Pair with `commitRewind` to actually
  // truncate once the caller decides to go through with the rewind.
  const peekSnapshot = useCallback(
    (turnId: string): AiNote[] | null => {
      return turns.find((turn) => turn.id === turnId)?.snapshotNotes ?? null;
    },
    [turns],
  );

  // Truncates the thread to `turnId`. Split from `peekSnapshot` so a caller
  // can defer the truncation until after an async/confirm step — calling
  // this is the only thing that mutates `turns`.
  const commitRewind = useCallback((turnId: string): void => {
    dispatch({ type: "rewind", turnId });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  const historyForApi = useCallback(
    (cap: number = DEFAULT_HISTORY_CAP): AiChatHistoryMessage[] => {
      const capped = cap > 0 ? turns.slice(-cap) : [];
      return capped.flatMap((turn): AiChatHistoryMessage[] => [
        { role: "user", content: turn.prompt },
        { role: "model", content: turn.summary },
      ]);
    },
    [turns],
  );

  return { turns, addTurn, peekSnapshot, commitRewind, reset, historyForApi };
}
