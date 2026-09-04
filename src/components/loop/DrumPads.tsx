import React from 'react';
import { DrumPadGrid } from '../ui/DrumPadGrid';
import { PanelCard } from '../ui/PanelCard';
import type { InputDeckDrumProps } from '../useInputDeck';

interface DrumPadsProps {
  drumProps: InputDeckDrumProps;
}

/** Pure presentational wrapper: renders the shared DrumPadGrid inside the
 *  in-page card shell. All pad state (pads, activePadId, volume, trigger) is
 *  owned upstream by `useInputDeck` and forwarded via `drumProps`, so the
 *  card's volume sliders drive the same state as the dock's Drums tab and the
 *  QWERTY drum listener. */
export const DrumPads: React.FC<DrumPadsProps> = ({ drumProps }) => {
  return (
    <PanelCard>
      <div className="card-body p-3 sm:p-4">
        <DrumPadGrid {...drumProps} />
      </div>
    </PanelCard>
  );
};
