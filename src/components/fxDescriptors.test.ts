import { describe, expect, test } from 'bun:test';
import {
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  reverbDecayDescriptor,
} from './fxDescriptors';

describe('reverbDecayDescriptor', () => {
  test('names the space at the boundaries of the 0.5s-6.0s range', () => {
    expect(reverbDecayDescriptor(0.5)).toBe('Room');
    expect(reverbDecayDescriptor(1.4)).toBe('Room');
    expect(reverbDecayDescriptor(1.5)).toBe('Hall');
    expect(reverbDecayDescriptor(3.4)).toBe('Hall');
    expect(reverbDecayDescriptor(3.5)).toBe('Cathedral');
    expect(reverbDecayDescriptor(6.0)).toBe('Cathedral');
  });
});

describe('delayFeedbackDescriptor', () => {
  test('names the repeat character across 0-1', () => {
    expect(delayFeedbackDescriptor(0)).toBe('Slapback');
    expect(delayFeedbackDescriptor(0.24)).toBe('Slapback');
    expect(delayFeedbackDescriptor(0.25)).toBe('Echo');
    expect(delayFeedbackDescriptor(0.64)).toBe('Echo');
    expect(delayFeedbackDescriptor(0.65)).toBe('Runaway');
    expect(delayFeedbackDescriptor(1)).toBe('Runaway');
  });
});

describe('distortionDriveDescriptor', () => {
  test('names the drive character across 0-1', () => {
    expect(distortionDriveDescriptor(0)).toBe('Warm');
    expect(distortionDriveDescriptor(0.29)).toBe('Warm');
    expect(distortionDriveDescriptor(0.3)).toBe('Crunch');
    expect(distortionDriveDescriptor(0.64)).toBe('Crunch');
    expect(distortionDriveDescriptor(0.65)).toBe('Fuzz');
    expect(distortionDriveDescriptor(1)).toBe('Fuzz');
  });
});
