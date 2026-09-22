import React from 'react';
import { isSongLayer } from '@/types';
import { useAppStore } from '@/store/store';
import { LoopPage } from '@/components/loop/LoopPage';
import { SongPage } from '@/components/song/SongPage';

/**
 * Both layers, always mounted, gated block/hidden on the active layer — the
 * first of R014's three gating levels (LoopPage and PatternView are the other
 * two). Shared by both shells: the gate is the one piece every frame keeps.
 */
export const LayerPages = React.memo(function LayerPages() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={isSongLayer(activeTab) ? 'hidden' : 'block'}>
        <LoopPage />
      </div>
      <div className={isSongLayer(activeTab) ? 'block' : 'hidden'}>
        <SongPage />
      </div>
    </>
  );
});
