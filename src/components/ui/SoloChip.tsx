import React from 'react';
import { X } from 'lucide-react';
import { soloChipLabel } from '@/store/trackAudibility';
import { IconButton } from './IconButton';
import { useLiveStore } from './useLiveStore';

/**
 * The `SOLO · … ×` chip: the one global "something is being silenced, and here
 * is how to stop" affordance.
 *
 * It lives in `HeaderCard`, so it renders on whichever view header is on
 * screen — Sound and all three Pattern segments. That placement is load-bearing
 * rather than cosmetic: a solo set SURVIVES the Sound ↔ Pattern hop (see
 * store/soloNav.ts), so the chip has to survive it too, or the set outlives the
 * only control that names it. Every other header belongs to the song layer,
 * where leaving the loop layer has already cleared the set — so `soloLabel` is
 * null there and this renders nothing, no view gating required.
 *
 * It used to sit in TransportBar, wedged between the play-target label and the
 * BPM stepper at `badge-sm`; the header has the room to show the track names
 * without truncating them at every width.
 *
 * Reads through `useLiveStore`, not `useAppStore`: under `renderToString`
 * zustand serves creation-time state, so a plain selector could never latch a
 * solo set by a test (see ui/useLiveStore.ts and .claude/rules/testing.md).
 */
export function SoloChip() {
  const soloTracks = useLiveStore((s) => s.soloTracks);
  const clearSoloTracks = useLiveStore((s) => s.clearSoloTracks);
  const soloLabel = soloChipLabel(soloTracks);
  if (!soloLabel) return null;

  return (
    <span
      /* `data-solo-chip`, not an `id`: every view header stays MOUNTED (App
         and PatternView gate with block/hidden), so six headers render this
         at once and an id would be six copies of one id in the live page —
         the same trap SoundView's `btn-solo-target` exists to avoid. */
      data-solo-chip
      className="badge badge-lg badge-warning text-xs font-bold gap-1 pe-1 max-w-52 sm:max-w-none"
      /* The clearing rule spelled out, because a control that silences
         tracks and then stops doing so on its own owes the user that
         sentence. It is stated HERE and not on SoloButton: IconButton
         emits one string as both `title` and `aria-label` (it omits
         `title` from its props on purpose), so the rule on the button
         would be read out by a screen reader at all six placements on
         every focus. The chip is the one affordance that appears only
         while a set is live, which is the only moment the rule matters.
         Kept in lockstep with SOLO_NAV_SOURCES (store/soloNav.ts) plus
         projectSlice's own clear; ViewHeader.test.tsx pins the text. */
      title="Track solo is a monitoring gesture: it survives the Sound / Pattern hop, and clears itself when you leave the Loop layer, change loop, or open another project."
    >
      <span className="truncate">{soloLabel}</span>
      <IconButton
        label="Clear solo"
        icon={<X className="w-3 h-3" />}
        size="xs"
        /* `warning`, matching the chip it sits on: that one class gives the
           × the surface's own content colour and derives the hover fill from
           the surface's colour, so the button needs no colour overrides of
           its own. `ghost` here would be a near-white × on yellow, and a
           near-black hover disc under a near-black × (see IconButton.tsx). */
        variant="warning"
        className="btn-circle"
        onClick={clearSoloTracks}
      />
    </span>
  );
}
