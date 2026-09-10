import React from 'react';
import { segmentForFocus, type MixLayerId } from '@/store/focusTrack';
import type { PatternSegment } from '@/types';
import { useLiveStore } from '../ui/useLiveStore';
import { SegmentHeader } from '../ui/SegmentHeader';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';
import { LeadMelodyGrid } from './lead/LeadMelodyGrid';

/**
 * The Pattern tab: everything that changes the NOTES or the rhythm.
 *
 * All four segments stay mounted and are gated with block/hidden, the same
 * way App.tsx gates the four tabs. Unmounting would be worse here than there:
 * ChordView holds the chord/bass preview refs and pointer-driven local state,
 * SequencerView holds its selected-grid id and a memoised 30-entry option
 * list, and LeadMelodyGrid holds a step-publisher subscription — and the FX
 * grid holds a second, separate one — a segment click would silently reset
 * all of it. The cost is covered: every meter ticks
 * through utils/meterScheduler.ts, which gates each registration on an
 * IntersectionObserver, so a hidden segment's meters stop reading.
 *
 * The segment row is not rendered here: it lives inside SegmentHeader, which
 * every segment already opens with — see the note there for why the header is
 * named for the tab rather than the segment.
 *
 * Which one shows is DERIVED, not stored: `segmentForFocus(focusTrack)`. The
 * segment stopped being its own ui-slice field when focus merged the Pattern
 * segment and the Sound target into one value — so crossing from Sound to
 * Pattern lands on the segment that shows the track you were already editing,
 * with nothing to keep in step.
 */

/**
 * Which of the four segment wrappers shows, for a given focus. Exported and
 * pure so the "exactly one segment showing" property can be asserted over
 * every focus without rendering four grids (see PatternView.test.tsx).
 */
export function segmentVisibilityClass(
  focus: MixLayerId,
  segment: PatternSegment,
): 'block' | 'hidden' {
  return segmentForFocus(focus) === segment ? 'block' : 'hidden';
}

export const PatternView = React.memo(function PatternView() {
  // useLiveStore, not useAppStore: this gate must reflect a focus a test set
  // before renderToString, and zustand's own hook serves creation-time state
  // as the server snapshot (see .claude/rules/testing.md).
  const focusTrack = useLiveStore((s) => s.focusTrack);
  return (
    <>
      <div className={segmentVisibilityClass(focusTrack, 'lead')}>
        {/* The lead segment has no card wrapper of its own — LeadMelodyGrid is
            one card — so it borrows the padding/width shell ChordView and
            SequencerView each apply to their own root. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="lead" />
          <LeadMelodyGrid trackId="lead" />
        </div>
      </div>
      <div className={segmentVisibilityClass(focusTrack, 'fx')}>
        {/* Same shell as Lead above, deliberately: FX is the same surface with a
            different trackId, so a second layout here would be the two grids
            starting to diverge. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="fx" />
          <LeadMelodyGrid trackId="fx" />
        </div>
      </div>
      <div className={segmentVisibilityClass(focusTrack, 'accompaniment')}>
        <ChordView />
      </div>
      <div className={segmentVisibilityClass(focusTrack, 'beat')}>
        <SequencerView />
      </div>
    </>
  );
});
