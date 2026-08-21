/**
 * Pinning tests for ProjectSerializationService region-type dispatch.
 *
 * These tests lock down current behavior of `serializeRoomState` and
 * `collectAudioFiles` before refactoring the midi/audio if-else enumeration
 * to an exhaustive `switch (region.type)` + `assertNever` default (DEV-279 Task 0.5).
 * Must stay green before and after the refactor.
 */
import { ProjectSerializationService } from '../ProjectSerializationService';
import type { AudioRegionStorageService } from '../../../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomState, Track, AudioRegion, MidiRegion } from '../../models/ArrangeRoomState';
import { UNITY_DB } from '../../models/ArrangeRoomState';
import fs from 'fs';

jest.mock('../../../infrastructure/storage/AudioRegionStorageService');
jest.mock('../../../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('ProjectSerializationService region-type dispatch (pinning)', () => {
  let service: ProjectSerializationService;
  let mockAudioStorage: jest.Mocked<AudioRegionStorageService>;

  const mockTrack: Track = {
    id: 'track-1',
    name: 'Test Track',
    type: 'midi',
    instrumentId: 'piano',
    instrumentCategory: 'keys',
    volume: UNITY_DB, // DEV-303: generic default test-fixture volume, was linear 0.8
    pan: 0,
    color: '#ff0000',
    regionIds: ['region-midi-1', 'region-audio-1'],
  };

  const mockMidiRegion: MidiRegion = {
    id: 'region-midi-1',
    type: 'midi',
    trackId: 'track-1',
    start: 0,
    length: 4,
    notes: [{ id: 'note-1', pitch: 60, start: 0, duration: 1, velocity: 100 }],
    sustainEvents: [{ id: 'sustain-1', start: 0, end: 2 }],
    name: 'MIDI Region 1',
    color: '#00ff00',
    loopEnabled: true,
    loopIterations: 2,
  };

  const mockAudioRegion: AudioRegion = {
    id: 'region-audio-1',
    type: 'audio',
    trackId: 'track-1',
    start: 4,
    length: 8,
    name: 'Audio Region 1',
    color: '#0000ff',
    audioFileId: 'file-123',
    audioUrl: 'https://example.com/audio/region-audio-1.webm',
    trimStart: 0.5,
    originalLength: 8,
    gain: 0.9,
    fadeInDuration: 0.1,
    fadeOutDuration: 0.2,
    pitchShift: 2,
    recordedBpm: 128,
    tempoMode: 'follow',
    loopEnabled: false,
    loopIterations: 1,
  };

  const mockRoomState: ArrangeRoomState = {
    roomId: 'room-1',
    roomType: 'arrange',
    tracks: [mockTrack],
    regions: [mockMidiRegion, mockAudioRegion],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    scale: { rootNote: 'D', scale: 'minor' },
    occupancy: new Map(),
    selectedTrackId: null,
    selectedRegionIds: [],
    synthStates: {},
    effectChains: {},
    markers: [],
    chordTrack: { id: 'chord-track-1', projectId: '', blocks: [] },
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAudioStorage = {
      getAudioPath: jest.fn((roomId: string, regionId: string) => `/record-audio/${roomId}/${regionId}.webm`),
      audioExists: jest.fn().mockResolvedValue(true),
      resolveRegionFilePath: jest.fn((roomId: string, regionId: string) => `/record-audio/${roomId}/${regionId}.ogg`),
    } as unknown as jest.Mocked<AudioRegionStorageService>;

    service = new ProjectSerializationService(mockAudioStorage);
  });

  describe('serializeRoomState → deserializeProjectData round-trip', () => {
    it('preserves every midi region field unchanged', () => {
      const projectData = service.serializeRoomState(mockRoomState, 'Test Project');
      const { regions } = service.deserializeProjectData(projectData);
      const midi = regions.find((r) => r.type === 'midi');

      expect(midi).toEqual({
        id: 'region-midi-1',
        trackId: 'track-1',
        name: 'MIDI Region 1',
        start: 0,
        length: 4,
        loopEnabled: true,
        loopIterations: 2,
        color: '#00ff00',
        type: 'midi',
        notes: mockMidiRegion.notes,
        sustainEvents: mockMidiRegion.sustainEvents,
      });
    });

    it('preserves every audio region field unchanged (and drops runtime audioUrl)', () => {
      const projectData = service.serializeRoomState(mockRoomState, 'Test Project');
      const { regions } = service.deserializeProjectData(projectData);
      const audio = regions.find((r) => r.type === 'audio');

      expect(audio).toEqual({
        id: 'region-audio-1',
        trackId: 'track-1',
        name: 'Audio Region 1',
        start: 4,
        length: 8,
        loopEnabled: false,
        loopIterations: 1,
        color: '#0000ff',
        type: 'audio',
        audioFileId: 'file-123',
        trimStart: 0.5,
        originalLength: 8,
        gain: 0.9,
        fadeInDuration: 0.1,
        fadeOutDuration: 0.2,
        pitchShift: 2,
        recordedBpm: 128,
        tempoMode: 'follow',
      });
      expect(audio).not.toHaveProperty('audioUrl');
    });

    it('falls back to region.id for audioFileId when audio region has none', () => {
      const { audioFileId: _audioFileId, ...regionWithoutFileId } = mockAudioRegion;
      const state = { ...mockRoomState, regions: [regionWithoutFileId as AudioRegion] };

      const projectData = service.serializeRoomState(state, 'Test Project');
      const serializedRegion = projectData.regions[0];

      expect(serializedRegion?.type).toBe('audio');
      expect(serializedRegion?.type === 'audio' ? serializedRegion.audioFileId : undefined).toBe(
        'region-audio-1'
      );
    });

    it('defaults color to #3b82f6 when missing, for both region types', () => {
      const { color: _midiColor, ...midiNoColor } = mockMidiRegion;
      const { color: _audioColor, ...audioNoColor } = mockAudioRegion;
      const state = {
        ...mockRoomState,
        regions: [midiNoColor as MidiRegion, audioNoColor as AudioRegion],
      };

      const projectData = service.serializeRoomState(state, 'Test Project');

      expect(projectData.regions[0]?.color).toBe('#3b82f6');
      expect(projectData.regions[1]?.color).toBe('#3b82f6');
    });
  });

  describe('collectAudioFiles', () => {
    it('still returns audio files for audio regions and ignores midi regions', async () => {
      const mockBuffer = Buffer.from('audio data');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockBuffer);

      const result = await service.collectAudioFiles('room-1', [mockMidiRegion, mockAudioRegion]);

      expect(result).toHaveLength(1);
      expect(result[0]?.audioFileId).toBe('file-123');
      expect(result[0]?.fileName).toBe('file-123.ogg');
      expect(result[0]?.buffer).toEqual(mockBuffer);
    });

    it('returns no files when only midi regions are present', async () => {
      const result = await service.collectAudioFiles('room-1', [mockMidiRegion]);

      expect(result).toHaveLength(0);
    });
  });
});
