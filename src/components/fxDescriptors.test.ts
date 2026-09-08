import { describe, expect, test } from 'bun:test';
import {
  compressorRatioDescriptor,
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  dynamicsAttackDescriptor,
  dynamicsReleaseDescriptor,
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

describe('compressorRatioDescriptor', () => {
  test('names the character across the 1:1 - 20:1 range', () => {
    expect(compressorRatioDescriptor(1)).toBe('Gentle');
    expect(compressorRatioDescriptor(2.9)).toBe('Gentle');
    expect(compressorRatioDescriptor(3)).toBe('Firm');
    expect(compressorRatioDescriptor(7.9)).toBe('Firm');
    expect(compressorRatioDescriptor(8)).toBe('Squash');
    expect(compressorRatioDescriptor(20)).toBe('Squash');
  });
});

describe('dynamicsAttackDescriptor', () => {
  test('names the attack in the range the knobs offer, in seconds', () => {
    expect(dynamicsAttackDescriptor(0.001)).toBe('Snap');
    expect(dynamicsAttackDescriptor(0.009)).toBe('Snap');
    expect(dynamicsAttackDescriptor(0.01)).toBe('Quick');
    expect(dynamicsAttackDescriptor(0.049)).toBe('Quick');
    expect(dynamicsAttackDescriptor(0.05)).toBe('Relaxed');
    expect(dynamicsAttackDescriptor(0.2)).toBe('Relaxed');
  });
});

describe('dynamicsReleaseDescriptor', () => {
  test('names the release in the range the knobs offer, in seconds', () => {
    expect(dynamicsReleaseDescriptor(0.02)).toBe('Tight');
    expect(dynamicsReleaseDescriptor(0.099)).toBe('Tight');
    expect(dynamicsReleaseDescriptor(0.1)).toBe('Natural');
    expect(dynamicsReleaseDescriptor(0.399)).toBe('Natural');
    expect(dynamicsReleaseDescriptor(0.4)).toBe('Slow');
    expect(dynamicsReleaseDescriptor(1)).toBe('Slow');
  });
});
