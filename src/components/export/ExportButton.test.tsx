import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { ExportButton } from './ExportButton';

describe('ExportButton', () => {
  afterEach(() => {
    useAppStore.setState({ exportJob: null });
  });

  test('the song layer shows the Export trigger and its dialog', () => {
    const html = renderToString(<ExportButton />);
    expect(html).toContain('id="btn-export"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Export"');
    expect(html).toContain('id="btn-export-mixdown-wav"');
    expect(html).toContain('Export mixdown (WAV)');
  });

  test('a running job shows spinner and percent, and the trigger stays clickable', () => {
    useAppStore.setState({ exportJob: { kind: 'mixdown-wav', phase: 'rendering', percent: 35 } });
    const html = renderToString(<ExportButton />);
    expect(html).toContain('loading loading-spinner loading-sm');
    expect(html).toContain('>35%<');
    expect(html).toContain('aria-label="Rendering mixdown… 35%"');
    expect(html).toMatch(/<button id="btn-export"[^>]*aria-busy="true"/);
    expect(html).not.toMatch(/<button id="btn-export"[^>]*disabled/);
    // Reopening shows the job: status and Cancel are in the dialog.
    expect(html).toContain('id="export-status"');
    expect(html).toContain('id="btn-cancel-export"');
  });

  test('a busy job disables the dialog rows', () => {
    useAppStore.setState({ exportJob: { kind: 'mixdown-wav', phase: 'downloading' } });
    const html = renderToString(<ExportButton />);
    expect(html).toMatch(/<button id="btn-export-mixdown-wav"[^>]*disabled=""/);
    expect(html).toContain('Downloading…');
  });
});
