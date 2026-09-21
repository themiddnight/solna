import { afterEach, describe, expect, test } from 'bun:test';
import { partializeAppState, sanitizePersistedState, useAppStore } from './store';

describe('drumPadVelocities, the persisted drum-pad velocity overrides', () => {
  afterEach(() => {
    useAppStore.setState({ drumPadVelocities: {} });
  });

  test('drumPadVelocities keeps only Beat voice ids with finite 0..1 values', () => {
    const out = sanitizePersistedState({
      drumPadVelocities: { kick: 0.5, snare: 2, bogus: 0.3, hihat: 'x', clap: 0, ride: Number.NaN },
    });
    expect(out.drumPadVelocities).toEqual({ kick: 0.5, clap: 0 });
  });

  test('a non-object drumPadVelocities is dropped, leaving the default', () => {
    expect(sanitizePersistedState({ drumPadVelocities: [1] })).not.toHaveProperty('drumPadVelocities');
    expect(sanitizePersistedState({ drumPadVelocities: null })).not.toHaveProperty('drumPadVelocities');
    expect(sanitizePersistedState({})).not.toHaveProperty('drumPadVelocities');
  });

  test('the store starts with no overrides', () => {
    expect(useAppStore.getInitialState().drumPadVelocities).toEqual({});
  });

  test('setDrumPadVelocity clamps and persists', () => {
    useAppStore.getState().setDrumPadVelocity('kick', 1.4);
    expect(useAppStore.getState().drumPadVelocities.kick).toBe(1);
    useAppStore.getState().setDrumPadVelocity('snare', -0.2);
    expect(useAppStore.getState().drumPadVelocities.snare).toBe(0);
    expect(partializeAppState(useAppStore.getState())).toHaveProperty('drumPadVelocities');
    expect(partializeAppState(useAppStore.getState()).drumPadVelocities).toEqual({ kick: 1, snare: 0 });
  });

  test('a non-finite velocity is rejected and leaves the stored override untouched', () => {
    // Math.min/max pass NaN straight through, so a clamp alone would put NaN
    // into memory until the next reload's sanitize dropped it.
    const before = useAppStore.getState();
    before.setDrumPadVelocity('kick', 0.6);
    const withKick = useAppStore.getState().drumPadVelocities;
    useAppStore.getState().setDrumPadVelocity('kick', Number.NaN);
    useAppStore.getState().setDrumPadVelocity('kick', Number.POSITIVE_INFINITY);
    useAppStore.getState().setDrumPadVelocity('snare', Number.NaN);
    expect(useAppStore.getState().drumPadVelocities).toBe(withKick);
    expect(useAppStore.getState().drumPadVelocities).toEqual({ kick: 0.6 });
  });
});
