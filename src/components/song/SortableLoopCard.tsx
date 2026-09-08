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
import { Loop, LoopMixPatch } from '@/store/types';
import { ChordItem } from '@/types';
import { loopBars } from '@/store/loop';
import { formatChordQuality } from '@/utils/musicTheory';
import { getTonicSpelling } from '@/utils/noteSpelling';
import { PowerToggle, type PowerToggleTone } from '../ui/PowerToggle';
import { MIX_LAYERS } from '../mixLayers';
import { VolumeFader } from '../ui/VolumeFader';

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

export interface MixChannelProps {
  idPrefix: string;
  label: string;
  /** DECIBELS: unity is 0, the range is -60..+12 — same as ChannelStrip's
   *  `volumeDb`, renamed to match for the same reason. */
  volumeDb: number;
  muted: boolean;
  tone: PowerToggleTone;
  sliderAccent: string;
  onVolumeDbChange: (db: number) => void;
  onToggleMute: () => void;
}

/** One compact mixer strip (mute + gain) inside a loop card. */
export function MixChannel({
  idPrefix,
  label,
  volumeDb,
  muted,
  tone,
  sliderAccent,
  onVolumeDbChange,
  onToggleMute,
}: MixChannelProps) {
  return (
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
        {/* The same fader the channel strips and the transport bar use, so
            these five agree with them about where unity sits, what the bottom
            of the travel means and how a level is spelled. There is no per-bus
            `max` any more: every bus shares the -60..+12 dB range, and a
            per-bus ceiling would make the same position mean two levels. */}
        <VolumeFader
          id={`slider-${idPrefix}`}
          label={`${label} gain`}
          valueDb={volumeDb}
          onChangeDb={onVolumeDbChange}
          className={`range range-xs ${sliderAccent} w-full`}
        />
      </div>
    </div>
  );
}

