import { t } from "@lingui/core/macro";
import { Icon } from "@/shared/ui";
import type { ChatTurn } from "../hooks/useAiChatSession";

export interface AiChatThreadProps {
  turns: ChatTurn[];
  /** Rewind the session (and the region) back to this turn's snapshot. */
  onRewind?: (turnId: string) => void;
}

/**
 * Presentational list of applied AI chat turns (prompt + short summary card),
 * rendered above the prompt input in `AiGenerationPopup`. Owns no state; the
 * rewind button just forwards the turn id to `onRewind` — all rewind/confirm
 * logic lives in the popup (and its Arrange consumer).
 */
export function AiChatThread({ turns, onRewind }: AiChatThreadProps) {
  if (turns.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1">
      {turns.map((turn) => (
        <div
          key={turn.id}
          className="flex items-start gap-1.5 rounded-md bg-base-200/60 px-2 py-1.5 text-xs"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-base-content/90 break-words">{turn.prompt}</p>
            <p className="text-base-content/60 mt-0.5">{turn.summary}</p>
          </div>
          {onRewind && (
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square shrink-0"
              onClick={() => onRewind(turn.id)}
              title={t`Rewind to here`}
              aria-label={t`Rewind to here`}
            >
              <Icon name="skip-previous" className="text-sm" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
