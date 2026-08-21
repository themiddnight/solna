import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiChatSession } from '../useAiChatSession';
import type { AiNote } from '@/shared/api/aiGeneration';

const NOTES_A: AiNote[] = [{ pitch: 60, start: 0, duration: 1, velocity: 100 }];
const NOTES_B: AiNote[] = [
  { pitch: 60, start: 0, duration: 1, velocity: 100 },
  { pitch: 64, start: 1, duration: 1, velocity: 100 },
];

describe('useAiChatSession', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useAiChatSession());
    expect(result.current.turns).toEqual([]);
    expect(result.current.historyForApi()).toEqual([]);
  });

  it('historyForApi(1) returns only the last turn pair after two turns', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      result.current.addTurn('add a bassline', 'Added a bassline', NOTES_A);
    });
    act(() => {
      result.current.addTurn('add a melody', 'Added a melody on top', NOTES_B);
    });

    expect(result.current.turns).toHaveLength(2);
    expect(result.current.historyForApi(1)).toEqual([
      { role: 'user', content: 'add a melody' },
      { role: 'model', content: 'Added a melody on top' },
    ]);
  });

  it('peekSnapshot returns the target snapshot without mutating turns', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      result.current.addTurn('add a bassline', 'Added a bassline', NOTES_A);
    });
    const firstTurnId = result.current.turns[0]?.id;
    expect(firstTurnId).toBeDefined();

    act(() => {
      result.current.addTurn('add a melody', 'Added a melody on top', NOTES_B);
    });
    expect(result.current.turns).toHaveLength(2);

    const turnsBeforePeek = result.current.turns;
    let peeked: AiNote[] | null = null;
    act(() => {
      peeked = result.current.peekSnapshot(firstTurnId as string);
    });

    expect(peeked).toEqual(NOTES_A);
    // No dispatch happened — same array reference, still 2 turns.
    expect(result.current.turns).toBe(turnsBeforePeek);
    expect(result.current.turns).toHaveLength(2);
  });

  it('peekSnapshot returns null for an unknown turn id', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      result.current.addTurn('add a bassline', 'Added a bassline', NOTES_A);
    });

    let peeked: AiNote[] | null = null;
    act(() => {
      peeked = result.current.peekSnapshot('not-a-real-id');
    });

    expect(peeked).toBeNull();
    expect(result.current.turns).toHaveLength(1);
  });

  it('commitRewind truncates turns after the target turn', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      result.current.addTurn('add a bassline', 'Added a bassline', NOTES_A);
    });
    const firstTurnId = result.current.turns[0]?.id;
    expect(firstTurnId).toBeDefined();

    act(() => {
      result.current.addTurn('add a melody', 'Added a melody on top', NOTES_B);
    });
    expect(result.current.turns).toHaveLength(2);

    act(() => {
      result.current.commitRewind(firstTurnId as string);
    });

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.id).toBe(firstTurnId);
  });

  it('commitRewind is a no-op for an unknown turn id', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      result.current.addTurn('add a bassline', 'Added a bassline', NOTES_A);
    });

    act(() => {
      result.current.commitRewind('not-a-real-id');
    });

    expect(result.current.turns).toHaveLength(1);
  });

  it('reset clears all turns', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      result.current.addTurn('add a bassline', 'Added a bassline', NOTES_A);
      result.current.addTurn('add a melody', 'Added a melody on top', NOTES_B);
    });
    expect(result.current.turns).toHaveLength(2);

    act(() => {
      result.current.reset();
    });

    expect(result.current.turns).toEqual([]);
  });

  it('historyForApi defaults to a cap of 8 turns', () => {
    const { result } = renderHook(() => useAiChatSession());

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        result.current.addTurn(`prompt ${i}`, `summary ${i}`, NOTES_A);
      }
    });

    expect(result.current.turns).toHaveLength(10);
    const history = result.current.historyForApi();
    expect(history).toHaveLength(16);
    expect(history[0]).toEqual({ role: 'user', content: 'prompt 2' });
    expect(history[history.length - 1]).toEqual({ role: 'model', content: 'summary 9' });
  });
});
