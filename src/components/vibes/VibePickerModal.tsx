import { Dices, Play, Square } from 'lucide-react';
import { VIBES, type VibeSpec } from '@/data/vibes';
import { Modal } from '@/components/ui/Modal';
import { cx } from '@/components/ui/cx';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { useVibePicker, vibeSummaryLine, type VibePreviewed } from './useVibePicker';

interface VibeRowProps {
  vibe: VibeSpec;
  selected: boolean;
  /** The vibe the active loop was loaded from: labelled, never pressed. */
  current: boolean;
  disabled: boolean;
  rolling: boolean;
  onPick: (vibe: VibeSpec) => void;
  onReroll: (vibe: VibeSpec) => void;
}

/**
 * One vibe per row: the card, then its own dice. The dice previews a variant
 * of its row's vibe straight away, previewed or not. The card being previewed
 * is pressed; the card the loop was loaded from carries a "Current" label, so
 * the two states stay apart even on one card. A vibe without a dice rule keeps
 * the empty slot, so every card is the same width.
 */
function VibeRow({ vibe, selected, current, disabled, rolling, onPick, onReroll }: VibeRowProps) {
  return (
    <li className="flex items-stretch gap-2">
      <button id={`btn-vibes-card-${vibe.id}`} type="button" aria-pressed={selected} disabled={disabled}
        onClick={() => onPick(vibe)}
        className={cx('btn flex-1 h-auto min-h-11 flex-nowrap justify-start gap-3 py-2 text-left normal-case',
          selected ? 'btn-primary' : 'btn-soft')}>
        <span className="text-lg leading-none" aria-hidden="true">{vibe.emoji}</span>
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="text-sm font-semibold">{vibe.name}</span>
          <span className="text-xs tabular-nums opacity-70">
            {vibe.bpm} BPM · {formatKeyLabel(vibe.scaleRoot, vibe.scaleType)}
          </span>
        </span>
        {current && (
          <span id="vibes-current-mark" className="ml-auto rounded border border-current px-1 text-xs font-semibold leading-4">Current</span>
        )}
      </button>
      {vibe.random ? (
        <button id={`btn-vibes-reroll-${vibe.id}`} type="button" disabled={disabled}
          aria-label={`Reroll ${vibe.name}`} title={`Reroll ${vibe.name}`}
          onClick={() => onReroll(vibe)} className="btn btn-soft btn-square h-auto min-h-11 w-11">
          <Dices className={cx('w-4 h-4', rolling && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        </button>
      ) : (
        <span className="w-11 shrink-0" aria-hidden="true" />
      )}
    </li>
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
 * Modal's own header, the vibe list (the only thing that scrolls), the footer.
 * Every way out but Use routes through `cancel`, which restores the loop.
 */
export function VibePickerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = useVibePicker(open, onClose);
  return (
    <Modal open={open} onClose={p.cancel} title="Vibes" boxClassName="flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <ul className="flex flex-col gap-2">
          {VIBES.map((vibe) => {
            const selected = p.previewed?.base.id === vibe.id;
            return (
              <VibeRow key={vibe.id} vibe={vibe} selected={selected} current={p.currentVibeId === vibe.id}
                disabled={!p.ready} rolling={selected && p.rolling} onPick={p.pick} onReroll={p.reroll} />
            );
          })}
        </ul>
      </div>
      <VibeFooter previewed={p.previewed} playing={p.playing}
        onTogglePlay={p.togglePlay} onCancel={p.cancel} onUse={p.use} />
    </Modal>
  );
}
