import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Waves } from 'lucide-react';
import { ModuleHeader } from './ModuleHeader';

describe('ModuleHeader', () => {
  test('renders the row and the canonical title as one class string each', () => {
    const html = renderToString(<ModuleHeader title="Space Reverb" />);
    expect(html).toContain('class="flex items-center justify-between border-b border-base-300 pb-2"');
    expect(html).toContain('class="text-xs font-bold text-base-content flex items-center gap-1.5"');
    expect(html).toContain('Space Reverb');
  });

  test('badge and icon sit inside the title span, badge first', () => {
    const html = renderToString(
      <ModuleHeader badge={1} icon={<Waves className="w-3.5 h-3.5 text-accent" />} title="Space Reverb" />,
    );
    expect(html).toContain('class="badge badge-sm badge-outline tabular-nums">1</span>');
    expect(html.indexOf('badge-outline')).toBeLessThan(html.indexOf('lucide-waves'));
  });

  test('right is the row’s second cell', () => {
    const html = renderToString(<ModuleHeader title="Reverb" right={<button type="button">Bypass</button>} />);
    expect(html).toContain('<button type="button">Bypass</button>');
  });

  /** PresetLibrary's inline save header: the parent form already draws the rule. */
  test('divider={false} drops the border and the padding', () => {
    const html = renderToString(<ModuleHeader divider={false} title="Save" />);
    expect(html).toContain('class="flex items-center justify-between"');
    expect(html).not.toContain('border-b border-base-300 pb-2');
  });

  /** ChordView's left cell is a section header plus badges, not the canonical title. */
  test('children replace the title span entirely', () => {
    const html = renderToString(
      <ModuleHeader className="flex-wrap gap-2">
        <div className="flex items-center gap-2">custom</div>
      </ModuleHeader>,
    );
    expect(html).toContain('class="flex items-center justify-between border-b border-base-300 pb-2 flex-wrap gap-2"');
    expect(html).not.toContain('text-xs font-bold text-base-content flex items-center gap-1.5');
    expect(html).toContain('custom');
  });
});
