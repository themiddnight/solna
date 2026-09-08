import type { Layer } from '@/types';

/**
 * What the master Play will start, as a word next to the button. A loop whose
 * name has been cleared still gets a label — an empty string beside a play
 * button reads as a rendering bug, not as an unnamed loop.
 */
export function playTargetLabel(layer: Layer, activeLoopName: string): string {
  if (layer === 'song') return 'Song';
  return activeLoopName.trim() === '' ? 'Loop' : activeLoopName;
}
