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
  test('a Modal titled Solna with Settings then About tabs, Settings selected', () => {
    expect(html).toContain('<dialog class="modal"');
    expect(html).toContain('max-w-2xl'); // size lg
    expect(html).toContain('Solna</h3>');
    expect(html).toContain('role="tablist"');
    expect(html.indexOf('id="app-modal-tab-settings"')).toBeLessThan(html.indexOf('id="app-modal-tab-about"'));
    expect(openTag(html, 'id="app-modal-tab-settings"')).toContain('aria-selected="true"');
    expect(openTag(html, 'id="app-modal-tab-about"')).toContain('aria-selected="false"');
  });

  test('Settings holds the theme picker and the min-height its open panel needs', () => {
    const panel = openTag(html, 'id="app-modal-panel-settings"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('min-h-120');
    expect(panel).not.toContain('hidden');
    expect(html).toContain('id="btn-theme-picker"');
  });

  test('About is rendered hidden with the name, description, author and repo link', () => {
    expect(openTag(html, 'id="app-modal-panel-about"')).toContain('hidden=""');
    expect(html).toContain('A browser audio workstation');
    expect(html).toContain('Made by Pathompong Thitithan');
    const link = openTag(html, 'id="link-app-repo"');
    expect(link).toContain('href="https://github.com/themiddnight/solna"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
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
