import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LoopUndoToast } from './LoopUndoToast';

describe('LoopUndoToast', () => {
  test('names the deleted loop and offers an Undo button', () => {
    const html = renderToString(
      <LoopUndoToast message="Loop 2 deleted" buttonId="btn-undo-loop-delete" onUndo={() => {}} />
    );
    expect(html).toContain('id="btn-undo-loop-delete"');
    expect(html).toContain('Loop 2 deleted');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('toast toast-bottom'); // the container belongs to ArrangeView now
  });

  test('uses theme tokens only — no raw colour literals', () => {
    const html = renderToString(
      <LoopUndoToast message="Loop 2 deleted" buttonId="btn-undo-loop-delete" onUndo={() => {}} />
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});
