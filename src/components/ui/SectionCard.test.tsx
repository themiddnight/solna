import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Disc3 } from 'lucide-react';
import { SectionCard } from './SectionCard';
import { PANEL_CARD } from './PanelCard';
import { ACTION_CLUSTER, SECTION_HEADER } from './fieldClasses';

describe('SectionCard', () => {
  test('opens with the shared section band: primary icon, then the section header', () => {
    const html = renderToString(
      <SectionCard icon={Disc3} title="Drum Sound">
        body
      </SectionCard>,
    );
    expect(html).toContain(`<div class="${PANEL_CARD}">`);
    expect(html).toContain('w-3.5 h-3.5 text-primary"');
    expect(html).toContain(`<span class="${SECTION_HEADER}">Drum Sound</span>`);
    expect(html).toContain('body');
  });

  /**
   * The three Sound sections must be scannable as peers, so the band is one
   * component and not three near-copies — the reason ViewHeader exists one
   * level up.
   */
  test('two sections render the identical band markup around different titles', () => {
    const drum = renderToString(<SectionCard icon={Disc3} title="Drum Sound">a</SectionCard>);
    const mixer = renderToString(<SectionCard icon={Disc3} title="Mixer">b</SectionCard>);
    expect(drum.replace('Drum Sound', 'Mixer').replace('>a<', '>b<')).toBe(mixer);
  });

  /**
   * Grouped in one cell, not spread: two buttons handed in as a bare fragment
   * would each become a direct child of the `justify-between` row and drift to
   * opposite ends of the band.
   */
  test('actions ride the band in a single cell, opposite the title', () => {
    const html = renderToString(
      <SectionCard
        icon={Disc3}
        title="Drum Sound"
        actions={<><button>Save</button><button>Kit</button></>}
      >
        body
      </SectionCard>,
    );
    expect(html).toContain('justify-between');
    // Both buttons inside ONE element wearing the shared cluster token.
    // Matched by parsing the cell out rather than by an exact class string:
    // the class is `cx(ACTION_CLUSTER, 'relative')` and cx owns the order, so
    // an exact literal made a class-order change a SectionCard failure.
    const cell = /<div class="([^"]*)"><button>Save<\/button><button>Kit<\/button><\/div>/.exec(html);
    expect(cell).not.toBeNull();
    const classes = new Set((cell?.[1] ?? '').split(' '));
    for (const token of ACTION_CLUSTER.split(' ')) expect(classes).toContain(token);
    expect(classes).toContain('relative');
  });

  test('no actions cell at all when a section has none', () => {
    const html = renderToString(<SectionCard icon={Disc3} title="Mixer">body</SectionCard>);
    expect(html).not.toContain('gap-1.5 min-h-8');
  });

  /**
   * The target tint is painted once, on the section that owns the target —
   * design.md §6.5. It reaches PanelCard's shell, not an inner element.
   */
  test('a tint follows the panel shell', () => {
    const html = renderToString(
      <SectionCard icon={Disc3} title="Synth" tint="ring-1 ring-module-chord/40 tint-chord">
        body
      </SectionCard>,
    );
    expect(html).toContain(`class="${PANEL_CARD} ring-1 ring-module-chord/40 tint-chord"`);
  });

  // No "leaves no double space" test here. `cx` collapses runs of whitespace
  // and `cx.test.ts` pins that for every consumer; re-testing it through
  // SectionCard made this file red for a stray double space anywhere in a
  // caller's children.
});
