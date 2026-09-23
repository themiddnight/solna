import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { HEADER_GROUP } from './fieldClasses';
import { SegmentHeader } from './SegmentHeader';
import { ViewHeader } from './ViewHeader';

describe('HeaderCard slots', () => {
  /**
   * `viewControls` selects WHAT the view shows — Pattern's segment row, the
   * Sound tab's Simple/Pro depth — and `actions` holds what you DO to what is
   * on screen. The first sits with the title, the second at the far right, and
   * this test pins the order rather than the classes so a restyle cannot flip
   * the two slots without saying so.
   */
  test('viewControls sits with the title, actions at the end', () => {
    const html = renderToString(
      <ViewHeader
        view="sound"
        viewControls={<button id="controls">c</button>}
        actions={<button id="actions">a</button>}
      />,
    );
    expect(html.indexOf('</h2>')).toBeLessThan(html.indexOf('id="controls"'));
    expect(html.indexOf('id="controls"')).toBeLessThan(html.indexOf('id="actions"'));
  });

  /**
   * The segment row is the reference the other header group is sized against:
   * one shell, so two segmented controls in the same slot of the same card
   * cannot be 40px and 32px tall. `SoundView.test.tsx` holds the other half —
   * that Simple/Pro wears the same shell in the same slot.
   */
  test('the segment row wears HEADER_GROUP', () => {
    expect(renderToString(<SegmentHeader segment="lead" />)).toContain(HEADER_GROUP);
  });
});

describe('a sticky header', () => {
  test('pins below md only, and keeps its title for screen readers', () => {
    const html = renderToString(<ViewHeader view="sound" sticky />);
    expect(html).toContain('max-md:sticky');
    expect(html).toContain('max-md:sr-only');
    expect(html).not.toMatch(/(?<!max-md:)\bsticky\b/);
  });

  test('is opt-in: a plain header does not pin', () => {
    expect(renderToString(<ViewHeader view="arrange" />)).not.toContain('sticky');
  });

  test('every Pattern segment header pins', () => {
    expect(renderToString(<SegmentHeader segment="fx" />)).toContain('max-md:sticky');
  });
});

/**
 * The chip moved here from TransportBar. These assertions moved with it —
 * only the header they are read off changed.
 */
describe('the header solo chip', () => {
  afterEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  test('is absent when nothing is soloed', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<ViewHeader view="sound" />);
    expect(html).not.toContain('data-solo-chip');
    expect(html).not.toContain('SOLO ·');
  });

  test('names every soloed track and offers a clear', () => {
    useAppStore.setState({ soloTracks: ['lead', 'drums'] });
    const html = renderToString(<ViewHeader view="sound" />);
    expect(html).toContain('data-solo-chip');
    expect(html).toContain('SOLO · Lead + Drums');
    expect(html).toContain('aria-label="Clear solo"');
  });

  test('the chip is a warning badge — a state that is silencing something', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    expect(renderToString(<ViewHeader view="sound" />)).toContain('badge badge-lg badge-warning');
  });

  /**
   * The chip's tooltip is the only place the clearing rule is written for the
   * user, so it has to match SOLO_NAV_SOURCES (store/soloNav.ts) — layer and
   * active loop — plus projectSlice's own clear on an install. It said
   * "Pattern segment, layer or loop" until this test existed: the segment axis
   * was dropped when `focusTrack` merged the segment and the Sound target
   * (soloNav.ts records the argument), and the sentence describing the
   * behaviour was left behind, telling the user a set would clear on a hop it
   * actually survives. Pinned clause by clause rather than as one string so a
   * rewording is free and a dropped rule is not.
   */
  test('the tooltip states the clearing rule, and states the real one', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    const html = renderToString(<ViewHeader view="sound" />);
    // The two navigation axes soloNav watches, plus the project swap it
    // cannot see (loop ids are not unique across projects).
    expect(html).toContain('leave the Loop layer');
    expect(html).toContain('change loop');
    expect(html).toContain('open another project');
    // And the hop it deliberately survives, which is the half a user is
    // likelier to be surprised by in the other direction.
    expect(html).toContain('survives the Sound / Pattern hop');
    // The axis that was removed must not be advertised as one.
    expect(html).not.toContain('Pattern segment');
  });

  /**
   * A solo set survives the Sound <-> Pattern hop (store/soloNav.ts), so the
   * chip has to survive it too — which is why it lives in the shared card
   * rather than in one view.
   */
  test('rides the Pattern header as well, not just Sound', () => {
    useAppStore.setState({ soloTracks: ['chord'] });
    expect(renderToString(<SegmentHeader segment="accompaniment" />)).toContain('data-solo-chip');
  });

  /**
   * The clear × wears the chip's own colour variant rather than `btn-ghost`
   * plus overrides: `btn-warning` is what gives it both the surface's content
   * colour and a hover fill derived from the surface (see IconButton.tsx).
   * Pinned as a whole class list so a call-site override creeping back in is
   * a failing test rather than a re-review.
   */
  test('the clear button wears the chip colour, with no colour overrides', () => {
    useAppStore.setState({ soloTracks: ['bass'] });
    const html = renderToString(<ViewHeader view="sound" />);
    expect(html).toContain('class="btn btn-square btn-xs btn-warning btn-circle"');
  });

  /**
   * Six headers stay mounted at once, so the chip is addressed by a data
   * attribute — an id here would be six copies of one id in the live page.
   */
  test('carries no id, because six mounted headers each render one', () => {
    useAppStore.setState({ soloTracks: ['bass'] });
    const html = renderToString(<ViewHeader view="sound" />);
    // The chip is present and addressed by its data attribute...
    expect(html).toContain('data-solo-chip');
    // ...and the header emits no `id` at all, which is the actual claim. The
    // assertion here was `not.toContain('badge-track-solo')` — a name nothing
    // in the tree uses, so re-adding a real `id` to SoloChip would have put six
    // copies of it in the live page with this test still green.
    expect(html).not.toMatch(/\sid=/);
  });

  /**
   * A header with no actions and no solo must not leave an empty flex box in
   * the row: the cluster collapses on `:empty` instead.
   */
  test('the right-hand cluster collapses when it has nothing in it', () => {
    useAppStore.setState({ soloTracks: [] });
    expect(renderToString(<ViewHeader view="sound" />)).toContain('empty:hidden');
  });
});
