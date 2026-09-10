import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ErrorBoundary, ErrorFallback, ERROR_TITLE } from './ErrorBoundary';

const noop = () => {};

/** React logs a caught render error to console.error; keep the run readable. */
let consoleError: ReturnType<typeof spyOn>;
beforeEach(() => {
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorFallback', () => {
  test('renders the title, the message and both actions', () => {
    const html = renderToString(
      <ErrorFallback message="kaboom" stack={'Error: kaboom\n  at Boom'} componentStack="\n  in Boom" showDetails={false} onRetry={noop} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(ERROR_TITLE);
    expect(html).toContain('kaboom');
    expect(html).toContain('>Retry<');
    expect(html).toContain('>Refresh<');
  });

  test('does not promise persistence when storage may be unavailable', () => {
    const html = renderToString(
      <ErrorFallback message="kaboom" stack={null} componentStack={null} showDetails={false} onRetry={noop} />
    );
    expect(html).not.toContain('nothing has been lost');
    expect(html).toContain('Refreshing may lose changes that have not been saved.');
  });

  test('offers no way to delete the project — the single slot is the user’s only copy', () => {
    const html = renderToString(
      <ErrorFallback message="kaboom" stack={null} componentStack={null} showDetails onRetry={noop} />
    );
    expect(html.toLowerCase()).not.toContain('clear storage');
    expect(html.toLowerCase()).not.toContain('delete');
    expect(html.toLowerCase()).not.toContain('reset storage');
  });

  test('the error detail block is DEV-only', () => {
    const dev = renderToString(
      <ErrorFallback message="kaboom" stack="Error: kaboom" componentStack="\n  in Boom" showDetails onRetry={noop} />
    );
    expect(dev).toContain('<details');
    expect(dev).toContain('in Boom');

    const prod = renderToString(
      <ErrorFallback message="kaboom" stack="Error: kaboom" componentStack="\n  in Boom" showDetails={false} onRetry={noop} />
    );
    expect(prod).not.toContain('<details');
    expect(prod).not.toContain('in Boom');
  });
});

describe('ErrorBoundary', () => {
  test('a healthy tree renders its children untouched', () => {
    const html = renderToString(
      <ErrorBoundary showDetails={false}>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(html).toContain('<p>all good</p>');
    expect(html).not.toContain(ERROR_TITLE);
  });

  /**
   * The throwing-child test cannot be written against `renderToString`: React's
   * SERVER renderers implement no error-boundary recovery at all (there is no
   * `componentDidCatch` call site in any `react-dom-server-*` build), so a child
   * that throws is rethrown out of `renderToString` rather than caught. The
   * class contract is asserted directly instead — no DOM, no testing-library.
   */
  test('getDerivedStateFromError moves the boundary into its fallback', () => {
    const boundary = new ErrorBoundary({ children: <p>all good</p>, showDetails: false });
    expect(renderToString(boundary.render() as React.ReactElement)).toContain('<p>all good</p>');

    // What React itself does on a render error: merge the derived state, re-render.
    boundary.state = {
      ...boundary.state,
      ...ErrorBoundary.getDerivedStateFromError(new Error('kaboom')),
    };
    const html = renderToString(boundary.render() as React.ReactElement);
    expect(html).toContain(ERROR_TITLE);
    expect(html).toContain('kaboom');
    expect(html).toContain('>Retry<');
  });
});
