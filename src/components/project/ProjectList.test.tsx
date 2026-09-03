import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProjectList } from './ProjectList';
import { makeEnvelope } from '../../store/projectFormat';

const noop = () => {};
const NOW = 1_700_000_000_000;
const a = { ...makeEnvelope('Alpha', NOW - 120_000), id: 'a' };
const b = { ...makeEnvelope('Beta', NOW - 90_000_000), id: 'b' };

describe('ProjectList', () => {
  test('empty state points at Save and never renders a row', () => {
    const html = renderToString(<ProjectList projects={[]} currentProjectId={null} now={NOW} disabled={false} onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html).toContain('not yet a project');
    expect(html).toContain('Save');
    expect(html).not.toContain('btn btn-sm btn-primary');
  });

  test('the disabled empty state points at Import / Export instead of the disabled Save', () => {
    const html = renderToString(<ProjectList projects={[]} currentProjectId={null} now={NOW} disabled onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html).toContain('cannot store projects');
    expect(html).toContain('Import');
    expect(html).toContain('Export current session');
    expect(html).not.toContain('not yet a project');
  });

  test('a row shows the name, the relative time with an absolute title, Open, and a kebab with Export and Delete', () => {
    const html = renderToString(<ProjectList projects={[a, b]} currentProjectId="a" now={NOW} disabled={false} onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html).toContain('Alpha');
    expect(html).toContain('2 minutes ago');
    expect(html).toContain(`title="${new Date(a.updatedAt).toLocaleString()}"`);
    expect(html).toContain('badge badge-sm badge-primary');
    expect(html).toContain('>Current<');
    expect(html).toContain('dropdown dropdown-end');
    expect(html).toContain('dropdown-content menu');
    expect(html).toContain('>Export<');
    expect(html).toContain('>Delete<');
    expect(html).toContain('aria-label="More actions for Alpha"');
  });

  test('the Current badge is only on the matching row', () => {
    const html = renderToString(<ProjectList projects={[a, b]} currentProjectId="b" now={NOW} disabled={false} onOpen={noop} onRename={noop} onExport={noop} onDelete={noop} />);
    expect(html.split('>Current<').length - 1).toBe(1);
  });
});
