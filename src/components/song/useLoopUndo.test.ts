import { describe, expect, test } from 'bun:test';
import { buildLoopUndoRequest } from './useLoopUndo';

describe('buildLoopUndoRequest', () => {
  test('run restores the exact payload it was built with, not a later offer', () => {
    const restored: string[] = [];
    const restore = (payload: string) => restored.push(payload);
    const messageOf = (payload: string) => `undo ${payload}`;

    const first = buildLoopUndoRequest(restore, 'btn-undo-loop-delete', messageOf, 'a');
    const second = buildLoopUndoRequest(restore, 'btn-undo-loop-delete', messageOf, 'b');

    // Running the OLDER request after a newer one was built must still
    // restore what it closed over — never whatever the newer offer holds.
    first.action?.run();
    expect(restored).toEqual(['a']);

    second.action?.run();
    expect(restored).toEqual(['a', 'b']);
  });

  test('carries key as both the feedback key and the action id, and the message from messageOf', () => {
    const request = buildLoopUndoRequest<number>(() => {}, 'btn-undo-key-change', (n) => `n=${n}`, 3);

    expect(request.key).toBe('btn-undo-key-change');
    expect(request.action?.id).toBe('btn-undo-key-change');
    expect(request.action?.label).toBe('Undo');
    expect(request.message).toBe('n=3');
    expect(request.tone).toBe('info');
  });
});
