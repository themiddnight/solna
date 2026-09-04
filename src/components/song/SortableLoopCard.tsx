import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GripVertical,
  Music,
  Pencil,
  Play,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Loop, LoopMixPatch } from '../../store/types';
import { loopBars } from '../../store/loop';
import { formatChordQuality } from '../../utils/musicTheory';
import { PowerToggle, type PowerToggleTone } from '../ui/PowerToggle';
import { Slider } from '../ui/Slider';

/**
 * Calculates which chord index in the progression is active given current step in loop.
 */
export function getActiveChordIndex(
  chords: readonly { bars?: number }[],
  stepInLoop: number,
  stepsPerBar: number,
): number {
  if (!chords || chords.length === 0 || stepsPerBar <= 0) return -1;
  const totalBars = loopBars(chords);
  if (totalBars <= 0) return -1;
  const totalCycleSteps = totalBars * stepsPerBar;
  const stepInCycle = ((stepInLoop % totalCycleSteps) + totalCycleSteps) % totalCycleSteps;
  const currentBar = Math.floor(stepInCycle / stepsPerBar);

  let accumulatedBars = 0;
  for (let i = 0; i < chords.length; i++) {
    const chordBars = chords[i].bars || 1;
    if (currentBar >= accumulatedBars && currentBar < accumulatedBars + chordBars) {
      return i;
    }
    accumulatedBars += chordBars;
  }
  return chords.length - 1;
}

export type MixChannelProps = {
  idPrefix: string;
  label: string;
  volume: number;
  muted: boolean;
  max: number;
  tone: PowerToggleTone;
  sliderAccent: string;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
};

/** One compact mixer strip (mute + gain) inside a loop card. */
export const MixChannel: React.FC<MixChannelProps> = ({
  idPrefix,
  label,
  volume,
  muted,
  max,
  tone,
  sliderAccent,
  onVolume,
  onToggleMute,
}) => (
  <div
    className={`flex flex-col gap-1 p-2 rounded-box bg-base-100 border border-base-300/60 transition-opacity ${
      muted ? 'opacity-50' : 'opacity-100'
    }`}
  >
    <div className="flex items-center justify-between gap-1">
      <div className="flex items-center gap-1.5 min-w-0">
        {muted ? (
          <VolumeX className="w-3 h-3 text-base-content/40 shrink-0" />
        ) : (
          <Volume2 className="w-3 h-3 text-base-content/70 shrink-0" />
        )}
        <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/70 truncate">
          {label}
        </span>
      </div>
      <PowerToggle
        id={`btn-mute-${idPrefix}`}
        on={!muted}
        onToggle={onToggleMute}
        name={`${label} mute`}
        tone={tone}
        size="xs"
        iconOnly
        verb={{ on: 'Unmute', off: 'Mute' }}
      />
    </div>
    <div className="flex items-center gap-1.5 mt-0.5">
      <Slider
        id={`slider-${idPrefix}`}
        min={0}
        max={max}
        step={0.05}
        value={volume}
        onChange={onVolume}
        className={`range range-xs ${sliderAccent} w-full`}
        title={`${label} gain`}
      />
      <span className="text-[10px] font-mono w-8 text-right shrink-0 text-base-content/80">
        {Math.round(volume * 100)}%
      </span>
    </div>
  </div>
);

export interface SortableLoopCardProps {
  loop: Loop;
  index: number;
  totalLoops: number;
  isPlaying: boolean;
  isAuditioning?: boolean;
  /** Scope rule: disabled while the song owns the transport, and on every
   *  non-soloing card while another loop is soloing. */
  playDisabled?: boolean;
  isActive: boolean;
  progressPercent?: number;
  currentStepInLoop?: number;
  totalStepsInLoop?: number;
  singleCycleSteps?: number;
  currentRep?: number;
  repeatCount?: number;
  stepsPerBar?: number;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
  onRename: (id: string, name: string) => void;
  onSetRepeat: (id: string, repeatCount: number) => void;
  onTogglePlayLoop: (id: string) => void;
  onSetMix: (id: string, patch: Partial<LoopMixPatch>) => void;
}

