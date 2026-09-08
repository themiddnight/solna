import React from 'react';
import { useAppStore } from '@/store/store';
import { SynthView } from './SynthView';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';
import { PatternSegmentRow } from '../Header';

export const LoopPage = React.memo(function LoopPage() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'sound' ? 'block' : 'hidden'}><SynthView /></div>
      {/* INTERIM (Task 1 of the nav restructure): Pattern stacks the two
          note-editing views so nothing goes unreachable while the real
          segmented PatternView is built in Task 5. */}
      <div className={activeTab === 'pattern' ? 'block' : 'hidden'}>
        <div className="px-3 sm:px-4 pt-3 sm:pt-4">
          <PatternSegmentRow />
        </div>
        {/* INTERIM (Task 1): still stacked. Task 5 gates these on
            patternSegment and adds the lead segment. */}
        <ChordView />
        <SequencerView />
      </div>
    </>
  );
});
