import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useAppStore } from '@/store/store';
import { holdFeedbackWhile } from './useNativeDialog';

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
