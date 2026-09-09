import React from 'react';
import { useAppStore } from '@/store/store';
import { SegmentHeader } from '../ui/SegmentHeader';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';
import { LeadMelodyGrid } from './lead/LeadMelodyGrid';

/**
 * The Pattern tab: everything that changes the NOTES or the rhythm.
 *
 * All three segments stay mounted and are gated with block/hidden, the same
 * way App.tsx gates the four tabs. Unmounting would be worse here than there:
 * ChordView holds the chord/bass preview refs and pointer-driven local state,
 * SequencerView holds its selected-grid id and a memoised 30-entry option
 * list, and LeadMelodyGrid holds a step-publisher subscription — a segment
 * click would silently reset all of it. The cost is covered: every meter ticks
 * through utils/meterScheduler.ts, which gates each registration on an
 * IntersectionObserver, so a hidden segment's meters stop reading.
 *
 * The segment row is not rendered here: it lives inside SegmentHeader, which
 * every segment already opens with — see the note there for why the header is
 * named for the tab rather than the segment.
 */
export const PatternView = React.memo(function PatternView() {
  const patternSegment = useAppStore((s) => s.patternSegment);
  return (
    <>
      <div className={patternSegment === 'lead' ? 'block' : 'hidden'}>
        {/* The lead segment has no card wrapper of its own — LeadMelodyGrid is
            one card — so it borrows the padding/width shell ChordView and
            SequencerView each apply to their own root. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="lead" />
          <LeadMelodyGrid />
        </div>
      </div>
      <div className={patternSegment === 'accompaniment' ? 'block' : 'hidden'}>
        <ChordView />
      </div>
      <div className={patternSegment === 'beat' ? 'block' : 'hidden'}>
        <SequencerView />
      </div>
    </>
  );
});
