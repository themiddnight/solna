import { expect, test } from 'bun:test';
import { isSongLayer, layerForTab } from '../types';
import {
  parseLayerPath, parseLoopId, resolveRoute, buildRouteUrl,
} from './tabRouting';

test('isSongLayer is true only for arrange and effects', () => {
  expect(isSongLayer('arrange')).toBe(true);
  expect(isSongLayer('effects')).toBe(true);
  expect(isSongLayer('synth')).toBe(false);
  expect(isSongLayer('sequencer')).toBe(false);
  expect(isSongLayer('chords')).toBe(false);
});

test('layerForTab maps the five tabs to loop or song', () => {
  expect(layerForTab('synth')).toBe('loop');
  expect(layerForTab('sequencer')).toBe('loop');
  expect(layerForTab('chords')).toBe('loop');
  expect(layerForTab('arrange')).toBe('song');
  expect(layerForTab('effects')).toBe('song');
});

test('parseLayerPath maps unknown and loop paths to loop, song to song', () => {
  expect(parseLayerPath('/loop')).toBe('loop');
  expect(parseLayerPath('/song')).toBe('song');
  expect(parseLayerPath('/')).toBe('loop');
  expect(parseLayerPath('/anything')).toBe('loop');
});

test('resolveRoute normalizes a missing or layer-mismatched tab to the layer default', () => {
  expect(resolveRoute('/loop', '?tab=sequencer').tab).toBe('sequencer');
  expect(resolveRoute('/loop', '').tab).toBe('synth');            // missing tab → default
  expect(resolveRoute('/loop', '?tab=arrange').tab).toBe('synth'); // arrange on loop layer → default
  expect(resolveRoute('/song', '?tab=effects').tab).toBe('effects');
  expect(resolveRoute('/song', '?tab=chords').tab).toBe('arrange'); // chords on song layer → default
});

test('resolveRoute reports needsNormalize for wrong path, wrong tab, or loopId on song layer', () => {
  expect(resolveRoute('/', '?tab=synth').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=arrange').needsNormalize).toBe(true);
  expect(resolveRoute('/song', '?tab=arrange&loopId=x').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=synth').needsNormalize).toBe(false);
});

test('parseLoopId extracts the loopId param', () => {
  expect(parseLoopId('?tab=synth&loopId=abc')).toBe('abc');
  expect(parseLoopId('?tab=synth')).toBe(null);
});

test('buildRouteUrl builds a two-path URL and only adds loopId on the loop layer', () => {
  expect(buildRouteUrl('loop', 'synth', 'abc')).toBe('/loop?tab=synth&loopId=abc');
  expect(buildRouteUrl('song', 'arrange')).toBe('/song?tab=arrange');
});
