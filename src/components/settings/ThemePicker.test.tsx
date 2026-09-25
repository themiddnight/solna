import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ThemePicker } from './ThemePicker';
import { themesOfScheme, type ThemeChoice, type ThemeId } from './themes';

/** The full opening tag of the element whose markup contains `needle`. */
function openTag(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

const noop = () => {};
const render = (preview: ThemeChoice, resolved: ThemeId, isPreviewing: boolean) =>
  renderToString(
    <ThemePicker preview={preview} resolved={resolved} isPreviewing={isPreviewing} onSelect={noop} onApply={noop} />,
  );

describe('ThemePicker', () => {
  test('the trigger is a focusable span (iOS Safari), labelled with the current choice', () => {
    const trigger = openTag(render('solna-dark', 'solna-dark', false), 'id="btn-theme-picker"');
    expect(trigger.startsWith('<span')).toBe(true);
    expect(trigger).toContain('role="button"');
    expect(trigger).toContain('tabindex="0"');
    expect(trigger).toContain('aria-label="Theme: Solna Dark"');
  });

  test('the panel is a focusable radiogroup dropdown whose list scrolls at 360px', () => {
    const html = render('solna-dark', 'solna-dark', false);
    const panel = openTag(html, 'role="radiogroup"');
    expect(panel).toContain('tabindex="0"');
    expect(panel).toContain('dropdown-content');
    expect(html).toContain('max-h-90 space-y-1 overflow-y-auto');
  });

  test('nothing previewed: no warning, Apply disabled', () => {
    const html = render('solna-dark', 'solna-dark', false);
    expect(html).not.toContain('Previewing');
    expect(html).not.toContain('status-warning');
    expect(openTag(html, 'id="btn-theme-apply"')).toContain('disabled=""');
  });

  test('previewing: warning dot, Previewing tag, Apply enabled', () => {
    const html = render('dracula', 'dracula', true);
    expect(html).toContain('status status-warning');
    expect(html).toContain('Previewing');
    expect(openTag(html, 'id="btn-theme-apply"')).not.toContain('disabled');
  });

  test('a dark preview opens on the Dark tab: Solna Dark first, then every dark daisyUI theme, each painted in itself', () => {
    const html = render('dracula', 'dracula', true);
    expect(openTag(html, 'id="theme-scheme-dark"')).toContain('aria-selected="true"');
    expect(openTag(html, 'id="theme-scheme-dark"')).toContain('tab-active');
    for (const entry of themesOfScheme('dark')) {
      expect(openTag(html, `id="theme-option-${entry.id}"`)).toContain(`data-theme="${entry.id}"`);
    }
    expect(html).not.toContain('id="theme-option-acid"');
    expect(html.indexOf('id="theme-option-solna-dark"')).toBeLessThan(html.indexOf('id="theme-option-abyss"'));
    expect(openTag(html, 'id="theme-option-dracula"')).toContain('aria-checked="true"');
    expect(openTag(html, 'id="theme-option-solna-dark"')).toContain('aria-checked="false"');
  });

  // Review Focus 5.
  test('System on a light OS: the Light tab, System checked, Solna Light first', () => {
    const html = render('system', 'solna-light', false);
    expect(openTag(html, 'id="theme-scheme-light"')).toContain('aria-selected="true"');
    expect(openTag(html, 'id="theme-option-system"')).toContain('aria-checked="true"');
    expect(openTag(html, 'id="btn-theme-picker"')).toContain('aria-label="Theme: System"');
    expect(html).toContain('System (follows OS)');
    expect(html.indexOf('id="theme-option-solna-light"')).toBeLessThan(html.indexOf('id="theme-option-acid"'));
    expect(html).not.toContain('id="theme-option-dracula"');
  });

  test('the System row is not painted in any theme', () => {
    expect(openTag(render('system', 'solna-dark', false), 'id="theme-option-system"')).not.toContain('data-theme');
  });
});
