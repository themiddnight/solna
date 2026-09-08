import React from 'react';
import { useAppStore } from '@/store/store';
import { PatternSegmentRow } from '../Header';
import { SegmentHeader } from '../ui/SegmentHeader';
import { SoloButton } from '../ui/SoloButton';
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
 * There is no tab-level ViewHeader here on purpose — see SegmentHeader.
 */
export const PatternView = React.memo(function PatternView() {
  const patternSegment = useAppStore((s) => s.patternSegment);
  return (
    <>
      <div className="px-3 sm:px-4 pt-3 sm:pt-4 max-w-7xl mx-auto">
        <PatternSegmentRow />
      </div>
      <div className={patternSegment === 'lead' ? 'block' : 'hidden'}>
        {/* The lead segment has no card wrapper of its own — LeadMelodyGrid is
            one card — so it borrows the padding/width shell ChordView and
            SequencerView each apply to their own root. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="lead" actions={<SoloButton track="lead" />} />
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
