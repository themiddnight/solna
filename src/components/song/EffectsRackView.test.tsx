import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { EffectsRackView } from './EffectsRackView';

describe('EffectsRackView theming', () => {
  const html = renderToString(<EffectsRackView />);

  test('rack units are daisyUI cards on semantic tokens', () => {
    expect(html).toContain('card bg-panel');
    expect(html).toContain('card-body');
    expect(html).toContain('text-primary');
    expect(html).toContain('text-accent');
    expect(html).toContain('text-secondary');
  });

  test('bypass switches are daisyUI buttons', () => {
    expect(html).toContain('btn btn-xs');
    expect(html).toContain('btn-active');
    expect(html).toContain('btn-bypass-reverb');
    expect(html).toContain('btn-bypass-delay');
    expect(html).toContain('btn-bypass-distortion');
    expect(html).toContain('btn-bypass-eq');
  });

  test('no dark: variants and no raw palette colours survive', () => {
    expect(html).not.toContain('dark:');
    for (const legacy of ['purple-', 'cyan-', 'indigo-', 'amber-', 'emerald-']) {
      expect(html).not.toContain(legacy);
    }
  });
});
