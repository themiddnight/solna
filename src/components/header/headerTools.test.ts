import { describe, expect, test } from 'bun:test';
import { HEADER_TOOLS, headerToolsFor } from './headerTools';

const ids = (tools: readonly { id: string }[]) => tools.map((tool) => tool.id);

describe('HEADER_TOOLS', () => {
  test('lists the right cluster in today\'s order, each tool once', () => {
    expect(ids(HEADER_TOOLS)).toEqual([
      'loop-copy', 'loop-selector', 'project-name', 'follow-playhead', 'export', 'scale', 'theme',
    ]);
    expect(new Set(ids(HEADER_TOOLS)).size).toBe(HEADER_TOOLS.length);
  });

  test('the loop layer gets the copy button, the loop picker, the key menu and the theme', () => {
    expect([...ids(headerToolsFor('loop', 'subject')), ...ids(headerToolsFor('loop', 'actions'))])
      .toEqual(['loop-copy', 'loop-selector', 'scale', 'theme']);
  });

  // Project name, follow and export are what the SONG tabs edit; an export is
  // an arrangement action, so it never shows over a loop.
  test('the song layer gets the project name, follow toggle, export and the theme', () => {
    expect([...ids(headerToolsFor('song', 'subject')), ...ids(headerToolsFor('song', 'actions'))])
      .toEqual(['project-name', 'follow-playhead', 'export', 'theme']);
  });

  // The tab nav sits between the two groups: everything that names WHAT is
  // edited comes before it, only the theme after.
  test('the theme is the only tool after the tab nav', () => {
    expect(ids(HEADER_TOOLS.filter((tool) => tool.group === 'actions'))).toEqual(['theme']);
  });

  test('every tool is available on at least one layer', () => {
    for (const tool of HEADER_TOOLS) expect(tool.layers.length).toBeGreaterThan(0);
  });
});
