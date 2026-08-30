import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ArrangeView } from './ArrangeView';

describe('ArrangeView', () => {
  test('renders the default single region with its bar count and disabled delete', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-arrange-add"');
    expect(html).toContain('Region 1');
    expect(html).toContain('4 bars');
    expect(html).toContain('btn-region-delete-region-default-1');
    // A single region cannot be deleted.
    expect(html).toContain('disabled');
  });

  test('never uses raw colour literals', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('rgba(');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('dark:');
  });

  test('each region renders an inline four-channel mixer', () => {
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('btn-mute-synth-region-default-1');
    expect(html).toContain('btn-mute-drum-region-default-1');
    expect(html).toContain('btn-mute-chord-region-default-1');
    expect(html).toContain('btn-mute-bass-region-default-1');
    expect(html).toContain('slider-synth-region-default-1');
  });
});
