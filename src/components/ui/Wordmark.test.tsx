import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  test('is a real button with the accessible label and a 44px target', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-label="Open Project Manager"');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html).toContain('h-8 w-8'); // the mark image is unchanged; padding lives on the button
  });

  test('shows a hover and focus-visible affordance from theme tokens', () => {
    const html = renderToString(<Wordmark />);
    expect(html).toContain('hover:bg-base-200');
    expect(html).toContain('focus-visible:outline-primary');
  });

  test('renders the dirty badge only when dirty', () => {
    expect(renderToString(<Wordmark />)).not.toContain('Unsaved changes');
    const html = renderToString(<Wordmark dirty />);
    expect(html).toContain('indicator-item status status-warning status-sm');
    expect(html).toContain('aria-label="Unsaved changes"');
  });

  test('keeps the text props working', () => {
    expect(renderToString(<Wordmark textClassName="hidden sm:inline" />)).toContain('leading-none hidden sm:inline');
    expect(renderToString(<Wordmark markOnly />)).not.toContain('solna</span>');
  });
});
