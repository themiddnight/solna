import { describe, expect, test } from 'bun:test';
import { downloadTextFile, projectFileName, readFileAsText, slugifyProjectName } from './projectFile';

describe('slugifyProjectName / projectFileName', () => {
  test('slugifies and appends .solna', () => {
    expect(slugifyProjectName('  Neon Highway 1984!  ')).toBe('neon-highway-1984');
    expect(slugifyProjectName('***')).toBe('project');
    expect(projectFileName('My Song')).toBe('my-song.solna');
  });
  test('handles unicode input by stripping non-ASCII', () => {
    expect(slugifyProjectName('Café Über 2')).toBe('caf-ber-2');
  });
});

describe('downloadTextFile', () => {
  test('creates an anchor with the object URL and download name, clicks it, and revokes the URL', () => {
    const clicks: string[] = [];
    let revoked: string | null = null;
    const anchor = { href: '', download: '', click: () => clicks.push(anchor.href), remove: () => {} };
    const doc = { createElement: () => anchor, body: { appendChild: () => {} } } as unknown as Document;
    const url = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u: string) => { revoked = u; } };
    downloadTextFile('x.solna', '{}', 'application/json', doc, url);
    expect(anchor.download).toBe('x.solna');
    expect(clicks).toEqual(['blob:fake']);
    expect(revoked).toBe('blob:fake');
  });
  test('revokes the URL and removes the anchor even if click() throws', () => {
    let revoked: string | null = null;
    let removed = false;
    const error = new Error('click failed');
    const anchor = {
      href: '',
      download: '',
      click: () => { throw error; },
      remove: () => { removed = true; },
    };
    const doc = { createElement: () => anchor, body: { appendChild: () => {} } } as unknown as Document;
    const url = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u: string) => { revoked = u; } };
    expect(() => downloadTextFile('x.solna', '{}', 'application/json', doc, url)).toThrow(error);
    expect(removed).toBe(true);
    expect(revoked).toBe('blob:fake');
  });
});

describe('readFileAsText', () => {
  test('reads text and treats a zero-byte file as empty', async () => {
    expect(await readFileAsText({ size: 2, text: async () => '{}' })).toBe('{}');
    expect(await readFileAsText({ size: 0, text: async () => 'ignored' })).toBe('');
  });
});
