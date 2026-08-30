import type { Layer, ViewMode } from '../types';
import { LOOP_TABS, SONG_TABS } from '../types';

export const LAYER_PATHS: Record<Layer, string> = { loop: 'loop', song: 'song' };

export function parseLayerPath(pathname: string): Layer {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return first === 'song' ? 'song' : 'loop';
}

export function defaultTabForLayer(layer: Layer): ViewMode {
  return layer === 'song' ? 'arrange' : 'synth';
}

export function tabsForLayer(layer: Layer): readonly ViewMode[] {
  return layer === 'song' ? SONG_TABS : LOOP_TABS;
}

export function parseLoopId(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get('loopId');
}

export interface ResolvedRoute {
  layer: Layer;
  tab: ViewMode;
  loopId: string | null;
  needsNormalize: boolean;
}

export function resolveRoute(pathname: string, search: string): ResolvedRoute {
  const layer = parseLayerPath(pathname);
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const rawTab = params.get('tab');
  const tab = rawTab && tabsForLayer(layer).includes(rawTab as ViewMode)
    ? (rawTab as ViewMode)
    : defaultTabForLayer(layer);
  const loopId = params.get('loopId');
  const needsNormalize =
    pathname !== `/${LAYER_PATHS[layer]}` ||
    tab !== rawTab ||
    (loopId !== null && layer !== 'loop');
  return { layer, tab, loopId, needsNormalize };
}

export function buildRouteUrl(layer: Layer, tab: ViewMode, loopId?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (layer === 'loop' && loopId) params.set('loopId', loopId);
  return `/${LAYER_PATHS[layer]}?${params.toString()}`;
}
