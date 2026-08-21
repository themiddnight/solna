/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition */
import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect } from 'react';
import { t } from "@lingui/core/macro";
import { AI_GENERATION_CONSTANTS, type NoteEditOp } from "@jam-band/shared";
import { PATHS } from '@/shared/constants';
import { Popover, Select, Checkbox } from "@/features/ui";
import { Icon } from "@/shared/ui";
import { useAiSettings } from "../hooks/useAiSettings";
import { generateNotes, cancelGeneration, type AiNote, type AiContext } from "../../../shared/api/aiGeneration";
import { formatAiError } from "../utils/errorFormatter";
import { summarizeEditOps, summarizeGeneratedNotes } from "../utils/summarizeAiTurn";
import { getModelsForProvider } from "../constants/models";
import { useAiPreferencesStore } from "../stores/aiPreferencesStore";
import { useAiChatSession } from "../hooks/useAiChatSession";
import { AiChatThread } from "./AiChatThread";

// Radix Select forbids an empty-string item value, so the "all tracks" choice
// (stored as "" in selectedContextTrackId) maps to this sentinel in the picker.
const ALL_CONTEXT_TRACKS_VALUE = "__all_context_tracks__";

export interface AiGenerationPopupProps {
  onGenerate: (notes: AiNote[]) => void;
  context: Partial<AiContext> & Record<string, unknown>; // Base context
  extraContext?: Partial<AiContext> & Record<string, unknown>; // Context to include if toggle is checked
  showContextToggle?: boolean;
  contextToggleLabel?: string;
  tracks?: Array<{ id: string; name: string }>;
  onGetTrackNotes?: (trackId: string) => AiNote[];
  trigger: React.ReactElement;
  placement?: string;
  /** Decided by the caller from selection state. Defaults to 'generate'. */
  mode?: 'generate' | 'edit';
  /**
   * Edit-mode apply callback — caller applies ops to the region + records
   * undo, and returns the resulting notes so the turn's chat snapshot is
   * faithful (used by `onRewind` to restore this exact state later).
   * Returns `null` when the caller rejected the apply (e.g. the region's
   * lock is held by another collaborator) — nothing was mutated, so the
   * popup must NOT record a chat turn for it.
   */
  onApplyOps?: (ops: NoteEditOp[]) => AiNote[] | null;
  /** Current region notes with indices, for edit-mode requests. */
  getIndexedNotes?: () => Array<{ index: number } & AiNote>;
  /**
   * Fired when the user picks a past turn to rewind to. `snapshotNotes` is
   * that turn's note snapshot; `commit` truncates the chat thread to that
   * turn and MUST be called only if the caller actually applies the
   * snapshot (e.g. after a divergence confirm) — never on cancel, so
   * cancel stays a true no-op for both the region and the thread.
   */
  onRewind?: (snapshotNotes: AiNote[], commit: () => void) => void;
  /**
   * Generate-mode range control (DEV-46) — preset buttons + summary rendered
   * above the submit row. Caller-owned so range/loop logic stays in the room
   * feature; the popup stays generic. Only shown in 'generate' mode.
   */
  rangeControl?: React.ReactNode;
  /**
   * Generate-mode requested range length in bars. Sent with the request for
   * the server-side cap and guarded client-side before submitting.
   */
  generationRangeBars?: number;
}

