import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DrumPads } from './DrumPads';
import { DEFAULT_PADS } from '../ui/DrumPadGrid';
import type { InputDeckDrumProps } from '../useInputDeck';

const drumProps: InputDeckDrumProps = {
  pads: DEFAULT_PADS,
  activePadId: null,
  onTriggerPad: () => {},
  onPadVolumeChange: () => {},
};

describe('DrumPads', () => {
  test('renders the pad grid without a title or kit selector', () => {
    const html = renderToString(<DrumPads drumProps={drumProps} />);
    expect(html.includes('Drum Pads')).toBe(false);
    expect(html.includes('<select')).toBe(false);
    expect(html).toContain('Kick Drum');
    expect(html).toContain('Crash Cymbal');
    expect(html).toContain('btn-pad-kick');
  });

  test('wraps the shared DrumPadGrid in the in-page card', () => {
    const html = renderToString(<DrumPads drumProps={drumProps} />);
    expect(html).toContain('card bg-panel border border-base-300');
    expect(html).toContain('card-body');
  });
});
