import { describe, expect, test } from 'bun:test';
import {
  SYNTH_PARAM_FIELD,
  SYNTH_ARP_FIELD,
  SYNTH_SETTER_FIELD,
  SYNTH_ARP_SETTER_FIELD,
} from '@/store/sourceBuses';
import type { AppStore } from '@/store/types';

// Minimal fake slice covering only what these four tables read — not a full
// AppStore, since the test only needs to prove field-lookup narrowness, not
// exercise the store.
//
// Every unmodified field's DEFAULT value is a single shared object built once
// at module scope, not a fresh `{}` literal per `fakeState()` call: the whole
// point of the test below is that an unrelated field stays referentially
// EQUAL across two "renders", and two independently-constructed `{}` literals
// are never `===` even though they look identical.
const noop = () => {};
const DEFAULTS = {
  synthParams: {} as AppStore['synthParams'],
  chordSynthParams: {} as AppStore['chordSynthParams'],
  bassSynthParams: {} as AppStore['bassSynthParams'],
  padSynthParams: {} as AppStore['padSynthParams'],
  fxSynthParams: {} as AppStore['fxSynthParams'],
  synthArpSettings: {} as AppStore['synthArpSettings'],
  chordArpSettings: {} as AppStore['chordArpSettings'],
  bassArpSettings: {} as AppStore['bassArpSettings'],
  padArpSettings: {} as AppStore['padArpSettings'],
  fxArpSettings: {} as AppStore['fxArpSettings'],
  setSynthParams: noop, setChordSynthParams: noop, setBassSynthParams: noop,
  setPadSynthParams: noop, setFxSynthParams: noop,
  setSynthArpSettings: noop, setChordArpSettings: noop, setBassArpSettings: noop,
  setPadArpSettings: noop, setFxArpSettings: noop,
};

function fakeState(overrides: Partial<AppStore> = {}): Pick<
  AppStore,
  | 'synthParams' | 'chordSynthParams' | 'bassSynthParams' | 'padSynthParams' | 'fxSynthParams'
  | 'synthArpSettings' | 'chordArpSettings' | 'bassArpSettings' | 'padArpSettings' | 'fxArpSettings'
  | 'setSynthParams' | 'setChordSynthParams' | 'setBassSynthParams' | 'setPadSynthParams'
  | 'setFxSynthParams'
  | 'setSynthArpSettings' | 'setChordArpSettings' | 'setBassArpSettings' | 'setPadArpSettings'
  | 'setFxArpSettings'
> {
  return { ...DEFAULTS, ...overrides };
}

describe('SYNTH_ARP_SETTER_FIELD', () => {
  test('names every target exhaustively', () => {
    expect(Object.keys(SYNTH_ARP_SETTER_FIELD).sort()).toEqual(
      ['bass', 'chord', 'fx', 'pad', 'synth'],
    );
  });
});

describe('per-target field selectors used by useSynthChannel stay narrow', () => {
  test('a change to an unrelated target leaves the focused target\'s fields referentially equal', () => {
    const before = fakeState();
    // Simulate a store write that only touched the `chord` bus — a preset
    // applied to Chord, or an Instant Vibes reroll — while focus is `synth`.
    const after = fakeState({ chordSynthParams: {} as AppStore['chordSynthParams'] });

    for (const table of [SYNTH_PARAM_FIELD, SYNTH_ARP_FIELD, SYNTH_SETTER_FIELD, SYNTH_ARP_SETTER_FIELD]) {
      const field = table.synth;
      expect(before[field]).toBe(after[field]);
    }
  });

  test('the focused target itself DOES see its own field change', () => {
    const before = fakeState();
    const after = fakeState({ chordSynthParams: {} as AppStore['chordSynthParams'] });

    expect(before[SYNTH_PARAM_FIELD.chord]).not.toBe(after[SYNTH_PARAM_FIELD.chord]);
  });
});
