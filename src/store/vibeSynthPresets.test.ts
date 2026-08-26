import { describe, expect, test } from 'bun:test';
import { resolveVibeSynthParams } from './instantVibes';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { presetById } from '../audio/synthPresets';

describe('resolveVibeSynthParams', () => {
  test('takes its sound from the resolved preset, not from a literal override', () => {
    const params = resolveVibeSynthParams('factory-mellow-epiano');
    const preset = presetById('factory-mellow-epiano')!;
    for (const [key, value] of Object.entries(preset.params)) {
      expect(`${key}=${JSON.stringify(params[key as keyof typeof params])}`)
        .toBe(`${key}=${JSON.stringify(value)}`);
    }
  });

  test('stamps the resolved preset name into the display field', () => {
    expect(resolveVibeSynthParams('factory-mellow-epiano').preset).toBe('Mellow E-Piano');
    expect(resolveVibeSynthParams('bass-deep-sine').preset).toBe('Deep Sine Sub');
  });

  test('falls back to INITIAL_SYNTH_PARAMS for fields the preset omits', () => {
    // FACTORY_PRESETS entries set 20 timbre fields and omit the four arp
    // fields; the base supplies those. (Some presets also set `preset`, but
    // resolveVibeSynthParams always overwrites it with the resolved name.)
    const params = resolveVibeSynthParams('factory-hyper-saw-lead');
    expect(params.arpOctaves).toBe(INITIAL_SYNTH_PARAMS.arpOctaves);
    expect(params.arpMode).toBe(INITIAL_SYNTH_PARAMS.arpMode);
    expect(params.arpRate).toBe(INITIAL_SYNTH_PARAMS.arpRate);
  });

  test('never turns the arpeggiator on — that is the user’s call, not the vibe’s', () => {
    for (const id of ['factory-dream-keys', 'factory-glocken-bell', 'factory-pluck', 'bass-warm-tri']) {
      expect(`${id}:${resolveVibeSynthParams(id).arpActive}`).toBe(`${id}:false`);
    }
  });

  test('throws on an id no preset carries, so an authoring typo is never silent', () => {
    expect(() => resolveVibeSynthParams('factory-does-not-exist')).toThrow(
      'InstantVibe references unknown synth preset id: factory-does-not-exist',
    );
  });
});
