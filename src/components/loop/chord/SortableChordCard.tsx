import React, { useMemo } from "react";
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import { GripVertical, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChordItem } from "@/types";
import { ROOTS, formatChordQuality, generateBlockChordNotes, spellChordRoot } from "@/utils/musicTheory";
import { CHORD_QUALITY_GROUPS, type ChordQuality } from "@/musicCore";
import { spellNoteInKey } from "@/utils/noteSpelling";
import { BEATS_PER_BAR } from "@/utils/playhead";
import { BeatDots } from "@/components/ui/BeatDots";
import { IconButton } from "@/components/ui/IconButton";

export interface SortableChordCardProps {
  chord: ChordItem;
  octave: number;
  idx: number;
  totalChords: number;
  startBar: number;
  isActive: boolean;
  /** Beat sounding within this chord, 0-based; null when it is not playing. */
  activeBeat?: number | null;
  /** Beats per bar for the active meter; defaults to the 4/4 count. */
  beatsPerBar?: number;
  /**
   * The key this card SPELLS against, passed as two primitives rather than one
   * SpellingKey object on purpose: a fresh `{ scaleRoot, scaleType }` per
   * ChordView render would defeat the React.memo below on every beat.
   */
  scaleRoot: string;
  scaleType: string;
  updateChord: (id: string, updates: Partial<ChordItem>) => void;
  removeChord: (id: string) => void;
  handleMoveChord: (index: number, direction: -1 | 1) => void;
  handleCardPreviewMouseDown: (
    e: React.MouseEvent | React.TouchEvent,
    chord: ChordItem,
  ) => void;
  handleCardPreviewMouseUp: (
    e: React.MouseEvent | React.TouchEvent,
    chord: ChordItem,
  ) => void;
}

/** The key a card SPELLS against; see the note on the two props above. */
interface SpellingKey {
  scaleRoot: string;
  scaleType: string;
}

/**
 * The card's top band: the drag handle, the bar it starts on, and the reorder
 * and delete controls. Split out because the drag handle is the only place the
 * dnd-kit context reaches a button, and keeping it here means the rest of the
 * card reads as a chord rather than as a drag target.
 */
function ChordCardHeader({
  attributes,
  listeners,
  startBar,
  idx,
  totalChords,
  chordId,
  onMove,
  onRemove,
}: {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  startBar: number;
  idx: number;
  totalChords: number;
  chordId: string;
  onMove: SortableChordCardProps['handleMoveChord'];
  onRemove: SortableChordCardProps['removeChord'];
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <IconButton
          {...attributes}
          {...listeners}
          label="Drag to reorder"
          icon={<GripVertical className="w-3.5 h-3.5" />}
          size="xs"
          className="cursor-grab active:cursor-grabbing touch-none text-base-content/50 hover:text-base-content focus:outline-none"
        />
        <span className="badge badge-sm badge-ghost tabular-nums font-bold whitespace-nowrap">
          Bar {startBar}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {/* Below `sm` a card is half a phone wide: the grip reorders it
            (`touch-none` lets a touch drag it instead of scrolling). */}
        <div className="hidden sm:flex items-center gap-1">
          <IconButton
            label="Move Left"
            icon={<ChevronLeft className="w-3.5 h-3.5" />}
            size="xs"
            className="disabled:opacity-30"
            disabled={idx === 0}
            onClick={() => onMove(idx, -1)}
          />
          <IconButton
            label="Move Right"
            icon={<ChevronRight className="w-3.5 h-3.5" />}
            size="xs"
            className="disabled:opacity-30"
            disabled={idx === totalChords - 1}
            onClick={() => onMove(idx, 1)}
          />
        </div>
        <IconButton
          id={`btn-remove-chord-${chordId}`}
          label="Delete Chord"
          icon={<Trash2 className="w-3.5 h-3.5" />}
          size="xs"
          className="hover:text-error ml-1 disabled:opacity-30"
          disabled={totalChords <= 1}
          onClick={() => onRemove(chordId)}
        />
      </div>
    </div>
  );
}

