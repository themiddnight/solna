 
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVoiceControls } from '../useVoiceControls';
import { applyVoiceInputGainDb, applyMonitorLevelDb } from '../../utils/voiceGain';
import { createPartialMock } from '@/test-utils/createPartialMock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockTrack = (enabled = true): MediaStreamTrack => createPartialMock<MediaStreamTrack>({
  kind: 'audio',
  enabled,
  readyState: 'live',
  stop: vi.fn(),
});

const createMockStream = (track = createMockTrack()): MediaStream => createPartialMock<MediaStream>({
  getAudioTracks: vi.fn(() => [track]),
  getTracks: vi.fn(() => [track]),
});

const createMockGainNode = (): GainNode => createPartialMock<GainNode>({
  gain: createPartialMock<AudioParam>({ value: 1 }),
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const createMockAudioContext = (): AudioContext => createPartialMock<AudioContext>({
  destination: createPartialMock<AudioDestinationNode>({ connect: vi.fn(), disconnect: vi.fn() }),
  createGain: vi.fn(() => createMockGainNode()),
  createMediaStreamSource: vi.fn(() => createPartialMock<MediaStreamAudioSourceNode>({ connect: vi.fn(), disconnect: vi.fn() })),
  state: 'running',
  currentTime: 0,
});

const createMockMonitorNode = (): AudioNode => createPartialMock<AudioNode>({
  connect: vi.fn(),
  disconnect: vi.fn(),
});

// ---------------------------------------------------------------------------
// Default prop factory
// ---------------------------------------------------------------------------

const buildProps = (overrides: Partial<Parameters<typeof useVoiceControls>[0]> = {}) => ({
  audioContext: null as AudioContext | null,
  gainNode: null as GainNode | null,
  monitorNode: null as AudioNode | null,
  mediaStream: null as MediaStream | null,
  micPermission: false,
  isMuted: false,
  isSelfMonitoring: false,
  monitorLevel: 0.6,
  initializeAudioStream: vi.fn().mockResolvedValue(undefined),
  startInputLevelMonitoring: vi.fn(),
  stopInputLevelMonitoring: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVoiceControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── handleMuteToggle ──────────────────────────────────────────────────────

  describe('handleMuteToggle', () => {
    it('calls initializeAudioStream when unmuting with no stream and no permission', async () => {
      const initializeAudioStream = vi.fn().mockResolvedValue(undefined);
      const props = buildProps({
        isMuted: true, // currently muted → toggling → newMutedState = false (unmute)
        micPermission: false,
        mediaStream: null,
        initializeAudioStream,
      });

      const { result } = renderHook(() => useVoiceControls(props));

      await act(async () => {
        await result.current.handleMuteToggle();
      });

      expect(initializeAudioStream).toHaveBeenCalledTimes(1);
    });

    it('enables audio track and calls startInputLevelMonitoring when unmuting with stream + permission', async () => {
      const startInputLevelMonitoring = vi.fn();
      const track = createMockTrack(false);
      const stream = createMockStream(track);

      const props = buildProps({
        isMuted: true, // currently muted → toggling → unmute
        micPermission: true,
        mediaStream: stream,
        startInputLevelMonitoring,
      });

      const { result } = renderHook(() => useVoiceControls(props));

      await act(async () => {
        await result.current.handleMuteToggle();
      });

      expect(track.enabled).toBe(true);
      expect(startInputLevelMonitoring).toHaveBeenCalledTimes(1);
    });

    it('disables audio track and calls stopInputLevelMonitoring when muting with stream', async () => {
      const stopInputLevelMonitoring = vi.fn();
      const track = createMockTrack(true);
      const stream = createMockStream(track);

      const props = buildProps({
        isMuted: false, // currently unmuted → toggling → mute
        mediaStream: stream,
        stopInputLevelMonitoring,
      });

      const { result } = renderHook(() => useVoiceControls(props));

      await act(async () => {
        await result.current.handleMuteToggle();
      });

      expect(track.enabled).toBe(false);
      expect(stopInputLevelMonitoring).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleGainChange ─────────────────────────────────────────────────────

  describe('handleGainChange', () => {
    it('converts the dB gain to linear before writing to the GainNode (DEV-307)', () => {
      const gainNode = createMockGainNode();
      const props = buildProps({ gainNode });

      const { result } = renderHook(() => useVoiceControls(props));

      act(() => {
        result.current.handleGainChange(0.5); // 0.5dB
      });

      expect(gainNode.gain.value).toBeCloseTo(applyVoiceInputGainDb(0.5), 5);
    });

    it('is a no-op when gainNode is null', () => {
      const props = buildProps({ gainNode: null });

      const { result } = renderHook(() => useVoiceControls(props));

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleGainChange(0.5);
        });
      }).not.toThrow();
    });

    it('clamps and converts dB to linear before writing to the GainNode (DEV-307)', () => {
      const gainNode = createMockGainNode();
      const props = buildProps({ gainNode });

      const { result } = renderHook(() => useVoiceControls(props));

      act(() => {
        result.current.handleGainChange(100); // way above +24dB ceiling
      });

      // Clamped to the +24dB ceiling before converting to linear gain.
      expect(gainNode.gain.value).toBeCloseTo(applyVoiceInputGainDb(24), 3);
    });
  });

  // ── handleSelfMonitorToggle ───────────────────────────────────────────────

  describe('handleSelfMonitorToggle', () => {
    it('is a no-op when audioContext is null', () => {
      const props = buildProps({ audioContext: null, monitorNode: createMockMonitorNode() });
      const { result } = renderHook(() => useVoiceControls(props));

      expect(() => {
        act(() => {
          result.current.handleSelfMonitorToggle();
        });
      }).not.toThrow();
    });

    it('is a no-op when monitorNode is null', () => {
      const props = buildProps({
        audioContext: createMockAudioContext(),
        monitorNode: null,
      });
      const { result } = renderHook(() => useVoiceControls(props));

      expect(() => {
        act(() => {
          result.current.handleSelfMonitorToggle();
        });
      }).not.toThrow();
    });

    it('connects monitorNode through a new gain node to destination when enabling self-monitoring', () => {
      const audioContext = createMockAudioContext();
      const monitoringGain = createPartialMock<GainNode>({
        gain: createPartialMock<AudioParam>({ value: 1 }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      vi.mocked(audioContext.createGain).mockReturnValue(monitoringGain);

      const monitorNode = createMockMonitorNode();

      const props = buildProps({
        audioContext,
        monitorNode,
        isSelfMonitoring: false, // enabling
      });

      const { result } = renderHook(() => useVoiceControls(props));

      act(() => {
        result.current.handleSelfMonitorToggle();
      });

      expect(audioContext.createGain).toHaveBeenCalledTimes(1);
      expect(monitorNode.connect).toHaveBeenCalledWith(monitoringGain);
      expect(monitoringGain.connect).toHaveBeenCalledWith(audioContext.destination);
    });

    it('disconnects monitoring connection when disabling self-monitoring', () => {
      const audioContext = createMockAudioContext();
      const monitoringGain = createPartialMock<GainNode>({
        gain: createPartialMock<AudioParam>({ value: 0.6 }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      vi.mocked(audioContext.createGain).mockReturnValue(monitoringGain);

      const monitorNode = createMockMonitorNode();

      // First render with isSelfMonitoring=false to enable it
      const enableProps = buildProps({
        audioContext,
        monitorNode,
        isSelfMonitoring: false,
      });

      const { result, rerender } = renderHook(
        (p: Parameters<typeof useVoiceControls>[0]) => useVoiceControls(p),
        { initialProps: enableProps },
      );

      // Enable self-monitoring
      act(() => {
        result.current.handleSelfMonitorToggle();
      });

      // Now rerender with isSelfMonitoring=true and call to disable
      const disableProps = buildProps({
        audioContext,
        monitorNode,
        isSelfMonitoring: true,
      });

      rerender(disableProps);

      act(() => {
        result.current.handleSelfMonitorToggle();
      });

      // The monitoring connection should be disconnected
      expect(monitorNode.disconnect).toHaveBeenCalledWith(monitoringGain);
      expect(monitoringGain.disconnect).toHaveBeenCalledWith(audioContext.destination);
    });
  });

  // ── monitor level dB conversion (DEV-307 review fix) ─────────────────────
  // Finding 1: the monitoring GainNode write sites used to write the raw dB (or, before that,
  // linear) `monitorLevel` directly to the AudioParam. These assert the conversion actually
  // happens at the two write boundaries, mirroring handleGainChange's coverage above.

  describe('monitor level dB conversion (DEV-307 review fix)', () => {
    it('converts monitorLevel dB to linear gain when enabling self-monitoring', () => {
      const audioContext = createMockAudioContext();
      const monitoringGain = createPartialMock<GainNode>({
        gain: createPartialMock<AudioParam>({ value: 1 }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      vi.mocked(audioContext.createGain).mockReturnValue(monitoringGain);
      const monitorNode = createMockMonitorNode();

      const props = buildProps({
        audioContext,
        monitorNode,
        isSelfMonitoring: false,
        monitorLevel: 6, // dB
      });

      const { result } = renderHook(() => useVoiceControls(props));

      act(() => {
        result.current.handleSelfMonitorToggle();
      });

      expect(monitoringGain.gain.value).toBeCloseTo(applyMonitorLevelDb(6), 5);
      // Must be the converted linear multiplier, not the raw dB number written directly.
      expect(monitoringGain.gain.value).not.toBe(6);
    });

    it('converts monitorLevel dB to linear gain on live updates while monitoring is active', () => {
      const audioContext = createMockAudioContext();
      const monitoringGain = createPartialMock<GainNode>({
        gain: createPartialMock<AudioParam>({ value: 1, setTargetAtTime: vi.fn() }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      vi.mocked(audioContext.createGain).mockReturnValue(monitoringGain);
      const monitorNode = createMockMonitorNode();

      const initialProps = buildProps({
        audioContext,
        monitorNode,
        isSelfMonitoring: false,
        monitorLevel: 0,
      });

      const { result, rerender } = renderHook(
        (p: Parameters<typeof useVoiceControls>[0]) => useVoiceControls(p),
        { initialProps },
      );

      act(() => {
        result.current.handleSelfMonitorToggle(); // enable monitoring, creates the connection
      });

      rerender(
        buildProps({
          audioContext,
          monitorNode,
          isSelfMonitoring: true,
          monitorLevel: -12, // dragged the slider
        }),
      );

      expect(monitoringGain.gain.setTargetAtTime).toHaveBeenCalledWith(
        applyMonitorLevelDb(-12),
        audioContext.currentTime,
        0.02,
      );
      // Must be the converted linear multiplier, not the raw dB number.
      expect(monitoringGain.gain.setTargetAtTime).not.toHaveBeenCalledWith(
        -12,
        audioContext.currentTime,
        0.02,
      );
    });
  });

  // ── handleMuteToggle edge cases ───────────────────────────────────────────

  describe('handleMuteToggle edge cases', () => {
    it('propagates error when initializeAudioStream throws', async () => {
      const initializeAudioStream = vi.fn().mockRejectedValue(new Error('mic denied'))
      const props = buildProps({
        isMuted: true,
        micPermission: false,
        mediaStream: null,
        initializeAudioStream,
      })

      const { result } = renderHook(() => useVoiceControls(props))

      await expect(
        act(async () => {
          await result.current.handleMuteToggle()
        }),
      ).rejects.toThrow('mic denied')
    })

    it('still calls startInputLevelMonitoring when audio track list is empty', async () => {
      const startInputLevelMonitoring = vi.fn()
      const stream = createPartialMock<MediaStream>({ getAudioTracks: vi.fn(() => []) })

      const props = buildProps({
        isMuted: true,
        micPermission: true,
        mediaStream: stream,
        startInputLevelMonitoring,
      })

      const { result } = renderHook(() => useVoiceControls(props))

      await act(async () => {
        await result.current.handleMuteToggle()
      })

      // No track to enable but monitoring should still start
      expect(startInputLevelMonitoring).toHaveBeenCalledTimes(1)
    })

    it('still calls stopInputLevelMonitoring when audio track list is empty', async () => {
      const stopInputLevelMonitoring = vi.fn()
      const stream = createPartialMock<MediaStream>({ getAudioTracks: vi.fn(() => []) })

      const props = buildProps({
        isMuted: false,
        mediaStream: stream,
        stopInputLevelMonitoring,
      })

      const { result } = renderHook(() => useVoiceControls(props))

      await act(async () => {
        await result.current.handleMuteToggle()
      })

      expect(stopInputLevelMonitoring).toHaveBeenCalledTimes(1)
    })
  })

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  describe('cleanup on unmount', () => {
    it('disconnects monitoring connection when component unmounts after enabling self-monitoring', () => {
      const audioContext = createMockAudioContext();
      const monitoringGain = createPartialMock<GainNode>({
        gain: createPartialMock<AudioParam>({ value: 0.6 }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      vi.mocked(audioContext.createGain).mockReturnValue(monitoringGain);

      const monitorNode = createMockMonitorNode();

      const props = buildProps({
        audioContext,
        monitorNode,
        isSelfMonitoring: false,
      });

      const { result, unmount } = renderHook(() => useVoiceControls(props));

      // Enable self-monitoring to create the connection
      act(() => {
        result.current.handleSelfMonitorToggle();
      });

      expect(monitorNode.connect).toHaveBeenCalledWith(monitoringGain);

      // Unmount should clean up
      unmount();

      expect(monitorNode.disconnect).toHaveBeenCalledWith(monitoringGain);
    });
  });
});
