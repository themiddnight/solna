import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import type { FeedbackEntry } from '@/store/feedback';
import { FeedbackHost, feedbackEntryKey } from './FeedbackHost';

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
  test('renders both empty live regions, so the first message of either kind is announced', () => {
    const html = renderToString(<FeedbackHost edge="bottom" />);
    expect(html).toContain('id="feedback-host" role="status" aria-live="polite"');
    expect(html).toContain('id="feedback-host-errors" role="alert" aria-live="assertive"');
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

  test('an error entry renders inside the assertive alert region, not the polite status one', () => {
    useAppStore.setState({ feedback: [entry({ key: 'drive', tone: 'error', message: 'Drive failed' })] });
    const html = renderToString(<FeedbackHost edge="top" />);
    const statusStart = html.indexOf('id="feedback-host"');
    const errorsStart = html.indexOf('id="feedback-host-errors"');
    expect(html).toContain('alert alert-soft alert-error');
    // The errors region opens after the status region and holds the message,
    // so the two are siblings and the entry sits only in the assertive one.
    expect(errorsStart).toBeGreaterThan(statusStart);
    expect(html.indexOf('Drive failed')).toBeGreaterThan(errorsStart);
  });

  test('an error entry never doubles up with a role="alert" on the item itself', () => {
    useAppStore.setState({ feedback: [entry({ key: 'drive', tone: 'error', message: 'Drive failed' })] });
    const html = renderToString(<FeedbackHost edge="top" />);
    // Only the region carries role="alert"; the item itself carries none, so
    // a screen reader announces the entry once, from the region alone.
    expect(html.match(/role="alert"/g)?.length).toBe(1);
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

  describe('feedbackEntryKey', () => {
    test('folds seq into the key, so a replacement under the same key differs', () => {
      expect(feedbackEntryKey({ key: 'drive', seq: 1 })).toBe('drive:1');
      expect(feedbackEntryKey({ key: 'drive', seq: 2 })).not.toBe(feedbackEntryKey({ key: 'drive', seq: 1 }));
    });

    test('two different keys at the same seq never collide', () => {
      expect(feedbackEntryKey({ key: 'drive', seq: 1 })).not.toBe(feedbackEntryKey({ key: 'vibe', seq: 1 }));
    });
  });
});