/**
 * The chord's own trigger pad: hold it to audition the voicing, and read its
 * spelling, its notes and its beat dots. The beats are counted across the
 * chord's whole duration (`bars * beatsPerBar`), so a 2-bar chord's dots keep
 * counting into the second bar rather than restarting.
 */
function ChordTriggerPad({
  chord,
  octave,
  isActive,
  activeBeat,
  beatsPerBar,
  scaleRoot,
  scaleType,
  onDown,
  onUp,
}: {
  chord: ChordItem;
  octave: number;
  isActive: boolean;
  activeBeat: number | null;
  beatsPerBar: number;
  scaleRoot: string;
  scaleType: string;
  onDown: SortableChordCardProps['handleCardPreviewMouseDown'];
  onUp: SortableChordCardProps['handleCardPreviewMouseUp'];
}) {
  // A chord's notes are derived, not stored (DEV-396) — memoized here so an
  // activeBeat-only re-render (every beat while this chord plays) does not
  // re-run the Tonal resolution behind it on every tick.
  const spelledNotes = useMemo(
    () =>
      generateBlockChordNotes(chord.quality, chord.root, octave).map((n) =>
        spellNoteInKey(n, scaleRoot, scaleType),
      ),
    [chord.quality, chord.root, octave, scaleRoot, scaleType],
  );

  return (
    <button
      id={`btn-play-chord-${chord.id}`}
      onMouseDown={(e) => onDown(e, chord)}
      onMouseUp={(e) => onUp(e, chord)}
      onMouseLeave={(e) => onUp(e, chord)}
      onTouchStart={(e) => onDown(e, chord)}
      onTouchEnd={(e) => onUp(e, chord)}
      className={`w-full py-3 sm:py-4 rounded-field flex flex-col items-center justify-center transition-all cursor-pointer select-none ${
        isActive
          ? "bg-module-chord text-module-chord-content shadow-lg scale-95"
          : "bg-base-200 hover:bg-base-300 text-base-content"
      }`}
      title="Hold to Preview Chord"
    >
      <span className="text-xl sm:text-2xl font-black tracking-tight flex items-baseline gap-1">
        {spellChordRoot(chord.root, { scaleRoot, scaleType })}
        <span className="text-sm font-semibold opacity-70">
          {formatChordQuality(chord.quality)}
        </span>
      </span>
      <span className="hidden sm:block text-[10px] opacity-70 mt-1">
        {spelledNotes.join(" • ")}
      </span>
      <BeatDots
        size="sm"
        tone={isActive ? "contrast" : "chord"}
        totalBeats={Math.max(1, chord.bars || 1) * beatsPerBar}
        activeBeat={activeBeat}
        beatsPerBar={beatsPerBar}
        className="mt-2"
      />
    </button>
  );
}

/** Below `md` the fields read at a glance, so their captions stay for screen readers only. */
const LABEL_BELOW_MD = 'max-md:sr-only';

/** Below `md` a select gives its text the padding daisyUI keeps clear of the arrow's left (drawn 12–24px from the right edge). */
const SELECT_BELOW_MD = 'max-md:ps-2 max-md:pe-6';

/**
 * Root, quality and duration, on two rows at every width: Root and Duration
 * share the first, Quality takes the whole second. One row of three clipped
 * the widest options at every width — a card is 230–330px from `md` up and
 * under 200px on a phone.
 *
 * Root and quality are written back as `ROOTS`-spelled / union values — only
 * the root's LABEL is spelled for display, which is the same split KEY_OPTIONS
 * makes.
 */
