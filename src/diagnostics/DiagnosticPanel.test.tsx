import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import DiagnosticPanel from './DiagnosticPanel';

describe('DiagnosticPanel', () => {
  test('renders explicit controls without starting the recorder or opening IndexedDB', () => {
    const html = renderToString(<DiagnosticPanel open onClose={() => {}} />);
    expect(html).toContain('Performance diagnostics');
    expect(html).toContain('Start');
    expect(html).toContain('Recover latest');
    expect(html).toContain('Share JSON');
    expect(html).toContain('Recorder: <!-- -->idle');
  });
});
