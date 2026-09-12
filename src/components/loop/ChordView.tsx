import React, { Suspense } from 'react';
import { Bookmark, Check, Library } from 'lucide-react';

// The drawer is never needed on first paint — PresetLibrary early-returns
// null when closed — so it is code-split out of the main chunk.
const ChordPresetLibrary = React.lazy(() =>
  import('./ChordPresetLibrary').then((m) => ({ default: m.ChordPresetLibrary })),
);
import { QuickSavePopover } from '../ui/QuickSavePopover';
import { SegmentHeader } from '../ui/SegmentHeader';
import { GroupFrame } from '../ui/GroupFrame';
import { COUNT_BADGE } from '../ui/fieldClasses';
import { ChordModulePanel } from './chord/ChordModulePanel';
import { BassModulePanel } from './chord/BassModulePanel';
import { PadModulePanel } from './chord/PadModulePanel';
import { ModulePasteButton } from './ModulePasteButton';
import { ProgressionCard } from './chord/ProgressionCard';
import {
  useChordPalette,
  useChordViewState,
  useHeldChordPreview,
  usePatternPreviews,
  useProgressionEditor,
  useProgressionHarmonize,
  useProgressionSaves,
  type PatternPreviews,
} from './chord/useChordView';

// Both helpers moved to `chord/progressionHarmonize.ts` when this component was
// split; they are re-exported here because ChordView is where they are read
// from (repo convention: a component exports its testable helpers).
export { applyKeyScaleChange, shouldClearReharmonizeIndicator } from './chord/progressionHarmonize';

/** The two header actions, and the saved-toast they fire. */
interface ChordViewHeaderProps {
  onOpenQuickSave: () => void;
  onOpenLibrary: () => void;
  totalProgressionsCount: number;
  saveToast: string | null;
}

/**
 * The segment header, with the toast that hangs off it. `absolute top-full` is
 * relative to the header's own positioning, so the toast has to be a child here
 * rather than a sibling further down the tree.
 */
function ChordViewHeader({
  onOpenQuickSave,
  onOpenLibrary,
  totalProgressionsCount,
  saveToast,
}: ChordViewHeaderProps) {
  return (
    <SegmentHeader
      segment="accompaniment"
      actions={
        <>
          {/* Quick Save Current Progression */}
          <button
            id="btn-quick-save-chord-progression"
            onClick={onOpenQuickSave}
            className="btn btn-sm btn-ghost gap-1"
            title="Save chord progression"
          >
            <Bookmark className="w-3.5 h-3.5 text-module-chord" />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Open Presets Library Drawer Button */}
          <button
            id="btn-open-chord-presets-library"
            onClick={onOpenLibrary}
            className="btn btn-sm gap-1 [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
            title="Progression Library"
          >
            <Library className="w-3.5 h-3.5" />
            {/* See the matching button in SoundView: content, not container. */}
            <span>Progressions</span>
            <span className={COUNT_BADGE}>{totalProgressionsCount}</span>
          </button>
        </>
      }
    >
      {saveToast && (
        <div className="alert alert-success absolute top-full right-4 mt-2 z-20 w-auto py-1.5 px-3 text-xs shadow-lg animate-fade-in">
          <Check className="w-3.5 h-3.5" />
          <span>{saveToast}</span>
        </div>
      )}
    </SegmentHeader>
  );
}

/**
 * The three module panels. The wrapper keeps rendering them as a group: the
 * root's `space-y-3 sm:space-y-4` only reaches direct children, so once they
 * are wrapped, `gap-3` here is what spaces them (spec §3).
 *
 * No label: the segment header above already reads "Accompaniment", and a
 * second one here would duplicate the card title.
 */
function AccompanimentModules({
  previews,
  isPlaying,
}: {
  previews: PatternPreviews;
  isPlaying: boolean;
}) {
  return (
    <GroupFrame className="flex flex-col gap-3 p-3">
      {/* Chord Module Panel */}
      <ChordModulePanel
        onPatternPreviewDown={previews.handleChordPatternPreviewMouseDown}
        onPatternPreviewUp={previews.handleChordPatternPreviewMouseUp}
        isPlaying={isPlaying}
      />

      {/* Bass Module Panel */}
      <BassModulePanel
        onPatternPreviewDown={previews.handleBassPatternPreviewMouseDown}
        onPatternPreviewUp={previews.handleBassPatternPreviewMouseUp}
        isPlaying={isPlaying}
      />

      {/* Pad Module Panel */}
      <PadModulePanel />
    </GroupFrame>
  );
}

export const ChordView = React.memo(function ChordView() {
  // ChordView reads the store directly: every value below replaces one of
  // the ~34 props it used to receive from App.tsx.
  const state = useChordViewState();
  const saves = useProgressionSaves(state);
  const harmonize = useProgressionHarmonize(state, saves);
  const editor = useProgressionEditor(state, harmonize.clearReharmonizeBadge);
  const palette = useChordPalette(
    state.scaleRoot,
    state.scaleType,
    editor.use7thsInQuickAdd,
    saves.customProgressions,
  );
  // Two different gestures that both read as "preview": the held chord a
  // palette chip auditions, and the looping pattern a module's button plays.
  const chordPreview = useHeldChordPreview(state);
  const patternPreviews = usePatternPreviews(state);

  const [isLibraryOpen, setIsLibraryOpen] = React.useState<boolean>(false);

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Scale & Chord Studio Header */}
      <ChordViewHeader
        onOpenQuickSave={saves.openQuickSave}
        onOpenLibrary={() => setIsLibraryOpen(true)}
        totalProgressionsCount={palette.totalProgressionsCount}
        saveToast={saves.saveToast}
      />

      {/* Quick Save Modal Popover */}
      <QuickSavePopover
        open={saves.isQuickSaving}
        onClose={saves.closeQuickSave}
        heading="Save Custom Chord Progression to Browser:"
        placeholder="Progression Name..."
        saveLabel="Save Progression"
        name={saves.quickSaveName}
        onNameChange={saves.setQuickSaveName}
        onSubmit={saves.handleQuickSaveSubmit}
      />

      <ProgressionCard
        state={state}
        editor={editor}
        harmonize={harmonize}
        palette={palette}
        previews={chordPreview}
        pasteButton={<ModulePasteButton groups={['chord-progression']} />}
      />

      <AccompanimentModules previews={patternPreviews} isPlaying={state.playback.isPlaying} />

      {/* Full Chord Preset Library Sidebar Drawer */}
      <Suspense
        fallback={
          isLibraryOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : null
        }
      >
        <ChordPresetLibrary
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          currentChords={state.chords}
          scaleRoot={state.scaleRoot}
          scaleType={state.scaleType}
          autoReharmonize={harmonize.autoReharmonize}
          synthParams={state.synthParams}
          onApplyChords={editor.handleApplyLibraryChords}
        />
      </Suspense>
    </div>
  );
});
