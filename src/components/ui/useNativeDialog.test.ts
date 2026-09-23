import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useAppStore } from '@/store/store';
import { escapeClosesNonModal, holdFeedbackWhile } from './useNativeDialog';

afterEach(() => {
  useAppStore.setState({ feedbackHolds: 0, feedback: [] });
});

describe("a dialog's feedback hold", () => {
  test('an open dialog holds, and the cleanup releases', () => {
    const release = holdFeedbackWhile(true);
    expect(useAppStore.getState().feedbackHolds).toBe(1);
    release?.();
    expect(useAppStore.getState().feedbackHolds).toBe(0);
  });

  test('a closed dialog takes no hold', () => {
    expect(holdFeedbackWhile(false)).toBeUndefined();
    expect(useAppStore.getState().feedbackHolds).toBe(0);
  });

  test('an open non-modal dialog takes no hold (R326): nothing behind it is covered', () => {
    expect(holdFeedbackWhile(true, false)).toBeUndefined();
    expect(useAppStore.getState().feedbackHolds).toBe(0);
  });

  test('releasing twice (close, then unmount) releases once', () => {
    const outer = holdFeedbackWhile(true);
    const inner = holdFeedbackWhile(true);
    inner?.();
    inner?.();
    expect(useAppStore.getState().feedbackHolds).toBe(1);
    outer?.();
    expect(useAppStore.getState().feedbackHolds).toBe(0);
  });
});

describe('Escape on an open non-modal dialog', () => {
  const key = (k: string, defaultPrevented = false) => ({ key: k, defaultPrevented });

  test('closes it', () => {
    expect(escapeClosesNonModal(key('Escape'), false)).toBe(true);
  });

  test('ignores every other key', () => {
    expect(escapeClosesNonModal(key('Enter'), false)).toBe(false);
    expect(escapeClosesNonModal(key(' '), false)).toBe(false);
  });

  test('yields to a modal dialog open above it: that Escape is the modal’s own close request', () => {
    expect(escapeClosesNonModal(key('Escape'), true)).toBe(false);
  });

  test('ignores an Escape another handler already consumed', () => {
    expect(escapeClosesNonModal(key('Escape', true), false)).toBe(false);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('useNativeDialog is the only component code that takes a feedback hold (R330)', () => {
  const holders = sourceFiles('src/components').filter((path) =>
    readFileSync(path, 'utf8').includes('holdFeedback('),
  );
  expect(holders).toEqual(['src/components/ui/useNativeDialog.ts']);
});
