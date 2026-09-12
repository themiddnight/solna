import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { Music, Plus, Sparkles, Volume2 } from 'lucide-react';
import { HEADER_BADGE, SECTION_HEADER } from '@/components/ui/fieldClasses';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { SortableChordCard } from './SortableChordCard';
import { beatsPerBarFor, resolveBeatCounter } from '@/utils/playhead';
import { formatChordLabel } from '@/utils/musicTheory';
import { formatKeyLabel } from '@/utils/noteSpelling';
import type {
  ChordPalette,
  ChordViewState,
  HeldChordPreview,
  ProgressionEditor,
  ProgressionHarmonize,
} from './useChordView';

/**
 * The progression card: the loop's chord sequence, the palette that appends to
 * it, and the three buttons that rewrite the whole thing.
 *
 * Deliberately NOT tinted: chord, bass and pad all read this progression, so
 * painting it `tint-chord` would read as "the chord layer's" when it belongs to
 * all three. The module tints resume on the three cards below it.
 */

type PreviewEvent = React.MouseEvent | React.TouchEvent | React.KeyboardEvent;

type SpellingKey = ChordViewState['spellingKey'];

/** The two chip rows' accent, as a table so the literals stay scannable. */
const HOLD_TONE: Record<'chord' | 'secondary', string> = {
  chord: 'hover:text-module-chord',
  secondary: 'hover:text-secondary',
};

interface HoldToPreviewButtonProps {
  tone: 'chord' | 'secondary';
  onDown: (e: PreviewEvent) => void;
  onUp: (e: PreviewEvent) => void;
}

/**
 * The speaker inside a quick-add chip: hold it to hear the chord, release to
 * stop. A nested `role="button"` span rather than a real button, because a
 * button inside a button is invalid — the rest of the chip appends, this part
 * auditions.
 */
function HoldToPreviewButton({ tone, onDown, onUp }: HoldToPreviewButtonProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchStart={onDown}
      onTouchEnd={onUp}
      onKeyDown={(e) => {
        // Press-and-hold audition: the key repeat would retrigger
        // the chord every few milliseconds.
        if (e.repeat) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        onDown(e);
      }}
      onKeyUp={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        onUp(e);
      }}
      onClick={(e) => e.stopPropagation()}
      className={`p-1 text-base-content/60 ${HOLD_TONE[tone]} transition-colors ml-0.5 rounded-selector hover:bg-base-300 cursor-pointer select-none`}
      title="Hold to Preview Chord Audio"
    >
      <Volume2 className="w-2.5 h-2.5" />
    </span>
  );
}

interface QuickAddPaletteProps {
  palette: ChordPalette;
  spellingKey: SpellingKey;
  use7thsInQuickAdd: boolean;
  onToggle7ths: () => void;
  onAddDiatonic: (degreeIndex: number) => void;
  onAddBorrowed: (root: string, quality: string) => void;
  previews: HeldChordPreview;
}

/**
 * The two rows of one-click chords: the key's own degrees, and the borrowed
 * ones that color outside it. Each chip appends on click and auditions on the
 * speaker — the appending is the primary action, the audition the second.
 */