function ChordEditControls({
  chord,
  spellingKey,
  updateChord,
}: {
  chord: ChordItem;
  spellingKey: SpellingKey;
  updateChord: SortableChordCardProps['updateChord'];
}) {
  return (
    <div className="grid grid-cols-[3.125rem_minmax(0,1fr)] md:grid-cols-[4rem_minmax(0,1fr)] gap-1 md:gap-2 pt-1 border-t border-base-300/60">
      <div className="min-w-0">
        <label className={`${FIELD_LABEL} ${LABEL_BELOW_MD}`} htmlFor={`select-chord-root-${chord.id}`}>
          Root
        </label>
        <select
          id={`select-chord-root-${chord.id}`}
          value={chord.root}
          onChange={(e) => updateChord(chord.id, { root: e.target.value })}
          className={`select select-xs w-full ${SELECT_BELOW_MD}`}
        >
          {ROOTS.map((r) => (
            <option key={r} value={r}>
              {spellChordRoot(r, spellingKey)}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label className={`${FIELD_LABEL} ${LABEL_BELOW_MD}`} htmlFor={`select-chord-bars-${chord.id}`}>
          Duration (Bars)
        </label>
        <select
          id={`select-chord-bars-${chord.id}`}
          value={chord.bars || 1}
          onChange={(e) =>
            updateChord(chord.id, { bars: parseInt(e.target.value, 10) })
          }
          className={`select select-xs w-full ${SELECT_BELOW_MD}`}
        >
          <option value={1}>1 Bar</option>
          <option value={2}>2 Bars</option>
          <option value={4}>4 Bars</option>
        </select>
      </div>

      <div className="col-span-2 min-w-0">
        <label className={`${FIELD_LABEL} ${LABEL_BELOW_MD}`} htmlFor={`select-chord-quality-${chord.id}`}>
          Quality
        </label>
        {/* Below `md` the closed select shows the quality token ("min7")
            instead of its picker label ("Minor 7th (min7)"), which does not
            fit a phone's half-width card. The select keeps its value and its
            full option labels; only its closed face is painted over. The text
            is hidden through its fill colour, not `color`: daisyUI draws the
            arrow in `currentColor`. */}
        <div className="relative">
          <select
            id={`select-chord-quality-${chord.id}`}
            value={chord.quality}
            onChange={(e) => updateChord(chord.id, { quality: e.target.value as ChordQuality })}
            className={`select select-xs w-full ${SELECT_BELOW_MD} max-md:[-webkit-text-fill-color:transparent] [&_optgroup]:[-webkit-text-fill-color:initial] [&_option]:[-webkit-text-fill-color:initial]`}
          >
            {CHORD_QUALITY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span aria-hidden="true" className="md:hidden pointer-events-none absolute inset-y-0 left-0 right-6 flex items-center pl-2 text-[11px]">
            <span className="truncate">{chord.quality}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized: ChordView re-renders on every beat (it subscribes to
 * playheadBeat) but only one card's `activeBeat` actually changes. All five
 * callback props are stable useCallbacks in ChordView, so the default
 * shallow prop comparison is meaningful. `useSortable` below still
 * subscribes to the drag context, so cards do re-render during a drag.
 */
export const SortableChordCard = React.memo(function SortableChordCard({
  chord,
  octave,
  idx,
  totalChords,
  startBar,
  isActive,
  activeBeat = null,
  beatsPerBar = BEATS_PER_BAR,
  scaleRoot,
  scaleType,
  updateChord,
  removeChord,
  handleMoveChord,
  handleCardPreviewMouseDown,
  handleCardPreviewMouseUp,
}: SortableChordCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chord.id });

  const spellingKey = { scaleRoot, scaleType };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card bg-panel border border-base-300 p-2 sm:p-4 flex flex-col justify-between space-y-2 sm:space-y-3 transition-colors ${
        isActive
          ? "border-module-chord ring-2 ring-module-chord/50 bg-base-200"
          : "border-base-300 hover:border-base-content/30"
      } ${isDragging ? "shadow-2xl ring-2 ring-module-chord bg-base-200/95 scale-105" : ""}`}
    >
      <ChordCardHeader
        attributes={attributes}
        listeners={listeners}
        startBar={startBar}
        idx={idx}
        totalChords={totalChords}
        chordId={chord.id}
        onMove={handleMoveChord}
        onRemove={removeChord}
      />

      <ChordTriggerPad
        chord={chord}
        octave={octave}
        isActive={isActive}
        activeBeat={activeBeat}
        beatsPerBar={beatsPerBar}
        scaleRoot={scaleRoot}
        scaleType={scaleType}
        onDown={handleCardPreviewMouseDown}
        onUp={handleCardPreviewMouseUp}
      />

      <ChordEditControls
        chord={chord}
        spellingKey={spellingKey}
        updateChord={updateChord}
      />
    </div>
  );
});
