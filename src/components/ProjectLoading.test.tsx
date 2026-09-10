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
});
