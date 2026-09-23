import { Dices, Play, Square } from 'lucide-react';
import { VIBES, type VibeSpec } from '@/data/vibes';
import { Modal } from '@/components/ui/Modal';
import { cx } from '@/components/ui/cx';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { useVibePicker, vibeSummaryLine, type VibePreviewed } from './useVibePicker';

interface VibeCardProps {
  vibe: VibeSpec;
  selected: boolean;
  /** The vibe the active loop was loaded from: labelled, never pressed. */
  current: boolean;
  disabled: boolean;
  rolling: boolean;
  onPick: (vibe: VibeSpec) => void;
  onReroll: () => void;
}

/**
 * One vibe. The card being previewed is pressed and alone carries the dice;
 * the card the loop was loaded from carries a "Current" label instead, so the
 * two states stay apart even on one card.
 */
function VibeCard({ vibe, selected, current, disabled, rolling, onPick, onReroll }: VibeCardProps) {
  return (
    <div className="relative">
      <button id={`btn-vibes-card-${vibe.id}`} type="button" aria-pressed={selected} disabled={disabled}
        onClick={() => onPick(vibe)}
        className={cx('btn w-full h-auto min-h-11 flex-col items-start gap-0.5 py-2 text-left normal-case',
          selected ? 'btn-primary' : 'btn-soft')}>
        <span className="flex items-center gap-2">
          <span className="text-lg leading-none" aria-hidden="true">{vibe.emoji}</span>
          {current && (
            <span id="vibes-current-mark" className="rounded border border-current px-1 text-xs font-semibold leading-4">Current</span>
          )}
        </span>
        <span className="text-sm font-semibold">{vibe.name}</span>
        <span className="text-xs tabular-nums opacity-70">
          {vibe.bpm} BPM · {formatKeyLabel(vibe.scaleRoot, vibe.scaleType)}
        </span>
      </button>
      {selected && vibe.random && (
        <button id="btn-vibes-reroll" type="button" aria-label={`Reroll ${vibe.name}`} title={`Reroll ${vibe.name}`}
          onClick={onReroll} className="btn btn-sm btn-square btn-ghost absolute top-0 right-0 min-h-11 min-w-11">
          <Dices className={cx('w-4 h-4', rolling && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface VibeFooterProps {
  previewed: VibePreviewed | null;
  playing: boolean;
  onTogglePlay: () => void;
  onCancel: () => void;
  onUse: () => void;
}

/** Pinned below the grid: what is previewing, Play/Stop on the left, Cancel/Use on the right. */
function VibeFooter({ previewed, playing, onTogglePlay, onCancel, onUse }: VibeFooterProps) {
  return (
    <div className="shrink-0 border-t border-base-300 pt-3 flex flex-col gap-2">
      <div aria-live="polite">
        <p id="vibes-summary" className="text-sm font-semibold">{vibeSummaryLine(previewed)}</p>
        {previewed?.reroll && (
          <>
            <p className="text-xs">{previewed.reroll.headline}</p>
            <p className="text-xs text-base-content/70">{previewed.reroll.detail}</p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button id="btn-vibes-play" type="button" className="btn btn-ghost min-h-11 gap-1"
          disabled={!previewed} onClick={onTogglePlay}>
          {playing ? <Square className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
          {playing ? 'Stop' : 'Play'}
        </button>
        <div className="ml-auto flex gap-2">
          <button id="btn-vibes-cancel" type="button" className="btn btn-ghost min-h-11" onClick={onCancel}>Cancel</button>
          <button id="btn-vibes-use" type="button" className="btn btn-primary min-h-11"
            disabled={!previewed} onClick={onUse}>Use</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The vibe picker (R334): a centred Modal on both frames. The box is a column —
 * Modal's own header, the card grid (the only thing that scrolls), the footer.
 * Every way out but Use routes through `cancel`, which restores the loop.
 */
export function VibePickerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = useVibePicker(open, onClose);
  return (
    <Modal open={open} onClose={p.cancel} title="Vibes" size="lg" boxClassName="flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {VIBES.map((vibe) => (
            <VibeCard key={vibe.id} vibe={vibe} selected={p.previewed?.base.id === vibe.id}
              current={p.currentVibeId === vibe.id}
              disabled={!p.ready} rolling={p.rolling} onPick={p.pick} onReroll={p.reroll} />
          ))}
        </div>
      </div>
      <VibeFooter previewed={p.previewed} playing={p.playing}
        onTogglePlay={p.togglePlay} onCancel={p.cancel} onUse={p.use} />
    </Modal>
  );
}
