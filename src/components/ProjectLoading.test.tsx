import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ProjectLoading, PROJECT_LOADING_LABEL } from './ProjectLoading';

describe('ProjectLoading', () => {
  test('announces itself as a polite status region with the loading spinner', () => {
    const html = renderToString(<ProjectLoading />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('loading loading-spinner loading-lg text-primary');
    expect(html).toContain(PROJECT_LOADING_LABEL);
  });

  test('takes a custom label for a save or open in flight', () => {
    const html = renderToString(<ProjectLoading label="Saving to Drive…" />);
    expect(html).toContain('Saving to Drive…');
    expect(html).not.toContain(PROJECT_LOADING_LABEL);
  });

  test('the overlay variant pins over the workspace instead of replacing it', () => {
    const html = renderToString(<ProjectLoading overlay />);
    expect(html).toContain('fixed inset-0');
    expect(html).not.toContain('h-dvh');
  });
});
