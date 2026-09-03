import { beforeAll, describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';

let ProjectManagerModal: React.FC;
let useAppStore: typeof import('../../store/store').useAppStore;

/** The full opening tag of the element whose markup contains `needle` — pins disabled/attrs, not text position. */
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  ({ useAppStore } = await import('../../store/store'));
  ({ ProjectManagerModal } = await import('./ProjectManagerModal'));
});

describe('ProjectManagerModal', () => {
  test('renders nothing while closed', () => {
    useAppStore.setState({ isProjectManagerOpen: false });
    expect(renderToString(<ProjectManagerModal />)).toBe('');
  });

  test('an unsaved session shows the label, Save, Save as new copy, New, Import and Export current session', () => {
    useAppStore.setState({ isProjectManagerOpen: true, currentProjectId: null, currentProjectName: null, dirty: false, projectStoreStatus: 'ready', projectList: [] });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('<dialog class="modal modal-open"');
    expect(html).toContain('Unsaved session');
    expect(html).toContain('>Save<');
    expect(html).toContain('>Save as new copy<');
    expect(html).toContain('>New<');
    expect(html).toContain('accept=".solna,.json"');
    expect(html).toContain('>Export current session<');
    expect(html).toContain('<form class="modal-backdrop" method="dialog"');
  });

  test('a dirty named project shows the name and the unsaved marker', () => {
    useAppStore.setState({ isProjectManagerOpen: true, currentProjectId: 'p', currentProjectName: 'Alpha', dirty: true, projectStoreStatus: 'ready' });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('Alpha');
    expect(html).toContain('Unsaved changes');
  });

  test('storage unavailable: notice shown, Save disabled with a tooltip, list disabled, import and export still enabled', () => {
    useAppStore.setState({ isProjectManagerOpen: true, currentProjectId: 'p', currentProjectName: null, projectStoreStatus: 'unavailable', projectList: [] });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('Unnamed project');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Project storage is unavailable');
    expect(html).toContain('data-tip="Export the session to keep your work"');
    expect(openTagContaining(html, 'btn-primary gap-1')).toContain('disabled=""');
    expect(openTagContaining(html, 'id="project-import-button"')).not.toContain('disabled');
    expect(openTagContaining(html, 'id="project-export-session"')).not.toContain('disabled');
  });

  test('a notice (e.g. an import warning) stays visible and non-blocking while the modal is open', () => {
    useAppStore.setState({
      isProjectManagerOpen: true,
      currentProjectId: 'p',
      currentProjectName: 'Alpha',
      projectStoreStatus: 'ready',
      projectList: [],
      projectNotice: 'Imported with unrecognised references: bass pattern "x"',
    });
    const html = renderToString(<ProjectManagerModal />);
    expect(html).toContain('<dialog class="modal modal-open"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Imported with unrecognised references: bass pattern &quot;x&quot;');
  });
});
