import { describe, expect, test } from 'bun:test';
import { HEADER_TOOLS, headerToolsOn } from './headerTools';

const ids = (tools: readonly { id: string }[]) => tools.map((tool) => tool.id);

describe('HEADER_TOOLS', () => {
  test('lists the right cluster in today\'s order, each tool once', () => {
    expect(ids(HEADER_TOOLS)).toEqual([
      'vibes', 'loop-copy', 'loop-selector', 'project-name', 'follow-playhead', 'export', 'scale', 'theme',
    ]);
    expect(new Set(ids(HEADER_TOOLS)).size).toBe(HEADER_TOOLS.length);
  });

  test('the loop layer gets the copy button, the loop picker, the vibes, the key menu and the theme', () => {
    expect(ids(headerToolsOn('loop'))).toEqual(['vibes', 'loop-copy', 'loop-selector', 'scale', 'theme']);
  });

  // Project name, follow and export are what the SONG tabs edit; an export is
  // an arrangement action, so it never shows over a loop.
  test('the song layer gets the project name, follow toggle, export and the theme', () => {
    expect(ids(headerToolsOn('song'))).toEqual(['project-name', 'follow-playhead', 'export', 'theme']);
  });

  test('every tool is available on at least one layer', () => {
    for (const tool of HEADER_TOOLS) expect(tool.layers.length).toBeGreaterThan(0);
  });
});
