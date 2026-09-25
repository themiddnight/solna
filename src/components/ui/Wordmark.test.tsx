import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Wordmark } from './Wordmark';

const noop = () => {};

describe('Wordmark', () => {
  // A real <button> now: it opens the app modal, and is no longer a dropdown
  // trigger (the project menu has its own chevron) — R348.
  test('is a button that announces a dialog, with a 44px target', () => {
    const html = renderToString(<Wordmark onClick={noop} />);
    expect(html.startsWith('<button')).toBe(true);
    expect(html).toContain('id="btn-app-modal"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html).toContain('h-8 w-8');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex');
  });

  test('its accessible name contains the visible word (label in name)', () => {
    expect(renderToString(<Wordmark onClick={noop} />)).toContain('aria-label="Solna — settings and about"');
  });

  test('shows a hover and focus-visible affordance from theme tokens', () => {
    const html = renderToString(<Wordmark onClick={noop} />);
    expect(html).toContain('hover:bg-base-200');
    expect(html).toContain('focus-visible:outline-primary');
  });

  test('markOnly drops the text', () => {
    expect(renderToString(<Wordmark onClick={noop} markOnly />)).not.toContain('solna</span>');
  });
});
