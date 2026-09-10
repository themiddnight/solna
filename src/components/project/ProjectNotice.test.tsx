import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ProjectNotice } from './ProjectNotice';
import { useAppStore } from '@/store/store';

// The component reads through useLiveStore, so a test's setState IS reflected
// under renderToString — the getServerSnapshot trap does not apply here (see
// .claude/rules/testing.md and ui/useLiveStore.ts).
describe('ProjectNotice', () => {
  const initial = useAppStore.getState().projectNotice;
  afterEach(() => {
    useAppStore.setState({ projectNotice: initial });
  });

  test('renders nothing at all when there is no notice', () => {
    useAppStore.setState({ projectNotice: null });
    expect(renderToString(<ProjectNotice />)).toBe('');
  });

  test('renders the message as a status, with the dismiss control', () => {
    useAppStore.setState({ projectNotice: 'This file is not a Solna project.' });
    const html = renderToString(<ProjectNotice />);
    expect(html).toContain('role="status"');
    expect(html).toContain('This file is not a Solna project.');
    expect(html).toContain('id="btn-dismiss-project-notice"');
    expect(html).toContain('aria-label="Dismiss project notice"');
  });

  // There is no DOM in this suite, so the click itself cannot be dispatched —
  // what is pinned is the path the button takes: the store field is the single
  // source, clearing it is the whole of the dismiss, and the surface goes with
  // it. Both halves are asserted rather than the class name of a handler.
  test('the dismiss clears the store field the surface renders from', () => {
    useAppStore.setState({ projectNotice: 'Could not write the file.' });
    expect(renderToString(<ProjectNotice />)).toContain('Could not write the file.');

    useAppStore.getState().setProjectNotice(null);

    expect(useAppStore.getState().projectNotice).toBeNull();
    expect(renderToString(<ProjectNotice />)).toBe('');
  });
});
