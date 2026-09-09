import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ToolbarButton, ToolbarGroup, ToolbarLane } from './Toolbar';

const noop = () => {};

describe('ToolbarButton', () => {
  test('the label stays visible unless a caller asks for it to collapse', () => {
    const plain = renderToString(
      <ToolbarButton id="btn-x" icon={<svg />} label="Paste" title="Paste" onClick={noop} />,
    );
    const collapsed = renderToString(
      <ToolbarButton id="btn-x" icon={<svg />} label="Paste" title="Paste" onClick={noop} collapseLabel />,
    );
    // Opt-in, because `Copy` and `Paste` reduce to two near-identical 12px
    // glyphs once the words go — a lane with its own row under a grid has the
    // width to keep them and must.
    expect(plain).not.toContain('hidden sm:inline');
    expect(collapsed).toContain('hidden sm:inline');
    expect(plain).toContain('Paste');
  });

  test('a plain action carries no pressed state at all', () => {
    const html = renderToString(
      <ToolbarButton id="btn-x" icon={<svg />} label="Copy" title="Copy" onClick={noop} />,
    );
    // Not `aria-pressed="false"` — a copy button is not a toggle that happens
    // to be off, and announcing it as one is a lie to a screen reader.
    expect(html).not.toContain('aria-pressed');
  });

  test('only a pressed toggle wears the error red', () => {
    const idle = renderToString(
      <ToolbarButton id="btn-r" icon={<svg />} label="Rec" title="Rec" onClick={noop} pressed={false} />,
    );
    const armed = renderToString(
      <ToolbarButton id="btn-r" icon={<svg />} label="Rec" title="Rec" onClick={noop} pressed />,
    );
    expect(idle).toContain('aria-pressed="false"');
    expect(idle).not.toContain('btn-error');
    // Red belongs to the armed recorder alone. A destructive action must not
    // also claim it, or the two stop being distinguishable at a glance.
    expect(armed).toContain('btn-error');
    expect(armed).toContain('aria-pressed="true"');
  });

  test('disabled reaches the DOM, so paste with an empty clipboard is dead', () => {
    const html = renderToString(
      <ToolbarButton id="btn-p" icon={<svg />} label="Paste" title="Paste" onClick={noop} disabled />,
    );
    expect(html).toContain('disabled');
  });
});

describe('ToolbarGroup', () => {
  test('a group refuses to shrink, so a wrap breaks between groups not through one', () => {
    // The lane's gap-x-3 against the group's gap-1 is what makes the break
    // land in the wider gap; shrink-0 is what stops the group collapsing
    // instead of wrapping. Both together are the whole mechanism.
    const html = renderToString(<ToolbarGroup>{'x'}</ToolbarGroup>);
    expect(html).toContain('shrink-0');
    expect(html).toContain('gap-1');
  });

  test('a lane wraps, and its cross-axis gap is tighter than its inline one', () => {
    const html = renderToString(<ToolbarLane>{'x'}</ToolbarLane>);
    expect(html).toContain('flex-wrap');
    expect(html).toContain('gap-x-3');
    expect(html).toContain('gap-y-2');
  });
});
