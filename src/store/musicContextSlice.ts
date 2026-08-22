import type { StoreApi } from 'zustand';
import type { AppStore, MusicContextSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

const TEMPLATES: Record<
  string,
  { bpm: number; scaleRoot: string; scaleType: string; projectTitle: string }
> = {
  'Synthwave Odyssey': { bpm: 120, scaleRoot: 'A', scaleType: 'Natural Minor', projectTitle: 'Synthwave Odyssey' },
  'Lo-Fi Chill Hop': { bpm: 85, scaleRoot: 'C', scaleType: 'Major', projectTitle: 'Lo-Fi Chill Hop' },
  'Cyber Electro Club': { bpm: 128, scaleRoot: 'D', scaleType: 'Dorian', projectTitle: 'Cyber Electro Club' },
  'Funky Neo-Soul': { bpm: 95, scaleRoot: 'F', scaleType: 'Major', projectTitle: 'Funky Neo-Soul' },
};

/**
 * Music context slice. `applyTemplate` replaces `handleLoadTemplate` from
 * App.tsx: one atomic `set()` per template that also crosses into the
 * transport slice (bpm).
 */
export function createMusicContextSlice(set: Set, _get: Get): MusicContextSlice {
  return {
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    projectTitle: 'Cosmic Horizon Jam',

    setScaleRoot: (scaleRoot) => set({ scaleRoot }),
    setScaleType: (scaleType) => set({ scaleType }),
    setProjectTitle: (projectTitle) => set({ projectTitle }),

    applyTemplate: (templateName) => {
      const template = TEMPLATES[templateName];
      if (!template) return;
      set(template);
    },
  };
}
