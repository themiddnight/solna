import { afterEach, describe, expect, test } from 'bun:test';
import { MIX_LAYER_IDS } from './focusTrack';
import { panelModeForFocus, startFocusPanelSync } from './focusPanelSync';
import { useAppStore } from './store';

afterEach(() => {
  useAppStore.setState({ focusTrack: 'synth', inputPanelMode: 'keyboard' });
});

describe('panelModeForFocus', () => {
  test('drum gets the Drums panel and every other focus the Keyboard', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, panelModeForFocus(id)]));
    expect(actual).toEqual({
      synth: 'keyboard',
      fx: 'keyboard',
      chord: 'keyboard',
      bass: 'keyboard',
      pad: 'keyboard',
      drum: 'drums',
    });
  });
});

describe('startFocusPanelSync', () => {
  test('a drum focus switches the dock to Drums, and a melodic focus back', () => {
    const stop = startFocusPanelSync();
    try {
      useAppStore.getState().setFocusTrack('drum');
      expect(useAppStore.getState().inputPanelMode).toBe('drums');
      useAppStore.getState().setFocusTrack('pad');
      expect(useAppStore.getState().inputPanelMode).toBe('keyboard');
    } finally {
      stop();
    }
  });

  /**
   * The tabs stay clickable: the auto-switch fires on a FOCUS change, never on
   * a panel change, so a user who switches back to the Keyboard while focused
   * on drums stays there until focus itself moves (spec, Open risks 2).
   */
  test('does not fight a manual panel change', () => {
    const stop = startFocusPanelSync();
    try {
      useAppStore.getState().setFocusTrack('drum');
      useAppStore.getState().setInputPanelMode('keyboard');
      expect(useAppStore.getState().inputPanelMode).toBe('keyboard');
    } finally {
      stop();
    }
  });

  test('writes nothing when the panel already matches', () => {
    const stop = startFocusPanelSync();
    let writes = 0;
    const unsub = useAppStore.subscribe((s) => s.inputPanelMode, () => { writes += 1; });
    try {
      useAppStore.getState().setFocusTrack('fx');
      useAppStore.getState().setFocusTrack('chord');
      expect(writes).toBe(0);
    } finally {
      unsub();
      stop();
    }
  });
});
