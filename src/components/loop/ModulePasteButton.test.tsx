import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ModulePasteButton } from './ModulePasteButton';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';

afterEach(() => {
  useAppStore.setState({ loopClipboard: null });
});

describe('ModulePasteButton', () => {
  test('renders disabled when there is no buffer', () => {
    const html = renderToString(<ModulePasteButton groups={['lead-sound']} />);
    expect(html).toContain('id="btn-paste-lead-sound"');
    expect(html).toContain('disabled');
  });

  test('renders enabled and uses the source loop\'s current label', () => {
    const source = { ...createDefaultLoop(), id: 'loop-a', name: 'Renamed Verse' };
    const target = { ...createDefaultLoop(), id: 'loop-b' };
    useAppStore.setState({
      loops: [source, target],
      loopClipboard: { sourceLoopId: 'loop-a' },
      activeLoopId: 'loop-b',
    });
    const html = renderToString(<ModulePasteButton groups={['chord-progression']} />);
    expect(html).toContain('id="btn-paste-chord-progression"');
    expect(html).not.toContain('disabled');
    expect(html).toContain('Paste Chord progression from Renamed Verse');
  });
});
