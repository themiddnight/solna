import { describe, expect, test } from 'bun:test';
import {
  DRIVE_EMPTY_HINT,
  DRIVE_EMPTY_STATE,
  DRIVE_LOADING_TEXT,
  appendPage,
  defaultSaveName,
  formatModified,
  sortBrowserRows,
  toBrowserRows,
} from './driveBrowser';
import { SOLNA_DRIVE_MIME, type DriveFileMeta } from '../store/driveClient';

const meta = (
  id: string,
  name: string,
  modifiedTime: string,
  mimeType: string = SOLNA_DRIVE_MIME,
): DriveFileMeta => ({ id, name, modifiedTime, mimeType });

describe('toBrowserRows', () => {
  test('keeps solna projects and drops anything else', () => {
    const rows = toBrowserRows([
      meta('f1', 'a.solna', '2026-09-02T00:00:00.000Z'),
      meta('x1', 'notes.txt', '2026-09-03T00:00:00.000Z', 'text/plain'),
      // A folder cannot appear under `drive.file` unless this app created one,
      // which it never does — but a row that is not a project is dropped rather
      // than rendered as a button that does nothing.
      meta('d1', 'Sketches', '2026-09-01T00:00:00.000Z', 'application/vnd.google-apps.folder'),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['a.solna']);
  });
});

describe('sortBrowserRows', () => {
  test('newest first, without mutating the input', () => {
    const rows = toBrowserRows([
      meta('f1', 'older.solna', '2026-09-01T00:00:00.000Z'),
      meta('f2', 'newer.solna', '2026-09-05T00:00:00.000Z'),
    ]);
    expect(sortBrowserRows(rows).map((row) => row.id)).toEqual(['f2', 'f1']);
    expect(rows.map((row) => row.id)).toEqual(['f1', 'f2']);
  });

  test('two files with the same timestamp fall back to name order, so the list is stable', () => {
    const rows = toBrowserRows([
      meta('f2', 'b.solna', '2026-09-01T00:00:00.000Z'),
      meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z'),
    ]);
    expect(sortBrowserRows(rows).map((row) => row.id)).toEqual(['f1', 'f2']);
  });
});

describe('appendPage', () => {
  test('accumulates rows and carries the new token', () => {
    const first = { files: [meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z')], nextPageToken: 'p2' };
    const second = { files: [meta('f2', 'b.solna', '2026-09-02T00:00:00.000Z')] };
    const merged = appendPage(first, second);
    expect(merged.files.map((file) => file.id)).toEqual(['f1', 'f2']);
    expect(merged.nextPageToken).toBeUndefined();
  });

  test('a file that appears on both pages is kept once — a save can shift the window', () => {
    const first = { files: [meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z')], nextPageToken: 'p2' };
    const second = { files: [meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z'), meta('f2', 'b.solna', '2026-09-02T00:00:00.000Z')] };
    expect(appendPage(first, second).files.map((file) => file.id)).toEqual(['f1', 'f2']);
  });

  test('a later page wins for a repeated id', () => {
    const first = { files: [meta('f1', 'old name.solna', '2026-09-01T00:00:00.000Z')], nextPageToken: 'p2' };
    const second = { files: [meta('f1', 'new name.solna', '2026-09-02T00:00:00.000Z')] };
    expect(appendPage(first, second).files[0].name).toBe('new name.solna');
  });
});

describe('formatModified', () => {
  test('renders the date part of an ISO timestamp, and a dash for anything unusable', () => {
    expect(formatModified('2026-09-12T10:00:00.000Z')).toBe('2026-09-12');
    expect(formatModified('')).toBe('—');
    expect(formatModified('2026-09')).toBe('—');
  });
});

describe('defaultSaveName', () => {
  test('uses the project name, and untitled when there is none', () => {
    expect(defaultSaveName('My Sketch')).toBe('My Sketch');
    expect(defaultSaveName('   ')).toBe('untitled');
    expect(defaultSaveName(null)).toBe('untitled');
  });
});

describe('the copy', () => {
  test('the empty state is a statement, and names the one thing it cannot show', () => {
    expect(DRIVE_EMPTY_STATE).toBe('No Solna projects in your Drive yet.');
    // The hint is not decoration: `drive.file` hides every file solna did not
    // create, so a user looking at an empty list with their own .solna sitting
    // in Drive needs to be told why, and what to do instead.
    expect(DRIVE_EMPTY_HINT).toBe(
      'Solna only sees files it created here. To open a .solna from somewhere else, download it and use Open .solna.',
    );
    expect(DRIVE_LOADING_TEXT).toBe('Loading…');
  });
});
