import React from 'react';
import { useAppStore } from '../../store/store';
import { ArrangeView } from './ArrangeView';
import { EffectsRackView } from './EffectsRackView';

export const SongPage: React.FC = React.memo(() => {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'arrange' ? 'block' : 'hidden'}><ArrangeView /></div>
      <div className={activeTab === 'effects' ? 'block' : 'hidden'}><EffectsRackView /></div>
    </>
  );
});
