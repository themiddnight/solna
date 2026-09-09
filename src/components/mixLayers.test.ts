import { describe, expect, test } from 'bun:test';
import { MIX_GROUP_IDS, MIX_GROUP_LABELS, MIX_LAYERS } from './mixLayers';
import { SOURCE_BUSES, sourceBus } from '@/store/sourceBuses';

/**
 * `MIX_LAYERS` and `SOURCE_BUSES` describe the same five buses from two sides:
 * the mixer row knows which store fields its fader and mute toggle write, and
 * the engine table knows which fields belong to which bus. Only the bus NAME is
 * type-checked between them — `engineSource: SourceBusId` — so a row pairing
 * `engineSource: 'chord'` with `volumeKey: 'bassVolume'` compiles and ships a
 * fader and the meter beside it describing different buses, with nothing red.
 *
 * The tables stay separate on purpose: each is readable as a flat literal, and
 * deriving half of one from the other would make a mixer row something you
 * cannot check by eye. This is what stops them disagreeing instead.
 */
describe('MIX_LAYERS agrees with the engine bus table', () => {
  test('every layer names a bus, and every bus has a layer', () => {
    expect(MIX_LAYERS.map((layer) => layer.engineSource).sort()).toEqual(
      SOURCE_BUSES.map((bus) => bus.source).sort(),
    );
  });

  test('every layer writes the store fields the engine reads for its bus', () => {
    const pairs = MIX_LAYERS.map((layer) => {
      const bus = sourceBus(layer.engineSource);
      return [layer.idPrefix, layer.volumeKey, layer.muteKey, bus.volume, bus.muted];
    });
    for (const [id, volumeKey, muteKey, busVolume, busMuted] of pairs) {
      expect([id, volumeKey, muteKey]).toEqual([id, busVolume, busMuted]);
    }
  });
});

describe('the mixer groups cover every layer', () => {
  test('every layer sits in a declared group', () => {
    for (const layer of MIX_LAYERS) {
      expect(MIX_GROUP_IDS).toContain(layer.group);
    }
  });

  // A group with no layer renders a divider over nothing. SoundMixer filters
  // empty groups out, so this would be silent on screen rather than obviously
  // broken.
  test('every declared group has at least one layer, and a label', () => {
    for (const id of MIX_GROUP_IDS) {
      expect(MIX_LAYERS.some((layer) => layer.group === id)).toBe(true);
      expect(MIX_GROUP_LABELS[id]).toBeTruthy();
    }
  });
});
