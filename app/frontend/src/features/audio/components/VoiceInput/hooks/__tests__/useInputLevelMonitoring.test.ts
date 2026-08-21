import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInputLevelMonitoring } from "../useInputLevelMonitoring";

// This hook's own `inputLevel` computation was removed (DEV-297/298 final-review fix wave) —
// InputLevelMeter.tsx reads the same analyser directly via the shared useMeterLevel/<Meter>
// pipeline instead, and a repo-wide grep confirmed no caller destructures `inputLevel` from
// this hook anymore. These tests only cover the imperative start/stop contract that
// VoiceRuntimeProvider.tsx / useVoiceControls.ts / useVoiceInputHandlers.ts actually depend on:
// stable function identities and "doesn't throw", regardless of analyser/connection state.

describe("useInputLevelMonitoring", () => {
  it("does not expose an inputLevel field on its return value", () => {
    const { result } = renderHook(() =>
      useInputLevelMonitoring({ analyser: null, isConnected: false, isMuted: false }),
    );

    expect(result.current).not.toHaveProperty("inputLevel");
    expect(Object.keys(result.current).sort()).toEqual([
      "startInputLevelMonitoring",
      "stopInputLevelMonitoring",
    ]);
  });

  it("start/stop are callable no-ops when there is no analyser", () => {
    const { result } = renderHook(() =>
      useInputLevelMonitoring({ analyser: null, isConnected: false, isMuted: false }),
    );

    expect(() => result.current.startInputLevelMonitoring()).not.toThrow();
    expect(() => result.current.stopInputLevelMonitoring()).not.toThrow();
  });

  it("start/stop are callable no-ops with a live analyser and connected/muted combinations", () => {
    const fakeAnalyser = { fftSize: 2048 } as unknown as AnalyserNode;

    const { result, rerender } = renderHook(
      ({ isConnected, isMuted }) =>
        useInputLevelMonitoring({ analyser: fakeAnalyser, isConnected, isMuted }),
      { initialProps: { isConnected: true, isMuted: false } },
    );

    expect(() => result.current.startInputLevelMonitoring()).not.toThrow();

    rerender({ isConnected: true, isMuted: true });
    expect(() => result.current.stopInputLevelMonitoring()).not.toThrow();

    rerender({ isConnected: false, isMuted: false });
    expect(() => result.current.stopInputLevelMonitoring()).not.toThrow();
  });

  it("keeps stable function identities across re-renders (callers rely on this for their own useCallback deps)", () => {
    const fakeAnalyser = { fftSize: 2048 } as unknown as AnalyserNode;
    const { result, rerender } = renderHook(
      ({ isMuted }) =>
        useInputLevelMonitoring({ analyser: fakeAnalyser, isConnected: true, isMuted }),
      { initialProps: { isMuted: false } },
    );

    const firstStart = result.current.startInputLevelMonitoring;
    const firstStop = result.current.stopInputLevelMonitoring;

    rerender({ isMuted: true });

    expect(result.current.startInputLevelMonitoring).toBe(firstStart);
    expect(result.current.stopInputLevelMonitoring).toBe(firstStop);
  });
});