export interface SortableLoopCardProps {
  loop: Loop;
  index: number;
  totalLoops: number;
  isPlaying: boolean;
  isAuditioning?: boolean;
  /** Scope rule: disabled while the song owns the transport, and on every
   *  non-auditioning card while another loop is being auditioned. */
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

/**
 * The card's border/ring/tint, as one string. A card is auditioning, or playing, or
 * merely cued, or idle — one state, four looks — so the choice is a function of
 * three booleans and reads better named than as a four-deep ternary inside the
 * className template.
 */
function loopCardAccent({
  isAuditioning,
  isPlaying,
  isActive,
}: {
  isAuditioning: boolean;
  isPlaying: boolean;
  isActive: boolean;
}): string {
  if (isAuditioning) return 'border-accent ring-2 ring-accent/60 bg-accent/5';
  if (isPlaying) return 'border-primary ring-1 ring-primary bg-primary/5';
  if (isActive) return 'border-primary/50 bg-base-200 ring-1 ring-primary/20';
  return 'border-base-300 hover:border-base-content/20';
}

interface LoopAuditionButtonProps {
  loopId: string;
  loopName: string;
  isAuditioning: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}

/**
 * Play-only / stop for one loop. Every branch in it asks the same question —
 * is this loop the one being auditioned — and answers it four times over
 * (label, tint, tooltip, icon), which is four of the card's branches spent on
 * one boolean. Named for AUDITION, not SOLO: track solo (`soloTracks` in the
 * ui slice, resolved by src/store/trackAudibility.ts) is a different feature
 * with its own buttons and this button has nothing to do with them.
 */
function LoopAuditionButton({ loopId, loopName, isAuditioning, disabled, onToggle }: LoopAuditionButtonProps) {
  return (
    <button
      id={`btn-loop-play-${loopId}`}
      type="button"
      aria-label={isAuditioning ? `Stop ${loopName}` : `Play only ${loopName}`}
      onClick={() => onToggle(loopId)}
      disabled={disabled}
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
  );
}

interface LoopStatusBadgeProps {
  isAuditioning: boolean;
  isPlaying: boolean;
  isActive: boolean;
  currentStepInLoop: number;
  singleCycleSteps: number;
  totalStepsInLoop: number;
  currentRep: number;
  repeatCount: number;
}

/** The card's one status badge: auditioning, playing, cued, or nothing. The
 *  word is AUDITION, not SOLO: per-TRACK solo (`soloTracks` in the ui slice,
 *  resolved by src/store/trackAudibility.ts) lives on the editing surfaces,
 *  and one screen must not use the same word for playing one loop alone and
 *  for hearing one track alone. */
function LoopStatusBadge({
  isAuditioning,
  isPlaying,
  isActive,
  currentStepInLoop,
  singleCycleSteps,
  totalStepsInLoop,
  currentRep,
  repeatCount,
}: LoopStatusBadgeProps) {
  if (isAuditioning) {
    return (
      <span className="badge badge-sm badge-accent gap-1 font-mono uppercase font-bold shrink-0 animate-pulse">
        <Play className="w-2.5 h-2.5 fill-current" />
        {`Audition ${currentStepInLoop + 1}/${singleCycleSteps}`}
      </span>
    );
  }
  if (isPlaying) {
    const position = `Playing ${currentStepInLoop + 1}/${totalStepsInLoop}`;
    return (
      <span className="badge badge-sm badge-primary gap-1 font-mono uppercase font-bold shrink-0 animate-pulse">
        <Play className="w-2.5 h-2.5 fill-current" />
        {repeatCount > 1 ? `${position} (Rep ${currentRep}/${repeatCount})` : position}
      </span>
    );
  }
  if (isActive) {
    return (
      <span className="badge badge-sm badge-outline badge-primary font-mono text-[10px] uppercase font-bold shrink-0">
        Active Cue
      </span>
    );
  }
  return null;
}

interface LoopChordStripProps {
  chords: ChordItem[] | undefined;
  isPlaying: boolean;
  activeChordIndex: number | null;
}

/**
 * The progression readout, with the playing chord highlighted. Extracted for
 * the same reason as LoopStatusBadge: every branch here is about one chord
 * badge, so counting them against the whole card measured nothing.
 */
function LoopChordStrip({ chords, isPlaying, activeChordIndex }: LoopChordStripProps) {
  if (!chords || chords.length === 0) {
    return <span className="text-base-content/40 italic">No chords</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {chords.map((chord, cIdx) => {
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
                isChordActive ? 'text-primary-content font-bold' : 'font-bold text-base-content'
              }
            >
              {`${chord.root}${formatChordQuality(chord.quality)}`}
            </span>
            <span
              className={`text-[9px] ${
                isChordActive ? 'text-primary-content/80' : 'text-base-content/50'
              }`}
            >
              {`${chord.bars ?? 1}b`}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export const SortableLoopCard = React.memo(
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
  }: SortableLoopCardProps) {
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
        className={`card card-border bg-base-200 border transition-all shadow-xs cursor-pointer ${loopCardAccent(
          { isAuditioning, isPlaying, isActive },
        )}`}
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
              <LoopAuditionButton
                loopId={loop.id}
                loopName={loop.name}
                isAuditioning={isAuditioning}
                disabled={playDisabled}
                onToggle={onTogglePlayLoop}
              />

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

              <LoopStatusBadge
                isAuditioning={isAuditioning}
                isPlaying={isPlaying}
                isActive={isActive}
                currentStepInLoop={currentStepInLoop}
                singleCycleSteps={singleCycleSteps}
                totalStepsInLoop={totalStepsInLoop}
                currentRep={currentRep}
                repeatCount={repeatCount}
              />
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
                <span className="font-bold text-primary">{getTonicSpelling(loop.scaleRoot, loop.scaleType)}</span>
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
              <LoopChordStrip
                chords={loop.chords}
                isPlaying={isPlaying}
                activeChordIndex={activeChordIndex}
              />
            </div>
          </div>

          {/* 5-Channel Mixer Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 pt-0.5">
            {/* The card's mixer strip: one row per layer, in table order.
                MIX_LAYERS is shared with loop/SoundMixer.tsx so the five
                labels, tones, colours and store fields are written once. The
                two surfaces' WRITERS stay separate and must — this one writes
                a per-loop LoopMixPatch override through setLoopMix, on
                whichever loop the card is for, while the mixer writes the live
                store root through the ordinary slice actions. */}
            {MIX_LAYERS.map((ch) => (
              <MixChannel
                key={ch.idPrefix}
                idPrefix={`${ch.idPrefix}-${loop.id}`}
                label={ch.label}
                volumeDb={loop[ch.volumeKey]}
                muted={loop[ch.muteKey]}
                tone={ch.tone}
                sliderAccent={ch.accentClass}
                onVolumeDbChange={(v) => onSetMix(loop.id, { [ch.volumeKey]: v })}
                onToggleMute={() =>
                  onSetMix(loop.id, { [ch.muteKey]: !loop[ch.muteKey] })
                }
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
);
