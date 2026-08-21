/**
 * Audio Unlock Utility for iOS/Safari
 * 
 * iOS Safari requires a user gesture to unlock AudioContext.
 * This utility provides a silent unlock mechanism that triggers
 * on the first user interaction (touch, click, scroll, etc.)
 */

import { AudioContextManager } from './audioContextManager';

let isUnlocked = false;
let unlockPromise: Promise<void> | null = null;

/**
 * Attempt to unlock audio context silently using a user gesture
 */
const unlockAudioContext = async (): Promise<void> => {
  if (isUnlocked) return;
  
  // If unlock is already in progress, wait for it
  if (unlockPromise) return unlockPromise;

  unlockPromise = (async () => {
    try {
      const context = await AudioContextManager.getInstrumentContext();
      
      if (context.state === 'suspended') {
        await context.resume();
      }

      // Play a silent buffer to fully unlock on iOS
      // This is required because iOS needs actual audio playback from user gesture
      const buffer = context.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);

      isUnlocked = true;
      // console.log('🔓 Audio context unlocked successfully');
    } catch (error) {
      console.warn('Failed to unlock audio context:', error);
      // Don't throw - let the app continue and try again on next interaction
    } finally {
      unlockPromise = null;
    }
  })();

  return unlockPromise;
};

/**
 * Setup auto-unlock listeners for first user interaction
 * Should be called once when component mounts
 */
export const setupAutoUnlock = (): (() => void) => {
  if (isUnlocked) return () => {};

  const events = ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'];
  
  const handleInteraction = () => {
    void unlockAudioContext();
    // Remove listeners after first interaction
    cleanup();
  };

  const cleanup = () => {
    events.forEach(event => {
      document.removeEventListener(event, handleInteraction);
    });
  };

  // Add listeners
  events.forEach(event => {
    document.addEventListener(event, handleInteraction, { once: true, passive: true });
  });

  // Return cleanup function
  return cleanup;
};