export const SortableLoopCard: React.FC<SortableLoopCardProps> = React.memo(
  function SortableLoopCard({
    loop,
    index,
    totalLoops,
    isPlaying,
    isAuditioning = false,
    playDisabled = false,
    isActive,
    progressPercent = 0,
    currentStepInLoop = 0,
    totalStepsInLoop = 16,
    singleCycleSteps = 16,
    currentRep = 1,
    repeatCount = 1,
    stepsPerBar = 4,
    onSelect,
    onEdit,
    onDuplicate,
    onDelete,
    onReorder,
    onRename,
    onSetRepeat,
    onTogglePlayLoop,
    onSetMix,
  }) {
    const [isEditingName, setIsEditingName] = useState(false);
    const [tempName, setTempName] = useState(loop.name);

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: loop.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 30 : undefined,
      opacity: isDragging ? 0.6 : 1,
    };

    const bars = loopBars(loop.chords);
    const activeChordIndex = isPlaying
      ? getActiveChordIndex(loop.chords, currentStepInLoop, stepsPerBar)
      : -1;

    const handleSaveName = () => {
      const trimmed = tempName.trim();
      if (trimmed && trimmed !== loop.name) {
        onRename(loop.id, trimmed);
      } else {
        setTempName(loop.name);
      }
      setIsEditingName(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSaveName();
      } else if (e.key === 'Escape') {
        setTempName(loop.name);
        setIsEditingName(false);
      }
    };

    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Don't trigger card selection if clicking interactive controls (buttons, inputs, selects, range sliders, drag handles)
      if (
        target.closest(
          'button, input, select, textarea, [role="button"], [role="slider"], .range, .select, [data-no-card-select]'
        )
      ) {
        return;
      }

      onSelect(loop.id);
    };

    return (
      /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the card click is a shortcut for the loop-name button inside it (line 343), which is a real focusable control; the handler already ignores clicks that landed on a control. */
      <div
        id={`card-loop-${loop.id}`}
        ref={setNodeRef}
        style={style}
        onClick={handleCardClick}
        className={`card card-border bg-base-200 border transition-all shadow-xs cursor-pointer ${
          isAuditioning
            ? 'border-accent ring-2 ring-accent/60 bg-accent/5'
            : isPlaying
            ? 'border-primary ring-1 ring-primary bg-primary/5'
            : isActive
            ? 'border-primary/50 bg-base-200 ring-1 ring-primary/20'
            : 'border-base-300 hover:border-base-content/20'
        }`}
      >
        {/* Progress bar for playing loop */}
        <div className="w-full h-1 bg-base-300 overflow-hidden rounded-t-box">
          {isPlaying && (
            <div
              className={`h-full transition-all duration-75 ease-linear ${
                isAuditioning ? 'bg-accent' : 'bg-primary'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          )}
        </div>

        <div className="p-3 sm:p-4 flex flex-col gap-3">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* `flex-wrap` is load-bearing: this group holds seven items whose
                widths are content-driven (the loop name, a bar count, a live
                "Playing 7/64 (Rep 1/2)" badge), and as a single non-wrapping
                row they overlapped each other on a phone rather than
                overflowing visibly. `basis-full` keeps the action cluster
                beside it from being squeezed onto the same short line. */}
            <div className="flex flex-wrap items-center gap-2 min-w-0 basis-full sm:basis-0 sm:flex-1">
              {/* Drag Handle */}
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="btn btn-ghost btn-xs btn-square cursor-grab active:cursor-grabbing text-base-content/40 hover:text-base-content"
                aria-label={`Drag to reorder ${loop.name}`}
                title="Drag to reorder"
              >
                <GripVertical className="w-4 h-4" />
              </button>

              {/* Order index badge */}
              <span className="badge badge-sm badge-neutral font-mono font-bold shrink-0">
                {`#${index + 1}`}
              </span>

              {/* Dedicated Play / Stop button for this specific loop */}
              <button
                id={`btn-loop-play-${loop.id}`}
                type="button"
                aria-label={isAuditioning ? `Stop ${loop.name}` : `Play only ${loop.name}`}
                onClick={() => onTogglePlayLoop(loop.id)}
                disabled={playDisabled}
                className={`btn btn-xs gap-1 font-bold shadow-xs transition-all ${
                  isAuditioning
                    ? 'btn-error text-error-content hover:brightness-110'
                    : 'btn-success text-success-content hover:brightness-110'
                } disabled:opacity-30`}
                title={isAuditioning ? 'Stop loop audition' : 'Play only this loop (isolated)'}
              >
                {isAuditioning ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    Play
                  </>
                )}
              </button>

              {/* Editable Name or Display */}
              {isEditingName ? (
                <div className="flex items-center gap-1">
                  <input
                    id={`input-loop-name-${loop.id}`}
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveName}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- the input replaces the name in place on an explicit rename click; focusing it is the action the user asked for.
                    autoFocus
                    className="input input-xs input-bordered font-bold max-w-40 sm:max-w-56"
                    placeholder="Loop name..."
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    className="btn btn-xs btn-square btn-ghost text-success"
                    title="Save name"
                    aria-label="Save loop name"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 min-w-0">
                  <button
                    id={`btn-loop-select-${loop.id}`}
                    type="button"
                    onClick={() => onSelect(loop.id)}
                    className="btn btn-sm btn-ghost p-1 font-bold text-base-content hover:text-primary flex items-center gap-1.5 min-w-0 text-left"
                    title="Click to cue/select loop"
                  >
                    <span className="truncate text-sm sm:text-base">{loop.name}</span>
                  </button>
                  <button
                    id={`btn-loop-rename-${loop.id}`}
                    type="button"
                    onClick={() => {
                      setTempName(loop.name);
                      setIsEditingName(true);
                    }}
                    className="btn btn-xs btn-ghost btn-square text-base-content/40 hover:text-base-content"
                    title="Rename loop"
                    aria-label={`Rename ${loop.name}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Bar count badge */}
              <span className="badge badge-sm badge-ghost font-mono text-base-content/60 shrink-0">
                {`${bars} ${bars === 1 ? 'bar' : 'bars'}`}
              </span>

              {/* Status Badge */}
              {isAuditioning ? (
                <span className="badge badge-sm badge-accent gap-1 font-mono uppercase font-bold shrink-0 animate-pulse">
                  <Play className="w-2.5 h-2.5 fill-current" />
                  {`Solo ${currentStepInLoop + 1}/${singleCycleSteps}`}
                </span>
              ) : isPlaying ? (
                <span className="badge badge-sm badge-primary gap-1 font-mono uppercase font-bold shrink-0 animate-pulse">
                  <Play className="w-2.5 h-2.5 fill-current" />
                  {repeatCount > 1
                    ? `Playing ${currentStepInLoop + 1}/${totalStepsInLoop} (Rep ${currentRep}/${repeatCount})`
                    : `Playing ${currentStepInLoop + 1}/${totalStepsInLoop}`}
                </span>
              ) : isActive ? (
                <span className="badge badge-sm badge-outline badge-primary font-mono text-[10px] uppercase font-bold shrink-0">
                  Active Cue
                </span>
              ) : null}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                id={`btn-loop-edit-${loop.id}`}
                type="button"
                aria-label={`Edit ${loop.name}`}
                onClick={() => onEdit(loop.id)}
                className="btn btn-xs btn-outline btn-primary gap-1"
              >
                <Music className="w-3 h-3" />
                Edit
              </button>
              <button
                id={`btn-loop-up-${loop.id}`}
                type="button"
                aria-label={`Move ${loop.name} up`}
                disabled={index === 0}
                onClick={() => onReorder(loop.id, -1)}
                className="btn btn-xs btn-square btn-ghost text-base-content/70 hover:text-base-content"
                title="Move up"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                id={`btn-loop-down-${loop.id}`}
                type="button"
                aria-label={`Move ${loop.name} down`}
                disabled={index === totalLoops - 1}
                onClick={() => onReorder(loop.id, 1)}
                className="btn btn-xs btn-square btn-ghost text-base-content/70 hover:text-base-content"
                title="Move down"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                id={`btn-loop-duplicate-${loop.id}`}
                type="button"
                aria-label={`Duplicate ${loop.name}`}
                onClick={() => onDuplicate(loop.id)}
                className="btn btn-xs btn-square btn-ghost text-base-content/70 hover:text-base-content"
                title="Duplicate loop"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                id={`btn-loop-delete-${loop.id}`}
                type="button"
                aria-label={`Delete ${loop.name}`}
                disabled={totalLoops <= 1}
                onClick={() => onDelete(loop.id)}
                className="btn btn-xs btn-square btn-ghost text-error/80 hover:text-error hover:bg-error/10 disabled:opacity-30"
                title="Delete loop"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Key / Scale & Chord Progression Information & Repeat Setting */}
          <div className="flex flex-wrap items-center gap-2 p-2 rounded-box bg-base-100/60 border border-base-300/40 text-xs">
            {/* Key / Scale Display */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
                Key:
              </span>
              <span className="badge badge-sm badge-outline gap-1 font-mono">
                <span className="font-bold text-primary">{loop.scaleRoot}</span>
                <span className="text-base-content/70">{loop.scaleType}</span>
              </span>
            </div>

            <div className="divider divider-horizontal my-0 mx-0.5 hidden sm:flex" />

            {/* Loop Repeat Setting */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
                Repeat:
              </span>
              <select
                id={`select-repeat-${loop.id}`}
                value={loop.repeatCount ?? 1}
                onChange={(e) => onSetRepeat(loop.id, Number(e.target.value))}
                className="select select-xs select-bordered font-mono font-bold bg-base-100/80"
                aria-label={`Repeat count for ${loop.name}`}
                title="Number of times this loop plays before advancing in song mode"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
                <option value={4}>4x</option>
                <option value={6}>6x</option>
                <option value={8}>8x</option>
                <option value={12}>12x</option>
                <option value={16}>16x</option>
              </select>
            </div>

            <div className="divider divider-horizontal my-0 mx-0.5 hidden sm:flex" />

            {/* Chord Progression Display with Real-Time Highlighting.
                `basis-full` below `sm`: sharing a row with Key and Repeat leaves
                a phone about 40px for the label plus every chord, which pushed
                "Progression:" past the card's right edge. Its own line fits both. */}
            <div className="flex flex-wrap items-center gap-1.5 basis-full sm:basis-0 sm:flex-1 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50 shrink-0">
                Progression:
              </span>
              {loop.chords && loop.chords.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {loop.chords.map((chord, cIdx) => {
                    const isChordActive = isPlaying && cIdx === activeChordIndex;
                    return (
                      <span
                        key={chord.id || `${chord.root}-${cIdx}`}
                        className={`badge badge-sm gap-1 font-mono transition-all duration-150 ${
                          isChordActive
                            ? 'badge-primary font-bold ring-2 ring-primary/60 shadow-sm scale-105'
                            : 'bg-base-200 border border-base-300'
                        }`}
                        title={chord.notes?.length ? `Notes: ${chord.notes.join(', ')}` : undefined}
                      >
                        <span
                          className={
                            isChordActive
                              ? 'text-primary-content font-bold'
                              : 'font-bold text-base-content'
                          }
                        >
                          {`${chord.root}${formatChordQuality(chord.quality)}`}
                        </span>
                        <span
                          className={`text-[9px] ${
                            isChordActive
                              ? 'text-primary-content/80'
                              : 'text-base-content/50'
                          }`}
                        >
                          {`${chord.bars ?? 1}b`}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="text-base-content/40 italic">No chords</span>
              )}
            </div>
          </div>

          {/* 4-Channel Mixer Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 pt-0.5">
            <MixChannel
              idPrefix={`synth-${loop.id}`}
              label="Lead"
              volume={loop.synthVolume}
              muted={loop.synthMuted}
              max={1.5}
              tone="primary"
              sliderAccent="text-primary"
              onVolume={(v) => onSetMix(loop.id, { synthVolume: v })}
              onToggleMute={() => onSetMix(loop.id, { synthMuted: !loop.synthMuted })}
            />
            <MixChannel
              idPrefix={`drum-${loop.id}`}
              label="Drum"
              volume={loop.masterSequencerVolume}
              muted={loop.drumMuted}
              max={1.0}
              tone="accent"
              sliderAccent="text-accent"
              onVolume={(v) => onSetMix(loop.id, { masterSequencerVolume: v })}
              onToggleMute={() => onSetMix(loop.id, { drumMuted: !loop.drumMuted })}
            />
            <MixChannel
              idPrefix={`chord-${loop.id}`}
              label="Chord"
              volume={loop.chordVolume}
              muted={loop.chordMuted}
              max={1.5}
              tone="module-chord"
              sliderAccent="text-module-chord"
              onVolume={(v) => onSetMix(loop.id, { chordVolume: v })}
              onToggleMute={() => onSetMix(loop.id, { chordMuted: !loop.chordMuted })}
            />
            <MixChannel
              idPrefix={`bass-${loop.id}`}
              label="Bass"
              volume={loop.bassVolume}
              muted={loop.bassMuted}
              max={1.5}
              tone="module-bass"
              sliderAccent="text-module-bass"
              onVolume={(v) => onSetMix(loop.id, { bassVolume: v })}
              onToggleMute={() => onSetMix(loop.id, { bassMuted: !loop.bassMuted })}
            />
          </div>
        </div>
      </div>
    );
  }
);
