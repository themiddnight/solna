/**
 * BR-14: Perform Room Session Recording - Regression Tests
 * 
 * Protects against regressions in:
 * - Recording state management
 * - Audio recording toggle
 * - Session recording toggle
 * - Shadow capture states
 * - Recording state persistence
 * - Concurrent recording state updates
 */

/* eslint-disable @typescript-eslint/naming-convention */

import { PerformRoomStateService } from '../application/PerformRoomStateService';

describe('BR-14: Session Recording Regression Tests', () => {
  let stateService: PerformRoomStateService;
  const testRoomId = 'test-recording-room';

  beforeEach(async () => {
    stateService = new PerformRoomStateService();
    
    // Initialize room
    await stateService.initializeState(testRoomId);
  });

  afterEach(async () => {
    // Clean up - state will be cleaned by Redis TTL
  });

  describe('Recording State Initialization', () => {
    it('should initialize with recording disabled', async () => {
      const state = await stateService.getState(testRoomId);

      expect(state).toBeDefined();
      expect(state?.recordingStates.isAudioRecording).toBe(false);
      expect(state?.recordingStates.isSessionRecording).toBe(false);
      expect(state?.recordingStates.shadowCaptureStates).toEqual({});
    });

    it('should have all recording states defined', async () => {
      const state = await stateService.getState(testRoomId);

      expect(state?.recordingStates).toBeDefined();
      expect(state?.recordingStates).toHaveProperty('isAudioRecording');
      expect(state?.recordingStates).toHaveProperty('isSessionRecording');
      expect(state?.recordingStates).toHaveProperty('shadowCaptureStates');
    });
  });

  describe('Audio Recording Toggle', () => {
    it('should enable audio recording', async () => {
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
    });

    it('should disable audio recording', async () => {
      // Enable first
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
      });

      // Then disable
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: false,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(false);
    });

    it('should toggle audio recording multiple times', async () => {
      // Toggle on
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
      });
      let state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);

      // Toggle off
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: false,
      });
      state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(false);

      // Toggle on again
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
      });
      state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
    });
  });

  describe('Session Recording Toggle', () => {
    it('should enable session recording', async () => {
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: true,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should disable session recording', async () => {
      // Enable first
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: true,
      });

      // Then disable
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: false,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isSessionRecording).toBe(false);
    });

    it('should toggle session recording multiple times', async () => {
      // Toggle on
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: true,
      });
      let state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isSessionRecording).toBe(true);

      // Toggle off
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: false,
      });
      state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isSessionRecording).toBe(false);

      // Toggle on again
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: true,
      });
      state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });
  });

  describe('Combined Recording States', () => {
    it('should enable both audio and session recording', async () => {
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should enable audio recording without affecting session recording', async () => {
      // Enable session recording first
      await stateService.updateRecordingState(testRoomId, {
        isSessionRecording: true,
      });

      // Then enable audio recording
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should disable one recording type without affecting the other', async () => {
      // Enable both
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
      });

      // Disable only audio
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: false,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(false);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });
  });

  describe('Shadow Capture States', () => {
    it('should set shadow capture state for user', async () => {
      await stateService.updateRecordingState(testRoomId, {
        shadowCaptureStates: {
          'user-1': true,
        },
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.shadowCaptureStates['user-1']).toBe(true);
    });

    it('should set shadow capture states for multiple users', async () => {
      await stateService.updateRecordingState(testRoomId, {
        shadowCaptureStates: {
          'user-1': true,
          'user-2': true,
          'user-3': false,
        },
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.shadowCaptureStates['user-1']).toBe(true);
      expect(state?.recordingStates.shadowCaptureStates['user-2']).toBe(true);
      expect(state?.recordingStates.shadowCaptureStates['user-3']).toBe(false);
    });

    it('should update shadow capture state for existing user', async () => {
      // Set initial state
      await stateService.updateRecordingState(testRoomId, {
        shadowCaptureStates: {
          'user-1': true,
        },
      });

      // Update state
      await stateService.updateRecordingState(testRoomId, {
        shadowCaptureStates: {
          'user-1': false,
        },
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.shadowCaptureStates['user-1']).toBe(false);
    });

    it('should maintain shadow capture states when updating recording flags', async () => {
      // Set shadow capture states
      await stateService.updateRecordingState(testRoomId, {
        shadowCaptureStates: {
          'user-1': true,
          'user-2': true,
        },
      });

      // Update recording flags
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.shadowCaptureStates['user-1']).toBe(true);
      expect(state?.recordingStates.shadowCaptureStates['user-2']).toBe(true);
    });
  });

  describe('Recording State Persistence', () => {
    it('should persist recording state across state retrievals', async () => {
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
      });

      // Get state multiple times
      const state1 = await stateService.getState(testRoomId);
      const state2 = await stateService.getState(testRoomId);
      const state3 = await stateService.getState(testRoomId);

      expect(state1?.recordingStates.isAudioRecording).toBe(true);
      expect(state2?.recordingStates.isAudioRecording).toBe(true);
      expect(state3?.recordingStates.isAudioRecording).toBe(true);

      expect(state1?.recordingStates.isSessionRecording).toBe(true);
      expect(state2?.recordingStates.isSessionRecording).toBe(true);
      expect(state3?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should maintain recording state after other state updates', async () => {
      // Set recording state
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
      });

      // Update user state (different state)
      await stateService.updateUserState(testRoomId, 'user-1', {
        userId: 'user-1',
        username: 'Test User',
        currentInstrument: 'synth',
        currentCategory: 'synth',
        effectChains: {},
        isPlaying: false,
      });

      // Verify recording state unchanged
      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });
  });

  describe('Concurrent Recording State Updates', () => {
    it('should handle rapid recording state toggles', async () => {
      // Rapid toggles
      await stateService.updateRecordingState(testRoomId, { isAudioRecording: true });
      await stateService.updateRecordingState(testRoomId, { isAudioRecording: false });
      await stateService.updateRecordingState(testRoomId, { isAudioRecording: true });
      await stateService.updateRecordingState(testRoomId, { isAudioRecording: false });
      await stateService.updateRecordingState(testRoomId, { isAudioRecording: true });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
    });

    it('should handle concurrent updates to different recording types', async () => {
      await Promise.all([
        stateService.updateRecordingState(testRoomId, { isAudioRecording: true }),
        stateService.updateRecordingState(testRoomId, { isSessionRecording: true }),
      ]);

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should handle concurrent shadow capture updates', async () => {
      await Promise.all([
        stateService.updateRecordingState(testRoomId, {
          shadowCaptureStates: { 'user-1': true },
        }),
        stateService.updateRecordingState(testRoomId, {
          shadowCaptureStates: { 'user-2': true },
        }),
        stateService.updateRecordingState(testRoomId, {
          shadowCaptureStates: { 'user-3': true },
        }),
      ]);

      const state = await stateService.getState(testRoomId);
      // At least one should be set
      const captureStates = state?.recordingStates.shadowCaptureStates || {};
      const setCaptureCount = Object.values(captureStates).filter(v => v === true).length;
      expect(setCaptureCount).toBeGreaterThan(0);
    });
  });

  describe('Recording State Cleanup', () => {
    it('should maintain recording state in Redis', async () => {
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
      });

      // State should persist in Redis
      const state = await stateService.getState(testRoomId);
      expect(state).toBeDefined();
      expect(state?.recordingStates.isAudioRecording).toBe(true);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should reset recording state to default', async () => {
      // Enable recording
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
        shadowCaptureStates: {
          'user-1': true,
          'user-2': true,
        },
      });

      // Reset to default
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: false,
        isSessionRecording: false,
        shadowCaptureStates: {},
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(false);
      expect(state?.recordingStates.isSessionRecording).toBe(false);
      expect(state?.recordingStates.shadowCaptureStates).toEqual({});
    });
  });
});
