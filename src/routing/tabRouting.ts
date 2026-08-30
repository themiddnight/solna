import type { ViewMode } from '../types';

export const TAB_VALUES: ViewMode[] = ['synth', 'sequencer', 'chords', 'effects', 'arrange'];

/**
 * Parse the `tab` query parameter out of a search string.
 * Invalid, missing or empty values fall back to 'synth'.
 * Pure function — safe to unit test.
 */
export function parseTabParam(search: string): ViewMode {
  if (!search) return 'synth';
  const query = search.startsWith('?') ? search.slice(1) : search;
  const tab = new URLSearchParams(query).get('tab');
  return TAB_VALUES.includes(tab as ViewMode) ? (tab as ViewMode) : 'synth';
}

export function getTabFromUrl(): ViewMode {
  return parseTabParam(window.location.search);
}

/**
 * Build the query string for the given tab while preserving every other
 * existing parameter, e.g. '?foo=1' + 'chords' -> 'foo=1&tab=chords'.
 */
function buildQuery(search: string, tab: ViewMode): string {
  // URLSearchParams does not strip a leading '?' — it would become part of
  // the first key.
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('tab', tab);
  return params.toString();
}

export function pushTabToUrl(tab: ViewMode): void {
  window.history.pushState(window.history.state, '', `?${buildQuery(window.location.search, tab)}`);
}

export function replaceTabInUrl(tab: ViewMode): void {
  window.history.replaceState(window.history.state, '', `?${buildQuery(window.location.search, tab)}`);
}
