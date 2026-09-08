import React from 'react';
import { useAppStore } from '@/store/store';
import { ArrangeView } from './ArrangeView';
import { EffectsRackView } from './EffectsRackView';

export const SongPage = React.memo(function SongPage() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'arrange' ? 'block' : 'hidden'}><ArrangeView /></div>
      <div className={activeTab === 'master' ? 'block' : 'hidden'}><EffectsRackView /></div>
    </>
  );
});
