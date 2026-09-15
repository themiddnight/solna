import { BEAT_VOICE_ROWS } from './beatVoices';
import { BeatVoiceCard } from './BeatVoiceCard';
import type { SoundDepth } from '../useSoundDepth';
import type { BeatVoiceId, BeatVoices } from '@/types';

export interface BeatVoiceGridProps {
  /** The DRAFT voices — a gesture in flight shows here before it commits. */
  voices: BeatVoices;
  depth: SoundDepth;
  onPreview: (voice: BeatVoiceId) => void;
  onDraft: (voice: BeatVoiceId, key: string, value: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onResetVoice: (voice: BeatVoiceId) => void;
  resetDisabled: boolean;
}

/**
 * The eleven voice cards, in canonical order. It holds NO state: the accordion
 * this replaced kept one open voice, and a card is never collapsed.
 *
 * One column, two at `md`, three at `xl`. Not four at `xl`: the densest
 * voice's lane gets uncomfortable in a narrower column, where the knob row
 * wraps into a column tall enough to undo the density the grid bought.
 *
 * `items-start` so a card keeps its natural height instead of stretching to
 * the tallest sibling in its row — the whole point of the wrapping knob lane
 * is that a sparse voice is short, and a stretching grid item would hand that
 * saved height back as whitespace.
 *
 * On a phone the cards stack one per row with no accordion, so this surface
 * scrolls further than the list did. Accepted: the default depth shows only
 * each voice's Primary set, the tab already scrolls at that width, and a
 * mobile-only accordion would be a second interaction model reachable only by
 * viewport — which would also render the wrong one for a frame on every mount.
 */
export function BeatVoiceGrid({
  voices,
  depth,
  onPreview,
  onDraft,
  onCommit,
  onCancel,
  onResetVoice,
  resetDisabled,
}: BeatVoiceGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 items-start">
      {BEAT_VOICE_ROWS.map((row, index) => (
        <BeatVoiceCard
          key={row.id}
          voice={row.id}
          meta={row}
          ordinal={index + 1}
          voices={voices}
          depth={depth}
          onPreview={() => onPreview(row.id)}
          onDraft={(key, value) => onDraft(row.id, key, value)}
          onCommit={onCommit}
          onCancel={onCancel}
          onReset={() => onResetVoice(row.id)}
          resetDisabled={resetDisabled}
        />
      ))}
    </div>
  );
}
