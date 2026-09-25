import { describe, expect, test } from 'bun:test';
import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import type { ToolVariantProps } from '@/components/ui/MenuRowButton';
import { ExportButton } from '@/components/export/ExportButton';
import { LoopCopyButton } from '@/components/loop/LoopCopyButton';
import { VibesButton } from '@/components/vibes/VibesButton';
import { FollowPlayheadToggle } from './FollowPlayheadToggle';

const ROW_TOOLS: Array<[string, ComponentType<ToolVariantProps>, string, string]> = [
  ['LoopCopyButton', LoopCopyButton, 'btn-copy-loop', 'Copy loop'],
  ['FollowPlayheadToggle', FollowPlayheadToggle, 'btn-follow-playhead', 'Follow the playing loop'],
  ['ExportButton', ExportButton, 'btn-export', 'Export'],
  ['VibesButton', VibesButton, 'btn-vibes', 'Vibes'],
];

describe('menu tools render a touch-sized row', () => {
  for (const [name, Tool, id, label] of ROW_TOOLS) {
    test(`${name} row: same id, a visible label, 44px tall`, () => {
      const html = renderToString(createElement(Tool, { variant: 'row' }));
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain('btn-block');
      expect(html).toContain('min-h-11');
      expect(html).toContain(label);
    });

    test(`${name} with no variant renders the bar markup, unchanged`, () => {
      const bar = renderToString(createElement(Tool));
      expect(bar).toBe(renderToString(createElement(Tool, { variant: 'bar' })));
      expect(bar).not.toContain('btn-block');
    });
  }

  test('the export row keeps its dialog beside it and still announces a dialog', () => {
    const html = renderToString(<ExportButton variant="row" />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('<dialog class="modal"');
  });

  test('the follow row is a pressed-state toggle', () => {
    expect(renderToString(<FollowPlayheadToggle variant="row" />)).toContain('aria-pressed=');
  });
});
