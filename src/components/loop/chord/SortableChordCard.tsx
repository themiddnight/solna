import React from "react";
import { FIELD_LABEL } from '../../ui/fieldClasses';
import { GripVertical, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChordItem } from "../../../types";
import { ROOTS, formatChordQuality } from "../../../utils/musicTheory";
import { BEATS_PER_BAR } from "../../../utils/playhead";
import { BeatDots } from "../../ui/BeatDots";
import { IconButton } from "../../ui/IconButton";

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
      {/* Header */}
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
            onClick={() => handleMoveChord(idx, -1)}
          />
          <IconButton
            label="Move Right"
            icon={<ChevronRight className="w-3.5 h-3.5" />}
            size="xs"
            className="disabled:opacity-30"
            disabled={idx === totalChords - 1}
            onClick={() => handleMoveChord(idx, 1)}
          />
          <IconButton
            id={`btn-remove-chord-${chord.id}`}
            label="Delete Chord"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            size="xs"
            className="hover:text-error ml-1 disabled:opacity-30"
            disabled={totalChords <= 1}
            onClick={() => removeChord(chord.id)}
          />
        </div>
      </div>

      {/* Big Interactive Chord Trigger Pad */}
      <button
        id={`btn-play-chord-${chord.id}`}
        onMouseDown={(e) => handleCardPreviewMouseDown(e, chord)}
        onMouseUp={(e) => handleCardPreviewMouseUp(e, chord)}
        onMouseLeave={(e) => handleCardPreviewMouseUp(e, chord)}
        onTouchStart={(e) => handleCardPreviewMouseDown(e, chord)}
        onTouchEnd={(e) => handleCardPreviewMouseUp(e, chord)}
        className={`w-full py-4 rounded-field flex flex-col items-center justify-center transition-all cursor-pointer select-none ${
          isActive
            ? "bg-module-chord text-module-chord-content shadow-lg scale-95"
            : "bg-base-200 hover:bg-base-300 text-base-content"
        }`}
        title="Hold to Preview Chord"
      >
        <span className="text-2xl font-mono font-black tracking-tight flex items-baseline gap-1">
          {chord.root}
          <span className="text-sm font-semibold opacity-70">
            {formatChordQuality(chord.quality)}
          </span>
        </span>
        <span className="text-[10px] opacity-70 font-mono mt-1">
          {chord.notes.join(" • ")}
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

      {/* Edit Controls */}
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
                {r}
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
            <optgroup label="Triads">
              <option value="maj">Major (maj)</option>
              <option value="min">Minor (min)</option>
              <option value="dim">Diminished (dim)</option>
              <option value="aug">Augmented (aug)</option>
              <option value="sus2">Sus 2</option>
              <option value="sus4">Sus 4</option>
            </optgroup>
            <optgroup label="7th Chords">
              <option value="maj7">Major 7th (maj7)</option>
              <option value="min7">Minor 7th (min7)</option>
              <option value="7">Dominant 7th (7)</option>
              <option value="m7b5">Half-Dim (m7b5)</option>
              <option value="dim7">Diminished 7th (dim7)</option>
              <option value="7sus4">7 Sus 4</option>
            </optgroup>
            <optgroup label="Extensions & Additions">
              <option value="9">Dominant 9th (9)</option>
              <option value="maj9">Major 9th (maj9)</option>
              <option value="min9">Minor 9th (min9)</option>
              <option value="add9">Add 9</option>
              <option value="6">Major 6th (6)</option>
              <option value="min6">Minor 6th (min6)</option>
            </optgroup>
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
    </div>
  );
});
