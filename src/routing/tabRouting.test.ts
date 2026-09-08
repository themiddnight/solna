import { expect, test } from 'bun:test';
import { isSongLayer, layerForTab } from '../types';
import {
  parseLayerPath, parseLoopId, resolveRoute, buildRouteUrl, defaultTabForLayer,
} from './tabRouting';

test('isSongLayer is true only for arrange and master', () => {
  expect(isSongLayer('arrange')).toBe(true);
  expect(isSongLayer('master')).toBe(true);
  expect(isSongLayer('sound')).toBe(false);
  expect(isSongLayer('pattern')).toBe(false);
});

test('layerForTab maps the four tabs to loop or song', () => {
  expect(layerForTab('sound')).toBe('loop');
  expect(layerForTab('pattern')).toBe('loop');
  expect(layerForTab('arrange')).toBe('song');
  expect(layerForTab('master')).toBe('song');
});

test('parseLayerPath maps unknown and loop paths to loop, song to song', () => {
  expect(parseLayerPath('/loop')).toBe('loop');
  expect(parseLayerPath('/song')).toBe('song');
  expect(parseLayerPath('/')).toBe('loop');
  expect(parseLayerPath('/anything')).toBe('loop');
});

test('resolveRoute normalizes a missing or layer-mismatched tab to the layer default', () => {
  expect(resolveRoute('/loop', '?tab=pattern').tab).toBe('pattern');
  expect(resolveRoute('/loop', '').tab).toBe('sound');             // missing tab → default
  expect(resolveRoute('/loop', '?tab=arrange').tab).toBe('sound'); // arrange on loop layer → default
  expect(resolveRoute('/song', '?tab=master').tab).toBe('master');
  expect(resolveRoute('/song', '?tab=pattern').tab).toBe('arrange'); // pattern on song layer → default
});

test('resolveRoute reports needsNormalize for wrong path, wrong tab, or loopId on song layer', () => {
  expect(resolveRoute('/', '?tab=sound').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=arrange').needsNormalize).toBe(true);
  expect(resolveRoute('/song', '?tab=arrange&loopId=x').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=sound').needsNormalize).toBe(false);
});

/**
 * THE MIGRATION STORY, in one test. `activeTab` is not persisted (see
 * partializeAppState in store/store.ts and its exclusion assertion in
 * store.test.ts), so the only place an old view id can survive this rename is
 * a bookmark or a pasted link. resolveRoute already validates ?tab against the
 * layer's own tab list and falls back to the layer default, flagging
 * needsNormalize so useRouteSync rewrites the URL. No sanitize path, no
 * persist version move, and deliberately no new "legacy id" table: a mapping
 * from ids nothing produces any more would be dead code with no test forcing
 * it to stay honest.
 */
test('a bookmark from before the rename lands on the layer default, tidied', () => {
  for (const stale of ['synth', 'sequencer', 'chords']) {
    const route = resolveRoute('/loop', `?tab=${stale}`);
    expect(route.tab).toBe('sound');
    expect(route.needsNormalize).toBe(true);
  }
  const staleSong = resolveRoute('/song', '?tab=effects');
  expect(staleSong.tab).toBe('arrange');
  expect(staleSong.needsNormalize).toBe(true);
});

/**
 * The Arrange → loop-editor deep link (ArrangeView.buildEditRoute) hard-codes
 * its tab. Pinned here so the literal and the router's own default cannot
 * drift into disagreeing — a deep link that needed normalising would burn a
 * history entry on every click.
 */
test('the loop-editor deep link targets the loop layer default', () => {
  expect(buildRouteUrl('loop', defaultTabForLayer('loop'), 'abc')).toBe(
    '/loop?tab=sound&loopId=abc',
  );
});

test('parseLoopId extracts the loopId param', () => {
  expect(parseLoopId('?tab=sound&loopId=abc')).toBe('abc');
  expect(parseLoopId('?tab=sound')).toBe(null);
});

test('buildRouteUrl builds a two-path URL and only adds loopId on the loop layer', () => {
  expect(buildRouteUrl('loop', 'sound', 'abc')).toBe('/loop?tab=sound&loopId=abc');
  expect(buildRouteUrl('song', 'arrange')).toBe('/song?tab=arrange');
});
