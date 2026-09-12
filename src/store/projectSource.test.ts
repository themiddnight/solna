import { describe, expect, test } from 'bun:test';
import {
  UNTITLED_SOURCE,
  envelopeForSave,
  envelopeForSaveAs,
  newDocumentIdentity,
  sanitizeProjectSource,
  sanitizeSlotRecord,
  saveTarget,
  type ProjectSlotRecord,
} from './projectSource';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';

const body = (name: string, now = 1_000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });
const alpha = body('Alpha');
const fakeHandle = { name: 'sketch.solna', kind: 'file' } as unknown as FileSystemFileHandle;

describe('saveTarget', () => {
  test('an untitled project has no target, so Save behaves as Save As', () => {
    expect(saveTarget(UNTITLED_SOURCE)).toEqual({ kind: 'save-as' });
  });

  test('a drive source carries the file id it updates', () => {
    expect(saveTarget({ kind: 'drive', fileId: 'abc' })).toEqual({ kind: 'drive-update', fileId: 'abc' });
  });

  test('a local source carries the handle it writes through', () => {
    expect(saveTarget({ kind: 'local', handle: fakeHandle })).toEqual({ kind: 'local-write', handle: fakeHandle });
  });
});

describe('the envelope transitions', () => {
  test('Save keeps the document identity and only moves updatedAt', () => {
    expect(envelopeForSave({ id: 'project-1', createdAt: 500 }, 'Sketch', 900)).toEqual({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: 'project-1',
      name: 'Sketch',
      createdAt: 500,
      updatedAt: 900,
    });
  });

  test('Save As mints a fresh id and sets createdAt = updatedAt = now', () => {
    const identity = newDocumentIdentity(700);
    expect(identity.createdAt).toBe(700);
    expect(identity.id.startsWith('project-')).toBe(true);
    expect(identity.id).not.toBe(newDocumentIdentity(700).id);
    expect(envelopeForSaveAs(identity, 'Copy')).toEqual({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: identity.id,
      name: 'Copy',
      createdAt: 700,
      updatedAt: 700,
    });
  });
});

describe('sanitizeProjectSource', () => {
  test('anything unreadable is untitled rather than a broken source', () => {
    expect(sanitizeProjectSource(undefined)).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource('drive')).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'nope' })).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'drive' })).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'drive', fileId: '' })).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'local', handle: null })).toEqual({ kind: 'untitled' });
  });

  test('a drive id and a handle object both survive', () => {
    expect(sanitizeProjectSource({ kind: 'drive', fileId: 'abc' })).toEqual({ kind: 'drive', fileId: 'abc' });
    expect(sanitizeProjectSource({ kind: 'local', handle: fakeHandle })).toEqual({ kind: 'local', handle: fakeHandle });
  });
});

describe('sanitizeSlotRecord', () => {
  test('a slot record round-trips with its source', () => {
    const record: ProjectSlotRecord = { body: alpha, source: { kind: 'drive', fileId: 'abc' } };
    expect(sanitizeSlotRecord(record)).toEqual(record);
  });

  test('a bare body written before sources existed widens to untitled — no version gate', () => {
    const bare = { ...alpha, formatVersion: 1 };
    expect(sanitizeSlotRecord(bare)).toEqual({ body: bare, source: { kind: 'untitled' } });
  });

  test('an unreadable slot is null, never a half-record', () => {
    expect(sanitizeSlotRecord(undefined)).toBeNull();
    expect(sanitizeSlotRecord('nope')).toBeNull();
    expect(sanitizeSlotRecord({ source: { kind: 'untitled' } })).toBeNull();
  });

  test('a record whose body is not a body is null — the guard is the same on both branches', () => {
    // The trap this pins: recognising a record by `typeof raw.body === 'object'`
    // alone accepts `{ body: {} }`, and an envelope-less body reaches
    // normalizeName(undefined) at install time and throws. A bare body has to
    // carry the envelope keys to be recognised, so a wrapped one does too.
    expect(sanitizeSlotRecord({ body: {}, source: { kind: 'untitled' } })).toBeNull();
    expect(sanitizeSlotRecord({ body: { formatVersion: 1 } })).toBeNull();
  });

  test('a record whose source is unreadable keeps its body and falls back to untitled', () => {
    expect(sanitizeSlotRecord({ body: alpha, source: { kind: 'drive' } })).toEqual({
      body: alpha,
      source: { kind: 'untitled' },
    });
  });
});
