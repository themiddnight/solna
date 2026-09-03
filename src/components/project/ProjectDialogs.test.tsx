import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DeleteConfirmDialog, DirtyGuardDialog, ImportConflictDialog, NamePromptDialog } from './ProjectDialogs';
import { makeEnvelope } from '../../store/projectFormat';

const noop = () => {};

describe('DirtyGuardDialog', () => {
  test('pins the verbatim copy: Discard, Cancel, Save & Continue', () => {
    const html = renderToString(<DirtyGuardDialog onDiscard={noop} onCancel={noop} onSaveAndContinue={noop} />);
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('>Discard<');
    expect(html).toContain('>Cancel<');
    expect(html).toContain('Save &amp; Continue');
  });
});

describe('DeleteConfirmDialog', () => {
  test('pins the title and the project name', () => {
    const html = renderToString(<DeleteConfirmDialog name="Alpha" onConfirm={noop} onCancel={noop} />);
    expect(html).toContain('Delete project');
    expect(html).toContain('<strong>Alpha</strong>');
    expect(html).toContain('>Cancel<');
    expect(html).toContain('>Delete<');
  });
});

describe('ImportConflictDialog', () => {
  test('pins the verbatim copy: Overwrite, Import as Copy, Cancel', () => {
    const existing = { ...makeEnvelope('Mine', 1000), id: 'p' };
    const incoming = { ...makeEnvelope('Theirs', 2000), id: 'p' };
    const html = renderToString(<ImportConflictDialog existing={existing} incoming={incoming} onOverwrite={noop} onCopy={noop} onCancel={noop} />);
    expect(html).toContain('Import project');
    expect(html).toContain('>Overwrite<');
    expect(html).toContain('>Import as Copy<');
    expect(html).toContain('>Cancel<');
  });
});

describe('NamePromptDialog', () => {
  test('pins the title and confirm label', () => {
    const html = renderToString(<NamePromptDialog title="Save project" initial="Untitled project" confirmLabel="Save" onConfirm={noop} onCancel={noop} />);
    expect(html).toContain('Save project');
    expect(html).toContain('>Save<');
    expect(html).toContain('>Cancel<');
    expect(html).toContain('value="Untitled project"');
  });
});
