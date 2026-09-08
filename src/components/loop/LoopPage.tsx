import React from 'react';
import { useAppStore } from '@/store/store';
import { SoundView } from './SoundView';
import { PatternView } from './PatternView';

export const LoopPage = React.memo(function LoopPage() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={activeTab === 'sound' ? 'block' : 'hidden'}><SoundView /></div>
      <div className={activeTab === 'pattern' ? 'block' : 'hidden'}><PatternView /></div>
    </>
  );
});
