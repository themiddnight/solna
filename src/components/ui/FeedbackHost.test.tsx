import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import type { FeedbackEntry } from '@/store/feedback';
import { FeedbackHost } from './FeedbackHost';

afterEach(() => {
  useAppStore.setState({ feedback: [] });
});

const entry = (extra: Partial<FeedbackEntry> & Pick<FeedbackEntry, 'key'>): FeedbackEntry => ({
  seq: 1,
  message: 'Saved',
  tone: 'success',
  ...extra,
});

describe('FeedbackHost', () => {
  test('renders an empty live region, so the first message is announced', () => {
    const html = renderToString(<FeedbackHost edge="bottom" />);
    expect(html).toContain('id="feedback-host" role="status" aria-live="polite"');
    expect(html).not.toContain('alert');
  });

  test('sits in a zero-height slot above drawers (R331)', () => {
    const html = renderToString(<FeedbackHost edge="bottom" />);
    expect(html).toContain('class="relative z-55 h-0 shrink-0"');
  });

  test('each tone wears its soft alert colour', () => {
    useAppStore.setState({
      feedback: [
        entry({ key: 'a', tone: 'info' }),
        entry({ key: 'b', tone: 'success' }),
        entry({ key: 'c', tone: 'warning' }),
      ],
    });
    const html = renderToString(<FeedbackHost edge="bottom" />);
    for (const tone of ['info', 'success', 'warning']) {
      expect(html).toContain(`alert alert-soft alert-${tone} `);
    }
  });

  test('an error entry is also an alert region', () => {
    useAppStore.setState({ feedback: [entry({ key: 'drive', tone: 'error', message: 'Drive failed' })] });
    const html = renderToString(<FeedbackHost edge="top" />);
    expect(html).toContain('role="alert" class="alert alert-soft alert-error');
    expect(html).toContain('Drive failed');
  });

  test('a detail line renders under the message', () => {
    useAppStore.setState({ feedback: [entry({ key: 'vibe', message: 'Rerolled', detail: 'drums: boom-bap' })] });
    const html = renderToString(<FeedbackHost edge="bottom" />);
    expect(html.indexOf('Rerolled')).toBeLessThan(html.indexOf('drums: boom-bap'));
  });

  test("a snackbar's action is a small button carrying the action's id", () => {
    useAppStore.setState({
      feedback: [
        entry({
          key: 'loop-delete',
          tone: 'info',
          message: 'Deleted loop',
          action: { id: 'btn-undo-loop-delete', label: 'Undo', run: () => {} },
        }),
      ],
    });
    const html = renderToString(<FeedbackHost edge="bottom" />);
    expect(html).toContain('id="btn-undo-loop-delete" type="button" class="btn btn-xs"');
    expect(html).toContain('>Undo</button>');
  });

  test('a toast carries no button', () => {
    useAppStore.setState({ feedback: [entry({ key: 'vibe' })] });
    expect(renderToString(<FeedbackHost edge="bottom" />)).not.toContain('<button');
  });

  test('newest sits nearest the edge on both frames', () => {
    const bottom = renderToString(<FeedbackHost edge="bottom" />);
    const top = renderToString(<FeedbackHost edge="top" />);
    expect(bottom).toContain('bottom-10 flex-col ');
    expect(top).toContain('top-2 flex-col-reverse ');
  });

  test('never uses the fixed daisyUI toast class', () => {
    useAppStore.setState({ feedback: [entry({ key: 'vibe' })] });
    const html = renderToString(<FeedbackHost edge="bottom" />);
    expect(html).not.toMatch(/class="[^"]*\btoast\b/);
    expect(html).not.toContain('fixed');
  });
});
