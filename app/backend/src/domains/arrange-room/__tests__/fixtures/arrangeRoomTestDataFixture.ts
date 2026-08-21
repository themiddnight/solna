import type { Track, MidiRegion, AudioRegion, MidiNote } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { UNITY_DB } from '@/domains/arrange-room/domain/models/ArrangeRoomState';

export function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    name: 'Test Track',
    type: 'midi',
    instrumentId: 'piano',
    instrumentCategory: 'keys',
    volume: UNITY_DB, // DEV-303: generic default test-fixture volume, was linear 0.8
    pan: 0,
    color: '#3b82f6',
    regionIds: [],
    ...overrides,
  };
}

export function createTestMidiRegion(overrides: Partial<MidiRegion> = {}): MidiRegion {
  return {
    id: 'region-1',
    trackId: 'track-1',
    name: 'MIDI Region',
    type: 'midi',
    start: 0,
    length: 4,
    loopEnabled: false,
    loopIterations: 1,
    notes: [],
    sustainEvents: [],
    ...overrides,
  };
}

export function createTestAudioRegion(overrides: Partial<AudioRegion> = {}): AudioRegion {
  return {
    id: 'region-2',
    trackId: 'track-1',
    name: 'Audio Region',
    type: 'audio',
    start: 0,
    length: 4,
    loopEnabled: false,
    loopIterations: 1,
    audioUrl: '/audio/sample.wav',
    ...overrides,
  };
}

export function createTestMidiNote(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: 'note-1',
    pitch: 60,
    start: 0,
    duration: 1,
    velocity: 100,
    ...overrides,
  };
}
