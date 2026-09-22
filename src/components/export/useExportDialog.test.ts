import { describe, expect, test } from 'bun:test';
import type { ExportJob } from '@/store/exportJob';
import {
  closesDialogAfter,
  exportProgressLabel,
  exportStatusView,
  exportTriggerView,
} from './useExportDialog';

const job = (phase: ExportJob): ExportJob => phase;

describe('exportProgressLabel keeps every existing string', () => {
  test.each([
    [job({ kind: 'mixdown-wav', phase: 'preparing' }), 'Preparing arrangement…'],
    [job({ kind: 'mixdown-wav', phase: 'rendering', percent: 35 }), 'Rendering mixdown… 35%'],
    [job({ kind: 'mixdown-wav', phase: 'encoding' }), 'Encoding WAV…'],
    [job({ kind: 'mixdown-wav', phase: 'cancelling' }), 'Cancelling…'],
    [job({ kind: 'mixdown-wav', phase: 'downloading' }), 'Downloading…'],
  ])('%o → %s', (input, label) => {
    expect(exportProgressLabel(input)).toBe(label);
  });
});

describe('exportStatusView', () => {
  test('idle has no status', () => {
    expect(exportStatusView(null)).toBeNull();
  });

  test('rendering carries its percent and can be cancelled', () => {
    expect(exportStatusView({ kind: 'mixdown-wav', phase: 'rendering', percent: 35 })).toEqual({
      label: 'Rendering mixdown… 35%',
      percent: 35,
      canCancel: true,
    });
  });

  test('other phases are indeterminate', () => {
    expect(exportStatusView({ kind: 'mixdown-wav', phase: 'downloading' })?.percent).toBeNull();
  });

  test('cancelling cannot be cancelled twice', () => {
    expect(exportStatusView({ kind: 'mixdown-wav', phase: 'cancelling' })?.canCancel).toBe(false);
  });
});

describe('exportTriggerView', () => {
  test('idle reads Export', () => {
    expect(exportTriggerView(null)).toEqual({ busy: false, text: 'Export', ariaLabel: 'Export' });
  });

  test('rendering shows the percent and names the phase for assistive tech', () => {
    expect(exportTriggerView({ kind: 'mixdown-wav', phase: 'rendering', percent: 35 })).toEqual({
      busy: true,
      text: '35%',
      ariaLabel: 'Rendering mixdown… 35%',
    });
  });

  test('other busy phases show only the spinner', () => {
    expect(exportTriggerView({ kind: 'mixdown-wav', phase: 'encoding' })).toEqual({
      busy: true,
      text: null,
      ariaLabel: 'Encoding WAV…',
    });
  });
});

describe('closesDialogAfter', () => {
  test('only a finished download closes the dialog', () => {
    expect(closesDialogAfter({ status: 'downloaded', fileName: 'a.wav' })).toBe(true);
    expect(closesDialogAfter({ status: 'download-failed', fileName: 'a.wav' })).toBe(false);
    expect(closesDialogAfter({ status: 'failed', reason: { kind: 'empty-arrangement' } })).toBe(false);
    expect(closesDialogAfter({ status: 'cancelled' })).toBe(false);
    expect(closesDialogAfter({ status: 'ignored' })).toBe(false);
  });
});
