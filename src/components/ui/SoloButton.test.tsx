import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { SoloButton } from './SoloButton';

afterEach(() => {
  useAppStore.setState({ soloTracks: [] });
});

describe('SoloButton', () => {
  test('inactive: an outlined icon button naming the track it solos', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<SoloButton track="drums" />);
    expect(html).toContain('aria-label="Solo Drums"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('btn btn-square btn-xs btn-ghost border border-base-300');
    expect(html).not.toContain('btn-primary');
  });

  test('active: primary, pressed, and the label says how to undo it', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    const html = renderToString(<SoloButton track="drums" />);
    expect(html).toContain('aria-label="Un-solo Drums"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('btn btn-square btn-xs btn-primary');
  });

  test('a solo on one track does not light another track button', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    const html = renderToString(<SoloButton track="bass" />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Solo Bass"');
  });

  test('the size prop reaches the daisyUI size class', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<SoloButton track="lead" size="sm" />);
    expect(html).toContain('btn btn-square btn-sm btn-ghost');
  });

  test('each placement gets a stable id', () => {
    useAppStore.setState({ soloTracks: [] });
    expect(renderToString(<SoloButton track="pad" />)).toContain('id="btn-solo-pad"');
  });

  /**
   * Every view stays mounted, so the Sound view's target-following button and
   * the per-surface button for that same track are in the document together.
   * Without the override they would share `btn-solo-pad` (or lead/chord/bass,
   * whichever the target is) and the id would name whichever rendered first.
   */
  test('an explicit id wins, so a second placement of the same track is distinct', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<SoloButton track="pad" id="btn-solo-target" />);
    expect(html).toContain('id="btn-solo-target"');
    expect(html).not.toContain('id="btn-solo-pad"');
  });
});
