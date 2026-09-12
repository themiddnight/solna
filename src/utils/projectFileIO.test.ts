import { describe, expect, test } from 'bun:test';
import { downloadBlob, downloadTextFile, projectFileName, readFileAsText, slugifyProjectName } from './projectFileIO';

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

describe('downloadBlob', () => {
  /**
   * A document stub that records the anchor it was handed. `throwOnClick`
   * makes the click itself fail — the blocked-download case — rather than
   * casting the stub's `createElement` aside in one test.
   */
  function recordingDoc(throwOnClick = false) {
    const clicks: string[] = [];
    const removed: string[] = [];
    const doc = {
      createElement: () => {
        const anchor = {
          href: '',
          download: '',
          click: () => {
            if (throwOnClick) throw new Error('blocked');
            clicks.push(anchor.href);
          },
          remove: () => removed.push(anchor.href),
        };
        return anchor;
      },
      body: { appendChild: () => {} },
    } as unknown as Document;
    return { doc, clicks, removed };
  }

  test('creates a URL, clicks the anchor, and revokes in the same order', () => {
    const { doc, clicks, removed } = recordingDoc();
    const revoked: string[] = [];
    const url = {
      createObjectURL: () => 'blob:1',
      revokeObjectURL: (href: string) => revoked.push(href),
    };
    downloadBlob('song.wav', new Blob(['x'], { type: 'audio/wav' }), doc, url);
    expect(clicks).toEqual(['blob:1']);
    // Revoked, and revoked AFTER the click: a URL revoked first is a download
    // that never starts.
    expect(removed).toEqual(['blob:1']);
    expect(revoked).toEqual(['blob:1']);
  });

  test('revokes even when the click throws', () => {
    const { doc } = recordingDoc(true);
    const revoked: string[] = [];
    const url = { createObjectURL: () => 'blob:2', revokeObjectURL: (h: string) => revoked.push(h) };
    expect(() => downloadBlob('song.wav', new Blob(['x']), doc, url)).toThrow('blocked');
    expect(revoked).toEqual(['blob:2']);
  });

  test('downloadTextFile is the same download with a text blob', () => {
    const { doc, clicks } = recordingDoc();
    const url = { createObjectURL: () => 'blob:3', revokeObjectURL: () => {} };
    downloadTextFile('a.solna', 'body', 'application/json', doc, url);
    expect(clicks).toEqual(['blob:3']);
  });
});

describe('readFileAsText', () => {
  test('reads text and treats a zero-byte file as empty', async () => {
    expect(await readFileAsText({ size: 2, text: async () => '{}' })).toBe('{}');
    expect(await readFileAsText({ size: 0, text: async () => 'ignored' })).toBe('');
  });
});
