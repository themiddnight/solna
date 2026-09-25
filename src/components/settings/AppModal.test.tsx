import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppModal } from './AppModal';
import { closeAppModal } from './useAppModal';

function openTag(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

// The open flag reads the store's creation-time value under renderToString
// (R257), so the modal renders closed — a native <dialog> still renders its
// children, which is what these tests pin.
const html = renderToString(<AppModal />);

describe('AppModal', () => {
  test('a Modal titled Solna with no tabs', () => {
    expect(html).toContain('<dialog class="modal"');
    expect(html).toContain('max-w-2xl'); // size lg
    expect(html).toContain('Solna</h3>');
    // The picker's own Dark | Light switcher is the only tablist.
    expect(html.match(/role="tablist"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Scheme"');
    expect(html).not.toContain('role="tabpanel"');
  });

  test('the theme picker, then a divider, then About — all visible and not inert', () => {
    const theme = html.indexOf('id="app-modal-theme"');
    const divider = html.indexOf('class="divider"');
    const about = html.indexOf('id="app-modal-about"');
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(html.indexOf('id="btn-theme-picker"'));
    expect(html.indexOf('id="btn-theme-picker"')).toBeLessThan(divider);
    expect(divider).toBeLessThan(about);
    expect(html).not.toContain('invisible');
    expect(html).not.toContain('inert');
  });

  test('About holds the description, author and repo link', () => {
    expect(html).toContain('A browser audio workstation');
    expect(html).toContain('Made by Pathompong Thitithan');
    const link = openTag(html, 'id="link-app-repo"');
    expect(link).toContain('href="https://github.com/themiddnight/solna"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  test('About links to murva, tagged with UTM, after the repo link', () => {
    const link = openTag(html, 'id="link-murva"');
    expect(link).toContain(
      'href="https://murva-beta.themiddnight.dev/?utm_source=solna&amp;utm_medium=referral&amp;utm_content=about"',
    );
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(html.indexOf('id="link-app-repo"')).toBeLessThan(html.indexOf('id="link-murva"'));
    expect(html).toContain('Make music together with friends, in real time.');
  });
});

// Review Focus 2: Escape, the backdrop and the close button all end in
// Modal's onClose; that must revert an unapplied preview before closing.
describe('closeAppModal', () => {
  test('reverts, then closes', () => {
    const calls: string[] = [];
    closeAppModal(
      () => calls.push('revert'),
      (open) => calls.push(`open=${open}`),
    );
    expect(calls).toEqual(['revert', 'open=false']);
  });
});
