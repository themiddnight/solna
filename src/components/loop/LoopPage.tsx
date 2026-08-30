import React from 'react';
import { useAppStore } from '../../store/store';
import { SynthView } from './SynthView';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';
import type { InputDeckDrumProps } from '../useInputDeck';

interface LoopPageProps {
  drumProps: InputDeckDrumProps;
}

export const LoopPage: React.FC<LoopPageProps> = ({ drumProps }) => {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'synth' ? 'block' : 'hidden'}><SynthView /></div>
      <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}><SequencerView drumProps={drumProps} /></div>
      <div className={activeTab === 'chords' ? 'block' : 'hidden'}><ChordView /></div>
    </>
  );
};
