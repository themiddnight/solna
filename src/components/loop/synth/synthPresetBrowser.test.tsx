import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { useSynthPresetBrowser, type SynthPresetBrowser } from './synthPresetBrowser';

let browser: SynthPresetBrowser | null = null;

function BrowserProbe() {
  browser = useSynthPresetBrowser('synth');
  return null;
}

const initialSynth = useAppStore.getState().synthParams;

afterEach(() => {
  useAppStore.setState({ feedback: [], synthParams: initialSynth });
});

describe('the synth preset toasts go through the feedback host (R330)', () => {
  test('a load confirms under the synth-preset key', () => {
    renderToString(<BrowserProbe />);
    const preset = SYNTH_PRESETS[0];
    browser!.selectPreset(preset);
    const [entry] = useAppStore.getState().feedback;
    expect({ key: entry.key, tone: entry.tone, message: entry.message }).toEqual({
      key: 'synth-preset',
      tone: 'success',
      message: `Loaded [${preset.category}] "${preset.name}"`,
    });
  });

  test('a save replaces the load toast under the same key', () => {
    renderToString(<BrowserProbe />);
    browser!.selectPreset(SYNTH_PRESETS[0]);
    const saved = useAppStore.getState().saveCustomPreset('Probe Patch', useAppStore.getState().synthParams, 'User');
    browser!.adoptSavedPreset(saved);
    const feedback = useAppStore.getState().feedback;
    expect(feedback).toHaveLength(1);
    expect(feedback[0].message).toBe(`Preset "Probe Patch" saved to User!`);
    useAppStore.getState().deleteCustomPreset(saved.id);
  });
});
