import React from 'react';
import { useAppStore } from '../../store/store';
import { SynthView } from './SynthView';
import { ChordView } from './ChordView';
import { SequencerView } from './SequencerView';

export const LoopPage: React.FC = () => {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'synth' ? 'block' : 'hidden'}><SynthView /></div>
      <div className={activeTab === 'sequencer' ? 'block' : 'hidden'}><SequencerView /></div>
      <div className={activeTab === 'chords' ? 'block' : 'hidden'}><ChordView /></div>
    </>
  );
};
