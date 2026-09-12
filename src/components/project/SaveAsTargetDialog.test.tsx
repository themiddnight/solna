import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SAVE_AS_DRIVE, SAVE_AS_THIS_DEVICE, SAVE_AS_TITLE, SaveAsTargetDialog } from './SaveAsTargetDialog';

describe('SaveAsTargetDialog', () => {
  test('offers this device always, and Drive only when the deployment has it', () => {
    const full = renderToString(
      <SaveAsTargetDialog open driveAvailable onClose={() => {}} onLocal={() => {}} onDrive={() => {}} />,
    );
    expect(full).toContain(SAVE_AS_THIS_DEVICE);
    expect(full).toContain(SAVE_AS_DRIVE);

    const bare = renderToString(
      <SaveAsTargetDialog open={false} driveAvailable={false} onClose={() => {}} onLocal={() => {}} onDrive={() => {}} />,
    );
    // No client id means no Drive row at all — not a disabled one, which would
    // advertise a target that can never work on this deployment.
    expect(bare).toContain(SAVE_AS_THIS_DEVICE);
    expect(bare).not.toContain(SAVE_AS_DRIVE);
  });

  test('the copy names the dialog and its two targets', () => {
    expect(SAVE_AS_TITLE).toBe('Save as');
    expect(SAVE_AS_THIS_DEVICE).toBe('This device');
    expect(SAVE_AS_DRIVE).toBe('Google Drive');
  });

  test('renders through the shared modal chrome', () => {
    const html = renderToString(
      <SaveAsTargetDialog open driveAvailable onClose={() => {}} onLocal={() => {}} onDrive={() => {}} />,
    );
    expect(html).toContain('modal-box bg-base-100 border border-base-300 shadow-2xl max-w-sm space-y-3');
  });
});
