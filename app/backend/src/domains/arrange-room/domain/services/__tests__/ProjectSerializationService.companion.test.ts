/**
 * DEV-279 Task 0.6: companion region dispatch at the switch sites Task 0.5
 * converted to exhaustive `switch (region.type) { … default: assertNever }`.
 * Companion regions aren't creatable from any UI yet (Phase 2) — this test
 * seeds one directly to verify serialize round-trips the config and
 * `collectAudioFiles` excludes it (companion regions have no audio file).
 */
import { ProjectSerializationService } from '../ProjectSerializationService';
import type { AudioRegionStorageService } from '../../../infrastructure/storage/AudioRegionStorageService';
import type {
  ArrangeRoomState,
  Track,
  MidiRegion,
  CompanionRegion,
  CompanionRegionConfig,
  CompanionRegionMetadata,
} from '../../models/ArrangeRoomState';
import { UNITY_DB, toDecibels } from '../../models/ArrangeRoomState';
import { DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import fs from 'fs';

jest.mock('../../../infrastructure/storage/AudioRegionStorageService');
jest.mock('../../../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('ProjectSerializationService companion dispatch (pinning)', () => {
  let service: ProjectSerializationService;
  let mockAudioStorage: jest.Mocked<AudioRegionStorageService>;

  const mockTrack: Track = {
    id: 'track-1',
    name: 'Test Track',
    type: 'midi',
    instrumentId: 'bass',
    instrumentCategory: 'strings',
    volume: UNITY_DB, // DEV-303: generic default test-fixture volume, was linear 0.8
    pan: 0,
    color: '#ff0000',
    regionIds: ['region-midi-1', 'region-companion-1'],
  };

  const mockMidiRegion: MidiRegion = {
    id: 'region-midi-1',
    type: 'midi',
    trackId: 'track-1',
    start: 0,
    length: 4,
    notes: [],
    sustainEvents: [],
    name: 'MIDI Region 1',
    color: '#00ff00',
    loopEnabled: true,
    loopIterations: 2,
  };

  const companionConfig: CompanionRegionConfig = {
    style: 'walking',
    density: 'normal',
    volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB),
    isMuted: false,
    drumParts: {
      kick: true,
      snare: true,
      toms: false,
      hat: true,
      crash: false,
      ride: false,
      others: false,
    },
  };

  const mockCompanionRegion: CompanionRegion = {
    id: 'region-companion-1',
    type: 'companion',
    trackId: 'track-1',
    start: 4,
    length: 4,
    name: 'Companion Region 1',
    color: '#9333ea',
    loopEnabled: false,
    loopIterations: 1,
    config: companionConfig,
  };

  const mockRoomState: ArrangeRoomState = {
    roomId: 'room-1',
    roomType: 'arrange',
    tracks: [mockTrack],
    regions: [mockMidiRegion, mockCompanionRegion],
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
    it('round-trips a companion region, preserving id/trackId/name/start/length/loop*/color/type/config', () => {
      const projectData = service.serializeRoomState(mockRoomState, 'Test Project');
      const { regions } = service.deserializeProjectData(projectData);
      const companion = regions.find((r) => r.type === 'companion');

      expect(companion).toEqual({
        id: 'region-companion-1',
        trackId: 'track-1',
        name: 'Companion Region 1',
        start: 4,
        length: 4,
        loopEnabled: false,
        loopIterations: 1,
        color: '#9333ea',
        type: 'companion',
        config: companionConfig,
      });
    });

    it('does not emit a `notes` field for a companion region', () => {
      const projectData = service.serializeRoomState(mockRoomState, 'Test Project');
      const companion = projectData.regions.find((r) => r.type === 'companion');

      expect(companion).not.toHaveProperty('notes');
      expect(companion).not.toHaveProperty('sustainEvents');
    });

    it('defaults color to #3b82f6 when missing on a companion region', () => {
      const { color: _color, ...companionNoColor } = mockCompanionRegion;
      const state = { ...mockRoomState, regions: [companionNoColor as CompanionRegion] };

      const projectData = service.serializeRoomState(state, 'Test Project');

      expect(projectData.regions[0]?.color).toBe('#3b82f6');
    });
  });

  describe('companionMetadata persistence (DEV-279 Phase 3 Task 3.3b)', () => {
    const companionMetadata: CompanionRegionMetadata = {
      config: companionConfig,
      chordTrackSnapshot: [],
      convertedAt: '2026-07-27T00:00:00.000Z',
    };

    it('serializes companionMetadata on a converted midi region', () => {
      const convertedRegion: MidiRegion = { ...mockMidiRegion, companionMetadata };
      const state = { ...mockRoomState, regions: [convertedRegion] };

      const projectData = service.serializeRoomState(state, 'Test Project');

      expect(projectData.regions[0]).toMatchObject({ companionMetadata });
    });

    it('omits companionMetadata for a plain midi region that was never converted', () => {
      const projectData = service.serializeRoomState(mockRoomState, 'Test Project');
      const midi = projectData.regions.find((r) => r.type === 'midi');

      expect(midi).not.toHaveProperty('companionMetadata');
    });
  });

  describe('collectAudioFiles', () => {
    it('excludes companion regions (no audio file to collect)', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('audio data'));

      const result = await service.collectAudioFiles('room-1', [mockMidiRegion, mockCompanionRegion]);

      expect(result).toHaveLength(0);
      expect(mockAudioStorage.resolveRegionFilePath).not.toHaveBeenCalled();
    });
  });
});
