import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { EXPORT_KINDS } from '@/store/exportKinds';
import { ExportDialog } from './ExportDialog';
import type { ExportStatusView } from './useExportDialog';

function render(busy: boolean, status: ExportStatusView | null): string {
  return renderToString(
    <ExportDialog open onClose={() => {}} kinds={EXPORT_KINDS} busy={busy} status={status}
      onStart={() => {}} onCancel={() => {}} />,
  );
}

describe('ExportDialog', () => {
  test('idle: one enabled row per kind and no status', () => {
    const html = render(false, null);
    expect(html).toContain('Export</h3>');
    expect(html).toContain('<button id="btn-export-mixdown-wav" type="button" class="btn btn-sm btn-outline justify-start">Export mixdown (WAV)</button>');
    expect(html).toContain('<button id="btn-export-midi" type="button" class="btn btn-sm btn-outline justify-start">Export MIDI (.mid)</button>');
    expect(html).not.toContain('id="export-status"');
  });

  test('busy: rows are disabled and the status is live', () => {
    const html = render(true, { label: 'Rendering mixdown… 35%', percent: 35, canCancel: true });
    expect(html).toContain('<button id="btn-export-mixdown-wav" type="button" class="btn btn-sm btn-outline justify-start" disabled="">');
    expect(html).toContain('<button id="btn-export-midi" type="button" class="btn btn-sm btn-outline justify-start" disabled="">');
    expect(html).toContain('id="export-status" role="status" aria-live="polite"');
    expect(html).toContain('Rendering mixdown… 35%');
    expect(html).toContain('class="progress progress-primary w-full" value="35" max="100"');
    expect(html).toContain('id="btn-cancel-export"');
    expect(html).toContain('Cancel export');
  });

  test('an indeterminate phase has a progress bar without a value', () => {
    const html = render(true, { label: 'Downloading…', percent: null, canCancel: true });
    expect(html).toContain('<progress class="progress w-full"');
    expect(html).not.toContain('value="');
  });

  test('while cancellation drains there is no second Cancel', () => {
    const html = render(true, { label: 'Cancelling…', percent: null, canCancel: false });
    expect(html).toContain('Cancelling…');
    expect(html).not.toContain('id="btn-cancel-export"');
  });

  test('advertises no kind this build cannot export', () => {
    const html = render(false, null);
    expect(html).not.toContain('stem');
    expect(html).not.toContain('Stem');
    expect(html).not.toContain('coming soon');
  });
});