export function AiGenerationPopup({
  onGenerate,
  context,
  extraContext,
  showContextToggle = false,
  contextToggleLabel = t`Include Context`,
  tracks = [],
  onGetTrackNotes,
  trigger,
  placement = "bottom-end",
  mode = "generate",
  onApplyOps,
  getIndexedNotes,
  onRewind,
  rangeControl,
  generationRangeBars,
}: AiGenerationPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isEnabled, setEnabled] = useState(false);
  const [includeExtraContext, setIncludeContext] = useState(false);
  const [selectedContextTrackId, setSelectedContextTrackId] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");

  // Popup-local chat thread (design decision D1: ephemeral, no persistence).
  const { turns, addTurn, peekSnapshot, commitRewind, historyForApi, reset: resetSession } =
    useAiChatSession();

  // Zustand store for persisting model preferences
  const { getModel: getStoredModel, setModel: setStoredModel } = useAiPreferencesStore(
    useShallow((state) => ({
      getModel: state.getModel,
      setModel: state.setModel,
    }))
  );

  // Shared cached AI settings query (deduped across all consumers — see useAiSettings)
  const { data: aiSettings, isLoading: checkingSettings, isError: aiSettingsError } = useAiSettings();

  // Derive enablement / provider / model / error from the shared settings when opened
  useEffect(() => {
    if (!isOpen) return;
    if (aiSettingsError) {
      setError(t`Failed to verify AI settings`);
      setEnabled(false);
      return;
    }
    if (!aiSettings) return;

    setEnabled(aiSettings.enabled && aiSettings.hasApiKey);
    setProvider(aiSettings.provider);
    setModel(getStoredModel(aiSettings.provider));

    if (!aiSettings.enabled) {
      setError(t`AI features are disabled in Settings`);
    } else if (!aiSettings.hasApiKey) {
      setError(t`API Key is missing in Account Settings`);
    } else {
      setError("");
    }
  }, [isOpen, aiSettings, aiSettingsError, getStoredModel]);

  // Update model when provider changes - use stored preference or default
  useEffect(() => {
    if (provider) {
      const storedModel = getStoredModel(provider);
      setModel(storedModel);
    }
  }, [provider, getStoredModel]);

  // The chat thread is popup-local (D1): once the popover closes, the next
  // open starts a fresh conversation.
  useEffect(() => {
    if (!isOpen) {
      resetSession();
    }
  }, [isOpen, resetSession]);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    // Client-side range guard (DEV-46) — mirror of the server boundary cap so
    // an over-long range fails fast without a wasted round-trip.
    if (
      mode === "generate" &&
      generationRangeBars !== undefined &&
      generationRangeBars > AI_GENERATION_CONSTANTS.MAX_RANGE_BARS
    ) {
      setError(
        t`Generation range too long. Maximum is ${AI_GENERATION_CONSTANTS.MAX_RANGE_BARS} bars.`,
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const finalContext = {
        ...context,
        ...(includeExtraContext && extraContext ? extraContext : {})
      };

      // If a specific track is selected for context, fetch its notes
      if (includeExtraContext && selectedContextTrackId && onGetTrackNotes) {
        const trackNotes = onGetTrackNotes(selectedContextTrackId);
        if (trackNotes && trackNotes.length > 0) {
          finalContext.referenceTrack = {
            id: selectedContextTrackId,
            notes: trackNotes
          };
        }
      }

      const indexedNotes = mode === "edit" ? getIndexedNotes?.() : undefined;

      const response = await generateNotes({
        prompt,
        context: finalContext as AiContext,
        ...(model ? { model } : {}),
        mode,
        history: historyForApi(8),
        ...(indexedNotes !== undefined ? { indexedNotes } : {}),
        ...(mode === "generate" && generationRangeBars !== undefined
          ? { rangeBars: generationRangeBars }
          : {}),
      });

      if (mode === "edit") {
        const ops = response.ops ?? [];
        if (ops.length > 0) {
          // Apply immediately — no accept/reject step (spec D3/D7).
          // `onApplyOps` returns the resulting notes so the turn's snapshot
          // is faithful for a later rewind, or `null` if the caller rejected
          // the apply (e.g. region locked by another collaborator) — in that
          // case nothing was mutated, so skip the turn and keep the prompt
          // so the user can retry.
          const nextNotes = onApplyOps ? onApplyOps(ops) : [];
          if (nextNotes === null) {
            setError(t`Edit not applied — region is locked by another collaborator`);
          } else {
            addTurn(prompt, summarizeEditOps(ops), nextNotes);
            setPrompt("");
          }
        } else {
          setError(t`AI made no edits`);
        }
      } else if (response.processedNotes && response.processedNotes.length > 0) {
        onGenerate(response.processedNotes);
        addTurn(prompt, summarizeGeneratedNotes(response.processedNotes), response.processedNotes);
        setPrompt("");
      } else {
        setError(t`AI returned no notes`);
      }
    } catch (err: unknown) {
      console.error("AI Generation Failed:", err);
      setError(formatAiError(err));
    } finally {
      setLoading(false);
    }
  };

  // Rewind: peek the target turn's snapshot (no thread mutation yet) and
  // hand it to the caller along with a commit callback. The thread is only
  // truncated once the caller actually applies the snapshot — e.g. after a
  // divergence confirm — so a cancel never desyncs the thread from the
  // region.
  const handleRewindTurn = (turnId: string) => {
    const snapshot = peekSnapshot(turnId);
    if (snapshot !== null) {
      onRewind?.(snapshot, () => commitRewind(turnId));
    }
  };

  const handleCancel = async () => {
    try {
      await cancelGeneration();
      setError(t`Generation canceled`);
    } catch (err) {
      console.error("Failed to cancel:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && isLoading) return;
        setIsOpen(open);
      }}
    >
      <Popover.Trigger asChild>
        {trigger}
      </Popover.Trigger>

      <Popover.Content
        side={placement.includes("bottom") ? "bottom" : "top"}
        align="end"
        className="w-80 p-4"
      >
        <div className="flex flex-col gap-3">
          <h3 className="font-bold text-lg flex items-center gap-2 text-transparent bg-clip-text bg-linear-to-r from-purple-400 to-pink-400">
            <Icon name="auto-fix" className="inline text-purple-400" /> {t`AI Composer`}
          </h3>

          {checkingSettings ? (
            <div className="flex justify-center py-4">
              <span className="loading loading-spinner loading-sm"></span>
            </div>
          ) : !isEnabled ? (
            <div className="alert alert-warning text-xs">
              <span>{error || t`AI features are not configured.`}</span>
              <a href={PATHS.ACCOUNT} className="link link-primary">{t`Settings`}</a>
            </div>
          ) : (
            <>
              <AiChatThread turns={turns} {...(onRewind ? { onRewind: handleRewindTurn } : {})} />

              <div className="form-control">
                <label className="label">
                  <span className="label-text">{t`Describe what you want`}</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-24 text-sm"
                  placeholder={t`e.g., A funky bassline in C minor, syncopated rhythm...`}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isLoading}
                  autoFocus
                ></textarea>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text text-xs">{t`Model`}</span>
                </label>
                <Select.Simple
                  className="select-xs w-full text-xs"
                  value={model}
                  onValueChange={(newModel) => {
                    setModel(newModel);
                    // Save to store for persistence
                    if (provider) {
                      setStoredModel(provider, newModel);
                    }
                  }}
                  disabled={isLoading || !isEnabled}
                  ariaLabel={t`Model`}
                  options={getModelsForProvider(provider).map((m) => ({
                    value: m.value,
                    label: m.label,
                  }))}
                />
                {getModelsForProvider(provider).find(m => m.value === model)?.description && (
                  <label className="label text-xs">
                    <span className="label-text-alt text-base-content/60 text-xs">
                      {getModelsForProvider(provider).find(m => m.value === model)?.description}
                    </span>
                  </label>
                )}
              </div>

              {showContextToggle && (
                <div className="form-control">
                  <label className="label cursor-pointer justify-start gap-2">
                    <Checkbox
                      checked={includeExtraContext}
                      onCheckedChange={(checked) => setIncludeContext(checked === true)}
                      className="size-4"
                    />
                    <span className="label-text text-xs">{contextToggleLabel}</span>
                  </label>

                  {includeExtraContext && tracks && tracks.length > 0 && (
                    <div className="ml-6 mt-1">
                      <label className="label py-0">
                        <span className="label-text-alt text-xs opacity-70">{t`Focus on Track:`}</span>
                      </label>
                      <Select.Simple
                        className="select-xs w-full mt-1 text-xs"
                        value={selectedContextTrackId === "" ? ALL_CONTEXT_TRACKS_VALUE : selectedContextTrackId}
                        onValueChange={(value) =>
                          setSelectedContextTrackId(value === ALL_CONTEXT_TRACKS_VALUE ? "" : value)
                        }
                        ariaLabel={t`Focus on track`}
                        options={[
                          { value: ALL_CONTEXT_TRACKS_VALUE, label: t`All Context Tracks` },
                          ...tracks.map((track) => ({ value: track.id, label: track.name })),
                        ]}
                      />
                    </div>
                  )}
                </div>
              )}

              {mode !== "edit" && rangeControl}

              {error && (
                <div className="alert alert-error text-xs py-2">
                  <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-2">
                {isLoading ? (
                  <button
                    className="btn btn-sm btn-error"
                    onClick={handleCancel}
                  >
                    {t`Cancel`}
                  </button>
                ) : (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setIsOpen(false)}
                  >
                    {t`Close`}
                  </button>
                )}

                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleSubmit}
                  disabled={isLoading || !prompt.trim()}
                >
                  {isLoading ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      {t`Thinking...`}
                    </>
                  ) : mode === "edit" ? (
                    t`Send`
                  ) : (
                    t`Generate`
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
