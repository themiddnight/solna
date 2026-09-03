import { describe, expect, test } from 'bun:test';
import {
  exportSessionDialog,
  guardAction,
  importDialog,
  importResultNotice,
  isValidProjectName,
  nameDefault,
  saveDialog,
  sessionLabel,
  storageDisabled,
} from './projectManagerFlow';
import { factoryProjectContent, makeEnvelope } from '../../store/projectFormat';

const body = { ...makeEnvelope('File', 2000), content: factoryProjectContent() };

describe('guardAction', () => {
  test('a clean session runs the action; a dirty one shows the guard first', () => {
    expect(guardAction(false, { kind: 'new' })).toEqual({ kind: 'none' });
    expect(guardAction(true, { kind: 'open', id: 'p' })).toEqual({ kind: 'dirty-guard', next: { kind: 'open', id: 'p' } });
  });
});

describe('importDialog', () => {
  test('a matching id shows the conflict dialog before anything else', () => {
    const existing = { ...makeEnvelope('Mine', 1000), id: body.id };
    expect(importDialog(body, [existing], true)).toEqual({ kind: 'import-conflict', body, existing });
  });
  test('a new id goes straight to the guarded import', () => {
    expect(importDialog(body, [], true)).toEqual({ kind: 'dirty-guard', next: { kind: 'import', body, mode: 'new' } });
    expect(importDialog(body, [], false)).toEqual({ kind: 'none' });
  });
});

describe('saveDialog', () => {
  test('no current project prompts for a name, carrying the follow-up action', () => {
    expect(saveDialog(null, { kind: 'new' })).toEqual({
      kind: 'name-prompt', purpose: 'save', initial: 'Untitled project', then: { kind: 'new' },
    });
    expect(saveDialog('p-1', null)).toEqual({ kind: 'none' });
  });
});

describe('nameDefault / isValidProjectName / sessionLabel / storageDisabled', () => {
  test('defaults per purpose', () => {
    expect(nameDefault('save', null)).toBe('Untitled project');
    expect(nameDefault('save-copy', 'Alpha')).toBe('Alpha copy');
    expect(nameDefault('save-copy', null)).toBe('Untitled project copy');
    expect(nameDefault('export-session', 'Alpha')).toBe('Alpha');
    expect(nameDefault('export-session', null)).toBe('Untitled project');
  });
  test('empty or whitespace names are rejected; duplicates are not a concern here', () => {
    expect(isValidProjectName('')).toBe(false);
    expect(isValidProjectName('   ')).toBe(false);
    expect(isValidProjectName(' a ')).toBe(true);
  });
  test('session label', () => {
    expect(sessionLabel(null, null)).toBe('Unsaved session');
    expect(sessionLabel('p', 'Alpha')).toBe('Alpha');
    expect(sessionLabel('p', null)).toBe('Unnamed project');
  });
  test('storage is disabled only when known unavailable', () => {
    expect(storageDisabled('unavailable')).toBe(true);
    expect(storageDisabled('ready')).toBe(false);
    expect(storageDisabled('unknown')).toBe(false);
  });
});

describe('importResultNotice', () => {
  test('nothing to say -> null, the modal may close', () => {
    expect(importResultNotice([], false)).toBeNull();
  });
  test('unrecognised references keep the modal open with a message', () => {
    expect(importResultNotice(['bass pattern "x"'], false)).toBe('Imported with unrecognised references: bass pattern "x"');
  });
  test('storage unavailable keeps the modal open even with no reference warnings', () => {
    expect(importResultNotice([], true)).toBe('Opened without saving — project storage is unavailable on this device.');
  });
  test('both combine into one message', () => {
    expect(importResultNotice(['bass pattern "x"'], true)).toBe(
      'Opened without saving — project storage is unavailable on this device. Imported with unrecognised references: bass pattern "x"',
    );
  });
});

describe('exportSessionDialog', () => {
  test('a resolvable current id exports straight away (no dialog)', () => {
    const meta = { ...makeEnvelope('Alpha', 1000), id: 'p' };
    expect(exportSessionDialog('p', 'Alpha', [meta])).toEqual({ kind: 'none' });
  });
  test('no current id prompts for a name', () => {
    expect(exportSessionDialog(null, null, [])).toEqual({
      kind: 'name-prompt', purpose: 'export-session', initial: 'Untitled project', then: null,
    });
  });
  test('a current id that is not in the list (e.g. storage went unavailable) also prompts', () => {
    expect(exportSessionDialog('p', null, [])).toEqual({
      kind: 'name-prompt', purpose: 'export-session', initial: 'Untitled project', then: null,
    });
  });
});
