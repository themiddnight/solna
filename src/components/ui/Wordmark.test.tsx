import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  // A focusable span, not a <button>: it is rendered inside daisyUI's
  // `dropdown`, whose open state is driven by `:focus-within`, and a nested
  // button would swallow the focus the dropdown needs.
  test('is a focusable span with a 44px target', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html).toContain('h-8 w-8'); // the mark image is unchanged; padding lives on the trigger
  });

  test('shows a hover and focus-visible affordance from theme tokens', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain('hover:bg-base-200');
    expect(html).toContain('focus-visible:outline-primary');
  });

  // The wordmark carries no accessible name of its own any more: it is the
  // ProjectMenu trigger, and that caller is what names the control.
  test('takes its accessible name from the caller', () => {
    expect(renderToString(<Wordmark />)).not.toContain('aria-label=');
    expect(renderToString(<Wordmark ariaLabel="Project menu" />)).toContain('aria-label="Project menu"');
  });

  test('keeps the text props working', () => {
    expect(renderToString(<Wordmark textClassName="hidden sm:inline" />)).toContain('leading-none hidden sm:inline');
    expect(renderToString(<Wordmark markOnly />)).not.toContain('solna</span>');
  });
});
