import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SequencerView } from './SequencerView';

describe('SequencerView theming', () => {
  const html = renderToString(<SequencerView />);

  test('panels are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-base-100 border border-base-300');
    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#0B0D19');
  });

  test('toolbar controls use daisyUI btn and select classes', () => {
    expect(html).toContain('btn btn-xs btn-ghost');
    expect(html).toContain('select select-xs select-ghost');
  });

  test('the drum filter type switch is a daisyUI join', () => {
    expect(html).toContain('join');
    expect(html).toContain('btn btn-xs join-item');
  });

  test('step numbers keep font-mono and the downbeat uses accent', () => {
    expect(html).toContain('font-mono');
    expect(html).toContain('text-accent');
  });

  test('track dots render semantic token backgrounds', () => {
    expect(html).toContain('bg-error');
    expect(html).toContain('bg-warning');
    expect(html).toContain('bg-success');
    expect(html).toContain('bg-accent');
    expect(html).toContain('bg-secondary');
  });

  test('the active-step shadow that used to read shadow-indigo-500/20 is now shadow-primary/20', () => {
    expect(html).toContain('shadow-primary/20');
  });

  test('no legacy palette utilities survive', () => {
    for (const cls of [
      'amber-',
      'cyan-',
      'emerald-',
      'indigo-',
      'pink-',
      'purple-',
      'rose-',
      // Bare 'slate' false-positives on 'translate' (as in -translate-y-1/2),
      // so we check for the palette-color form 'slate-' specifically.
      'slate-',
      'text-white',
      'bg-white/20',
    ]) {
      expect(html).not.toContain(cls);
    }
  });
});
