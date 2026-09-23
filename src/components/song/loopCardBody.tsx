import { useMemo } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { ChordItem } from '@/types';
import type { Loop, LoopMixPatch } from '@/store/types';
import { formatDb } from '@/utils/gainUnits';
import { formatChordLabel, generateBlockChordNotes } from '@/utils/musicTheory';
import { getTonicSpelling, spellNoteInKey, type SpellingKey } from '@/utils/noteSpelling';
import { PowerToggle, type PowerToggleTone } from '../ui/PowerToggle';
import { MIX_LAYERS, type MixLayer } from '../mixLayers';
import { cx } from '../ui/cx';
import { dbToFaderPosition, VolumeFader } from '../ui/VolumeFader';

/** A loop card's body — the meta strip and the mixer — shared by the card
 *  (from `md` up) and its mobile detail sheet. */
interface MixChannelProps {
  idPrefix: string;
  label: string;
  /** DECIBELS: unity is 0, the range is -60..+12 — same as the Sound
   *  mixer's `volumeDb`, renamed to match for the same reason. */
  volumeDb: number;
  muted: boolean;
  tone: PowerToggleTone;
  sliderAccent: string;
  onVolumeDbChange: (db: number) => void;
  onToggleMute: () => void;
}

/** One compact mixer strip (mute + gain) inside a loop card. */
function MixChannel({
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
        muted ? 'opacity-50 grayscale' : 'opacity-100'
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
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-[10px] tabular-nums shrink-0 ${
              muted ? 'text-base-content/40' : 'text-base-content/70'
            }`}
          >
            {formatDb(volumeDb)}
          </span>
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
          showReadout={false}
          className={`range range-xs ${sliderAccent} w-full`}
        />
      </div>
    </div>
  );
}


interface LoopChordStripProps {
  chords: ChordItem[] | undefined;
  chordOctave: number;
  isPlaying: boolean;
  activeChordIndex: number | null;
  spellingKey: SpellingKey;
}

/**
 * The progression readout, with the playing chord highlighted. Extracted for
 * the same reason as LoopStatusBadge: every branch here is about one chord
 * badge, so counting them against the whole card measured nothing.
 */
function LoopChordStrip({ chords, chordOctave, isPlaying, activeChordIndex, spellingKey }: LoopChordStripProps) {
  // A chord's notes are derived, not stored (DEV-396). This card re-renders
  // every step while the loop plays (`activeChordIndex` tracks the playhead),
  // so the whole strip's Tonal resolution is memoized on the loop's own
  // chords/octave/key rather than re-run on every one of those ticks. Keyed
  // on the two spelling primitives, not `spellingKey` itself — the caller
  // passes a fresh object literal every render, which would defeat the memo.
  const chordNotes = useMemo(
    () =>
      (chords ?? []).map((chord) =>
        generateBlockChordNotes(chord.quality, chord.root, chordOctave).map((n) =>
          spellNoteInKey(n, spellingKey.scaleRoot, spellingKey.scaleType),
        ),
      ),
    [chords, chordOctave, spellingKey.scaleRoot, spellingKey.scaleType],
  );

  if (!chords || chords.length === 0) {
    return <span className="text-base-content/40 italic">No chords</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {chords.map((chord, cIdx) => {
        const isChordActive = isPlaying && cIdx === activeChordIndex;
        const notes = chordNotes[cIdx];
        return (
          <span
            key={chord.id || `${chord.root}-${cIdx}`}
            className={`badge badge-sm gap-1 transition-all duration-150 ${
              isChordActive
                ? 'badge-primary font-bold ring-2 ring-primary/60 shadow-sm scale-105'
                : 'bg-base-200 border border-base-300'
            }`}
            title={notes.length ? `Notes: ${notes.join(', ')}` : undefined}
          >
            <span
              className={
                isChordActive ? 'text-primary-content font-bold' : 'font-bold text-base-content'
              }
            >
              {formatChordLabel(chord.root, chord.quality, spellingKey)}
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


/** Key / scale, repeat count and the chord progression, on one strip. */
export function LoopCardMetaRow({
  loop,
  label,
  isPlaying,
  activeChordIndex,
  onSetRepeat,
  idScope = '',
}: {
  loop: Loop;
  label: string;
  isPlaying: boolean;
  activeChordIndex: number;
  onSetRepeat: (id: string, repeatCount: number) => void;
  /** Prefixes every element id: the detail sheet renders a second copy. */
  idScope?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-box bg-base-100/60 border border-base-300/40 text-xs">
      {/* Key / Scale Display */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
          Key:
        </span>
        <span className="badge badge-sm badge-outline gap-1">
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
          id={`${idScope}select-repeat-${loop.id}`}
          value={loop.repeatCount ?? 1}
          onChange={(e) => onSetRepeat(loop.id, Number(e.target.value))}
          className="select select-xs select-bordered tabular-nums font-bold bg-base-100/80"
          aria-label={`Repeat count for ${label}`}
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
          chordOctave={loop.chordOctave}
          isPlaying={isPlaying}
          activeChordIndex={activeChordIndex}
          spellingKey={{ scaleRoot: loop.scaleRoot, scaleType: loop.scaleType }}
        />
      </div>
    </div>
  );
}

/** The card's five-channel mixer strip, one row per MIX_LAYERS entry. */
export function LoopCardMixer({
  loop,
  onSetMix,
  idScope = '',
}: {
  loop: Loop;
  onSetMix: (id: string, patch: Partial<LoopMixPatch>) => void;
  idScope?: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-0.5">
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
          idPrefix={`${idScope}${ch.idPrefix}-${loop.id}`}
          label={ch.label}
          volumeDb={ch.readLevelDb(loop)}
          muted={ch.readMuted(loop)}
          tone={ch.tone}
          sliderAccent={ch.accentClass}
          onVolumeDbChange={(v) => onSetMix(loop.id, ch.levelPatch(v, loop))}
          onToggleMute={() => onSetMix(loop.id, ch.mutePatch(!ch.readMuted(loop), loop))}
        />
      ))}
    </div>
  );
}

export interface MixSummaryEntry {
  id: MixLayer['idPrefix'];
  label: string;
  accentClass: MixLayer['accentClass'];
  muted: boolean;
  /** The level as a fader position (0..1), on the same taper the fader uses. */
  position: number;
  levelDb: number;
}

/** One entry per MIX_LAYERS row, in table order: what the mobile mix line draws. */
export function mixSummary(mix: LoopMixPatch): MixSummaryEntry[] {
  return MIX_LAYERS.map((ch) => {
    const levelDb = ch.readLevelDb(mix);
    return {
      id: ch.idPrefix,
      label: ch.label,
      accentClass: ch.accentClass,
      muted: ch.readMuted(mix),
      position: dbToFaderPosition(levelDb),
      levelDb,
    };
  });
}

/** The spoken form of the mix line, which draws its levels as bars. */
export function mixSummaryLabel(entries: readonly MixSummaryEntry[]): string {
  return entries
    .map((e) => `${e.label} ${e.muted ? 'muted' : formatDb(e.levelDb)}`)
    .join(', ');
}

/**
 * The mobile row's second line: each track's level as a short bar in its own
 * colour, faded and struck through when muted — so scanning down the Arrange
 * list shows which loops thin out or drop a track. Read-only; the mixer that
 * edits these is in the detail sheet.
 */
export function LoopMixSummary({ mix }: { mix: LoopMixPatch }) {
  const entries = mixSummary(mix);
  return (
    <div role="img" aria-label={`Mix: ${mixSummaryLabel(entries)}`} className="grid grid-cols-6 gap-1.5 px-1">
      {entries.map((e) => (
        <div key={e.id} className={cx('flex flex-col gap-0.5 min-w-0', e.accentClass, e.muted && 'opacity-40')}>
          <span className={cx('text-[9px] font-bold uppercase tracking-wider truncate', e.muted && 'line-through')}>
            {e.label}
          </span>
          <span className="h-1 rounded-full bg-base-300 overflow-hidden">
            {!e.muted && (
              <span className="block h-full rounded-full bg-current" style={{ width: `${Math.round(e.position * 100)}%` }} />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