function QuickAddPalette({
  palette,
  spellingKey,
  use7thsInQuickAdd,
  onToggle7ths,
  onAddDiatonic,
  onAddBorrowed,
  previews,
}: QuickAddPaletteProps) {
  const { handlePreviewMouseDown, handlePreviewMouseUp } = previews;
  const hold = (root: string, quality: string) => ({
    onDown: (e: PreviewEvent) => handlePreviewMouseDown(e, root, quality),
    onUp: handlePreviewMouseUp,
  });

  return (
    <div className="bg-base-100 border border-base-300 rounded-box p-3 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-module-chord font-medium">
          <Sparkles className="w-3.5 h-3.5 text-module-chord" />
          <span>
            In-Scale Chords ({formatKeyLabel(spellingKey.scaleRoot, spellingKey.scaleType)}):
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-base-content/60">
            Click to append, 🔊 to preview:
          </span>
          <button
            type="button"
            onClick={onToggle7ths}
            className={`btn btn-xs text-[10px] font-semibold ${
              use7thsInQuickAdd
                ? '[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]'
                : 'btn-ghost'
            }`}
          >
            {use7thsInQuickAdd ? '7th Chords' : 'Triads'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {palette.diatonicChords.map((diatonic, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onAddDiatonic(i)}
            className="btn btn-xs btn-soft group gap-1.5 h-auto py-1 normal-case"
            title={`Click to add ${formatChordLabel(diatonic.root, diatonic.quality, spellingKey)} (${diatonic.degreeName})`}
          >
            <span className="text-[10px] text-module-chord font-bold bg-base-300 px-1.5 py-0.5 rounded-selector">
              {diatonic.degreeName}
            </span>
            <span className="font-semibold">
              {formatChordLabel(diatonic.root, diatonic.quality, spellingKey)}
            </span>
            <HoldToPreviewButton tone="chord" {...hold(diatonic.root, diatonic.quality)} />
          </button>
        ))}
      </div>

      {/* Borrowed Chords (Modal Interchange) */}
      <div className="pt-2 border-t border-base-300/80">
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-1.5 text-secondary font-medium">
            <Music className="w-3.5 h-3.5 text-secondary" />
            <span>Borrowed Chords (Modal Interchange):</span>
          </div>
          <span className="text-[10px] text-base-content/60">
            Add colorful non-diatonic flavor:
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {palette.borrowedChords.map((borrowed, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAddBorrowed(borrowed.root, borrowed.quality)}
              className="btn btn-xs btn-soft btn-secondary group gap-1.5 h-auto py-1 normal-case"
              title={`Click to add ${borrowed.label}: ${formatChordLabel(borrowed.root, borrowed.quality, spellingKey)}`}
            >
              <span className="text-[10px] text-secondary font-bold bg-base-300 px-1.5 py-0.5 rounded-selector">
                {borrowed.label}
              </span>
              <span className="font-semibold">
                {formatChordLabel(borrowed.root, borrowed.quality, spellingKey)}
              </span>
              <HoldToPreviewButton tone="secondary" {...hold(borrowed.root, borrowed.quality)} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ProgressionActionsProps {
  onAddChord: () => void;
  onReharmonize: () => void;
  autoReharmonize: boolean;
  onToggleAutoReharmonize: () => void;
  /**
   * The paste button, built by ChordView: which clipboard groups a surface
   * accepts is the surface's decision, and the source-text guard in
   * ChordView.test.tsx reads that literal out of ChordView.tsx.
   */
  pasteButton: React.ReactNode;
}

/** The whole-progression actions, in the header's `right` slot. */
function ProgressionActions({
  onAddChord,
  onReharmonize,
  autoReharmonize,
  onToggleAutoReharmonize,
  pasteButton,
}: ProgressionActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        id="btn-add-chord"
        onClick={onAddChord}
        className="btn btn-xs gap-1 [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Add Chord</span>
      </button>

      {/* Option B Re-harmonize Button */}
      <button
        id="btn-reharmonize-chord-progression"
        onClick={onReharmonize}
        className="btn btn-xs btn-secondary btn-outline gap-1.5"
        title="Option B: Diatonically snap current chord progression to active key and scale"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Re-harmonize</span>
      </button>

      {/* Auto-Reharmonize Toggle */}
      <button
        id="btn-toggle-auto-reharmonize"
        onClick={onToggleAutoReharmonize}
        className={`btn btn-xs gap-1.5 font-semibold btn-secondary ${
          autoReharmonize ? '' : 'btn-soft'
        }`}
        title="Toggle automatic re-harmonization when loading presets or changing scales"
      >
        <Sparkles
          className={`w-3.5 h-3.5 ${autoReharmonize ? 'text-base' : 'text-secondary'}`}
        />
        <span>Auto-Reharmonize: {autoReharmonize ? 'ON' : 'OFF'}</span>
      </button>

      {/* Paste a copied chord progression into this card. Far right so
          it sits with the other whole-progression actions, not among
          the quick-add palette below. */}
      {pasteButton}
    </div>
  );
}

interface SortableProgressionProps {
  state: ChordViewState;
  editor: ProgressionEditor;
  previews: HeldChordPreview;
}

/** The drag-to-reorder row of chord cards. */
function SortableProgression({ state, editor, previews }: SortableProgressionProps) {
  const {
    chords, chordIds, scaleRoot, scaleType, meterId, playheadBeat,
    playheadChordIndex, playheadChordStartBeat,
  } = state;
  const { playingIndex, activeChordId } = state.playback;
  const { sensors, handleDragEnd } = editor;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={chordIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          {chords.map((chord, idx) => {
            const startBar = chords
              .slice(0, idx)
              .reduce((sum, c) => sum + (c.bars || 1), 1);
            const isActive = playingIndex === idx || activeChordId === chord.id;
            const beatsPerBar = beatsPerBarFor(meterId);
            const activeBeat =
              playheadChordIndex === idx
                ? resolveBeatCounter({
                    playheadBeat,
                    chordStartBeat: playheadChordStartBeat,
                    bars: chord.bars,
                    beatsPerBar,
                  }).activeBeat
                : null;
            return (
              <SortableChordCard
                key={chord.id}
                chord={chord}
                idx={idx}
                totalChords={chords.length}
                startBar={startBar}
                isActive={isActive}
                activeBeat={activeBeat}
                beatsPerBar={beatsPerBar}
                scaleRoot={scaleRoot}
                scaleType={scaleType}
                updateChord={editor.updateChord}
                removeChord={editor.removeChord}
                handleMoveChord={editor.handleMoveChord}
                handleCardPreviewMouseDown={previews.handleCardPreviewMouseDown}
                handleCardPreviewMouseUp={previews.handleCardPreviewMouseUp}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export interface ProgressionCardProps {
  state: ChordViewState;
  editor: ProgressionEditor;
  harmonize: ProgressionHarmonize;
  palette: ChordPalette;
  previews: HeldChordPreview;
  pasteButton: React.ReactNode;
}

export function ProgressionCard({
  state,
  editor,
  harmonize,
  palette,
  previews,
  pasteButton,
}: ProgressionCardProps) {
  const { chords, scaleRoot, scaleType, spellingKey } = state;

  return (
    <div className="card bg-panel border border-base-300 p-4 shadow-xl space-y-3">
      <ModuleHeader
        className="flex-wrap gap-2"
        right={
          <ProgressionActions
            onAddChord={editor.addChord}
            onReharmonize={harmonize.reharmonizeNow}
            autoReharmonize={harmonize.autoReharmonize}
            onToggleAutoReharmonize={harmonize.toggleAutoReharmonize}
            pasteButton={pasteButton}
          />
        }
      >
        <div className="flex items-center gap-2">
          {/* `Chord Progression`, not `Active Chord Progression Loop`:
              the navbar's loop selector already names the active loop, so
              `Active` and `Loop` restated it. SECTION_HEADER by constant —
              the literal that used to sit here spelled the same five classes
              in a different ORDER, which slipped past both guards in
              fieldClasses.test.ts (one matches the exact string, the other a
              fixed-order regex). That test is order-independent now. */}
          <span className={SECTION_HEADER}>Chord Progression</span>
          <span className={HEADER_BADGE}>{chords.length} Chords</span>
          {harmonize.isAutoReharmonizedIndicator && (
            <span
              className="badge badge-sm badge-secondary badge-outline gap-1 animate-fade-in"
              title="Automatically reharmonized to active scale"
            >
              <Sparkles className="w-3 h-3 text-secondary" />
              <span>Auto-Reharmonized to {formatKeyLabel(scaleRoot, scaleType)}</span>
            </span>
          )}
        </div>
      </ModuleHeader>

      <QuickAddPalette
        palette={palette}
        spellingKey={spellingKey}
        use7thsInQuickAdd={editor.use7thsInQuickAdd}
        onToggle7ths={() => editor.setUse7thsInQuickAdd(!editor.use7thsInQuickAdd)}
        onAddDiatonic={editor.addDiatonicChord}
        onAddBorrowed={editor.addBorrowedChord}
        previews={previews}
      />

      <SortableProgression state={state} editor={editor} previews={previews} />
    </div>
  );
}
