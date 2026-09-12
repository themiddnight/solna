import React from "react";
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import { GripVertical, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChordItem } from "@/types";
import { ROOTS, formatChordQuality, spellChordRoot } from "@/utils/musicTheory";
import { spellNoteInKey } from "@/utils/noteSpelling";
import { BEATS_PER_BAR } from "@/utils/playhead";
import { BeatDots } from "@/components/ui/BeatDots";
import { IconButton } from "@/components/ui/IconButton";

export interface SortableChordCardProps {
  chord: ChordItem;
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
 * The quality dropdown's option groups, as data rather than markup.
 *
 * The list is closed — `ChordItem['quality']` is a union — and it was 24
 * hand-written `<option>` lines in the middle of the card's JSX, which is what
 * pushed the component past the function limit. As a table it is one line per
 * chord and adding one is an edit to a list a reviewer can read end to end.
 */
const QUALITY_GROUPS: {
  label: string;
  options: { value: ChordItem['quality']; label: string }[];
}[] = [
  {
    label: "Triads",
    options: [
      { value: "maj", label: "Major (maj)" },
      { value: "min", label: "Minor (min)" },
      { value: "dim", label: "Diminished (dim)" },
      { value: "aug", label: "Augmented (aug)" },
      { value: "sus2", label: "Sus 2" },
      { value: "sus4", label: "Sus 4" },
    ],
  },
  {
    label: "7th Chords",
    options: [
      { value: "maj7", label: "Major 7th (maj7)" },
      { value: "min7", label: "Minor 7th (min7)" },
      { value: "7", label: "Dominant 7th (7)" },
      { value: "m7b5", label: "Half-Dim (m7b5)" },
      { value: "dim7", label: "Diminished 7th (dim7)" },
      { value: "7sus4", label: "7 Sus 4" },
    ],
  },
  {
    label: "Extensions & Additions",
    options: [
      { value: "9", label: "Dominant 9th (9)" },
      { value: "maj9", label: "Major 9th (maj9)" },
      { value: "min9", label: "Minor 9th (min9)" },
      { value: "add9", label: "Add 9" },
      { value: "6", label: "Major 6th (6)" },
      { value: "min6", label: "Minor 6th (min6)" },
    ],
  },
];

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
          className="cursor-grab active:cursor-grabbing text-base-content/50 hover:text-base-content focus:outline-none"
        />
        <span className="badge badge-sm badge-ghost tabular-nums font-bold">
          Bar {startBar}
        </span>
      </div>
      <div className="flex items-center gap-1">
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
  isActive,
  activeBeat,
  beatsPerBar,
  scaleRoot,
  scaleType,
  onDown,
  onUp,
}: {
  chord: ChordItem;
  isActive: boolean;
  activeBeat: number | null;
  beatsPerBar: number;
  scaleRoot: string;
  scaleType: string;
  onDown: SortableChordCardProps['handleCardPreviewMouseDown'];
  onUp: SortableChordCardProps['handleCardPreviewMouseUp'];
}) {
  return (
    <button
      id={`btn-play-chord-${chord.id}`}
      onMouseDown={(e) => onDown(e, chord)}
      onMouseUp={(e) => onUp(e, chord)}
      onMouseLeave={(e) => onUp(e, chord)}
      onTouchStart={(e) => onDown(e, chord)}
      onTouchEnd={(e) => onUp(e, chord)}
      className={`w-full py-4 rounded-field flex flex-col items-center justify-center transition-all cursor-pointer select-none ${
        isActive
          ? "bg-module-chord text-module-chord-content shadow-lg scale-95"
          : "bg-base-200 hover:bg-base-300 text-base-content"
      }`}
      title="Hold to Preview Chord"
    >
      <span className="text-2xl font-black tracking-tight flex items-baseline gap-1">
        {spellChordRoot(chord.root, { scaleRoot, scaleType })}
        <span className="text-sm font-semibold opacity-70">
          {formatChordQuality(chord.quality)}
        </span>
      </span>
      <span className="text-[10px] opacity-70 mt-1">
        {chord.notes.map((n) => spellNoteInKey(n, scaleRoot, scaleType)).join(" • ")}
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

/**
 * Root, quality and duration. Root and quality are written back as `ROOTS`-
 * spelled / union values — only the root's LABEL is spelled for display, which
 * is the same split KEY_OPTIONS makes.
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
    <div className="flex gap-2 pt-1 border-t border-base-300/60">
      <div className="shrink min-w-0">
        <label className={FIELD_LABEL} htmlFor={`select-chord-root-${chord.id}`}>
          Root
        </label>
        <select
          id={`select-chord-root-${chord.id}`}
          value={chord.root}
          onChange={(e) => updateChord(chord.id, { root: e.target.value })}
          className="select select-xs w-full"
        >
          {ROOTS.map((r) => (
            <option key={r} value={r}>
              {spellChordRoot(r, spellingKey)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-0">
        <label className={FIELD_LABEL} htmlFor={`select-chord-quality-${chord.id}`}>
          Quality
        </label>
        <select
          id={`select-chord-quality-${chord.id}`}
          value={chord.quality}
          onChange={(e) => updateChord(chord.id, { quality: e.target.value })}
          className="select select-xs w-full"
        >
          {QUALITY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="shrink min-w-0">
        <label className={FIELD_LABEL} htmlFor={`select-chord-bars-${chord.id}`}>
          Duration (Bars)
        </label>
        <select
          id={`select-chord-bars-${chord.id}`}
          value={chord.bars || 1}
          onChange={(e) =>
            updateChord(chord.id, { bars: parseInt(e.target.value, 10) })
          }
          className="select select-xs w-full"
        >
          <option value={1}>1 Bar</option>
          <option value={2}>2 Bars</option>
          <option value={4}>4 Bars</option>
        </select>
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
      className={`card bg-panel border border-base-300 p-4 flex flex-col justify-between space-y-3 transition-colors ${
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
