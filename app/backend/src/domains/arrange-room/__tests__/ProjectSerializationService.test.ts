/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars */
import { ProjectSerializationService } from '../domain/services/ProjectSerializationService';
import type { AudioRegionStorageService } from '../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomState, Track, AudioRegion, MidiRegion } from '../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';
import type { ProjectData } from '../domain/models/ProjectData';
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';
import { ProjectVersionMismatchError } from '../domain/errors/ProjectVersionMismatchError';

const mockProjectData: ProjectData = {
  version: PROJECT_SCHEMA_VERSION,
  metadata: {
    name: 'Test Project',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  },
  project: {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    gridDivision: 16,
    loop: { enabled: false, start: 0, end: 0 },
    isMetronomeEnabled: true,
    snapToGrid: true,
  },
  scale: { rootNote: 'C', scale: 'major' },
  tracks: [],
  regions: [],
  effectChains: {},
  synthStates: {},
  markers: [],
};

jest.mock('../infrastructure/storage/AudioRegionStorageService');
jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('ProjectSerializationService', () => {
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
    regionIds: ['region-1'],
  };

  const mockMidiRegion: MidiRegion = {
    id: 'region-1',
    type: 'midi',
    trackId: 'track-1',
    start: 0,
    length: 4,
    notes: [{ id: 'note-1', pitch: 60, start: 0, duration: 1, velocity: 100 }],
    sustainEvents: [],
    name: 'MIDI Region 1',
    color: '#00ff00',
    loopEnabled: false,
    loopIterations: 1,
  };

  const mockAudioRegion: AudioRegion = {
    id: 'region-2',
    type: 'audio',
    trackId: 'track-2',
    start: 4,
    length: 8,
    name: 'Audio Region 1',
    color: '#0000ff',
    audioFileId: 'file-123',
    audioUrl: 'https://example.com/audio/region-2.webm',
    trimStart: 0,
    originalLength: 8,
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
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date(),
    chordTrack: { id: 'chord-track-1', projectId: 'project-1', blocks: [] },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAudioStorage = {
      getAudioPath: jest.fn((roomId, regionId) => `/record-audio/${roomId}/${regionId}.webm`),
      audioExists: jest.fn().mockResolvedValue(true),
      resolveRegionFilePath: jest.fn((roomId, regionId) => `/record-audio/${roomId}/${regionId}.ogg`),
    } as unknown as jest.Mocked<AudioRegionStorageService>;

    service = new ProjectSerializationService(mockAudioStorage);
  });

  describe('serializeRoomState', () => {
    it('should serialize room state to ProjectData format', () => {
      const projectName = 'Test Project';
      const result = service.serializeRoomState(mockRoomState, projectName);

      expect(result.version).toBe(PROJECT_SCHEMA_VERSION);
      expect(result.metadata.name).toBe(projectName);
      expect(result.project.bpm).toBe(120);
      expect(result.project.timeSignature).toEqual({ numerator: 4, denominator: 4 });
      expect(result.tracks).toHaveLength(1);
      expect(result.regions).toHaveLength(2);
    });

    it('should use state.scale not state.ownerScale for arrange rooms', () => {
      const result = service.serializeRoomState(mockRoomState, 'Test');

      expect(result.scale).toEqual({ rootNote: 'D', scale: 'minor' });
    });

    it('should default to C major if no scale provided', () => {
      const { scale: _scale, ...stateWithoutScale } = mockRoomState;
      const result = service.serializeRoomState(stateWithoutScale as ArrangeRoomState, 'Test');

      expect(result.scale).toEqual({ rootNote: 'C', scale: 'major' });
    });

    it('should serialize MIDI regions correctly', () => {
      const result = service.serializeRoomState(mockRoomState, 'Test');
      const midiRegion = result.regions.find(r => r.type === 'midi');

      expect(midiRegion).toBeDefined();
      expect(midiRegion?.notes).toHaveLength(1);
      expect(midiRegion?.notes?.[0]?.pitch).toBe(60);
    });

    it('should serialize audio regions with audioFileId', () => {
      const result = service.serializeRoomState(mockRoomState, 'Test');
      const audioRegion = result.regions.find(r => r.type === 'audio');

      expect(audioRegion).toBeDefined();
      expect(audioRegion?.audioFileId).toBe('file-123');
    });

    it('should serialize effect chains', () => {
      const stateWithEffects = {
        ...mockRoomState,
        effectChains: {
          'track:track-1': {
            type: 'track:track-1',
            effects: [
              {
                id: 'effect-1',
                type: 'reverb',
                bypassed: false,
                order: 0,
                parameters: [{ name: 'Room Size', value: 0.5 }],
              },
            ],
          },
        },
      };

      const result = service.serializeRoomState(stateWithEffects, 'Test');

      expect(result.effectChains).toBeDefined();
      expect(result.effectChains?.['track:track-1']).toBeDefined();
    });

    it('should serialize markers', () => {
      const stateWithMarkers = {
        ...mockRoomState,
        markers: [
          { id: 'marker-1', position: 16, description: 'Verse', color: '#ff0000' },
        ],
      };

      const result = service.serializeRoomState(stateWithMarkers, 'Test');

      expect(result.markers).toHaveLength(1);
      expect(result.markers?.[0]?.description).toBe('Verse');
    });

    it('should serialize chordTrack (DEV-279 P1)', () => {
      const stateWithChordTrack = {
        ...mockRoomState,
        chordTrack: {
          id: 'chord-track-1',
          projectId: 'project-1',
          blocks: [
            {
              id: 'block-1',
              start: 0,
              duration: 4,
              chord: { kind: 'diatonic' as const, degree: 1 },
              color: '#ff0000',
            },
          ],
        },
      };

      const result = service.serializeRoomState(stateWithChordTrack, 'Test');

      expect(result.chordTrack).toBeDefined();
      expect(result.chordTrack?.blocks).toHaveLength(1);
      expect(result.chordTrack?.blocks[0]?.id).toBe('block-1');
    });
  });

  describe('collectAudioFiles', () => {
    it('should collect audio files from regions', async () => {
      const mockBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockBuffer);

      const result = await service.collectAudioFiles('room-1', [mockAudioRegion]);

      expect(result).toHaveLength(1);
      expect(result[0]?.audioFileId).toBe('file-123');
      expect(result[0]?.regionId).toBe('file-123');
      expect(result[0]?.fileName).toBe('file-123.ogg');
      expect(result[0]?.buffer).toEqual(mockBuffer);
    });

    it('should deduplicate audio files by audioFileId', async () => {
      const mockBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockBuffer);

      const region2: AudioRegion = {
        ...mockAudioRegion,
        id: 'region-3',
        audioFileId: 'file-123', // Same audioFileId
      };

      const result = await service.collectAudioFiles('room-1', [mockAudioRegion, region2]);

      // Should only collect once due to deduplication
      expect(result).toHaveLength(1);
    });

    it('should handle missing audio files gracefully', async () => {
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(false);

      const result = await service.collectAudioFiles('room-1', [mockAudioRegion]);

      // Should return empty array if file not found
      expect(result).toHaveLength(0);
    });

    it('should skip regions without audioFileId', async () => {
      const { audioFileId, ...regionWithoutFileId } = mockAudioRegion;

      const result = await service.collectAudioFiles('room-1', [regionWithoutFileId as AudioRegion]);

      expect(result).toHaveLength(0);
    });
  });

  describe('deserializeProjectData', () => {
    it('should parse valid project data', () => {
      const projectData: ProjectData = {
        version: PROJECT_SCHEMA_VERSION,
        metadata: {
          name: 'Test Project',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
        project: {
          bpm: 120,
          timeSignature: { numerator: 4, denominator: 4 },
          gridDivision: 16,
          loop: { enabled: false, start: 0, end: 0 },
          isMetronomeEnabled: true,
          snapToGrid: true,
        },
        scale: { rootNote: 'C', scale: 'major' },
        tracks: [],
        regions: [],
        effectChains: {},
        synthStates: {},
        markers: [],
      };

      const result = service.deserializeProjectData(projectData);

      expect(result.tracks).toEqual(projectData.tracks);
      expect(result.regions).toEqual(projectData.regions);
      expect(result.bpm).toBe(projectData.project.bpm);
    });

    it('should round-trip a populated chordTrack through serialize/deserialize (DEV-279 P1)', () => {
      const stateWithChordTrack = {
        ...mockRoomState,
        chordTrack: {
          id: 'chord-track-1',
          projectId: 'project-1',
          blocks: [
            {
              id: 'block-1',
              start: 0,
              duration: 4,
              chord: { kind: 'diatonic' as const, degree: 1 },
              color: '#ff0000',
            },
          ],
        },
      };

      const serialized = service.serializeRoomState(stateWithChordTrack, 'Test');
      const result = service.deserializeProjectData(serialized);

      expect(result.chordTrack.blocks).toHaveLength(1);
      expect(result.chordTrack.blocks[0]).toEqual(stateWithChordTrack.chordTrack.blocks[0]);
    });

    it('should backward-compat a project saved without chordTrack to { blocks: [] } (DEV-279 P1)', () => {
      const projectData: ProjectData = {
        version: PROJECT_SCHEMA_VERSION,
        metadata: {
          name: 'Legacy Project',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
        project: {
          bpm: 120,
          timeSignature: { numerator: 4, denominator: 4 },
          gridDivision: 16,
          loop: { enabled: false, start: 0, end: 0 },
          isMetronomeEnabled: true,
          snapToGrid: true,
        },
        scale: { rootNote: 'C', scale: 'major' },
        tracks: [],
        regions: [],
        effectChains: {},
        synthStates: {},
        markers: [],
        // No chordTrack field — simulates a project saved before this field existed.
      };

      const result = service.deserializeProjectData(projectData);

      expect(result.chordTrack).toBeDefined();
      expect(result.chordTrack.blocks).toEqual([]);
    });
  });

  describe('instrumentParamsStates persistence (DEV-301 — non-synth instrument pre-gain)', () => {
    it('serializeRoomState carries instrumentParamsStates through from room state, mirroring synthStates', () => {
      const stateWithInstrumentParams = {
        ...mockRoomState,
        instrumentParamsStates: { 'track-1': { volume: -9 } },
      };

      const result = service.serializeRoomState(stateWithInstrumentParams, 'Test');

      expect(result.instrumentParamsStates).toEqual({ 'track-1': { volume: -9 } });
    });

    it('serializeRoomState omits instrumentParamsStates when room state has none (backward compatible, no degenerate empty key)', () => {
      // mockRoomState never sets instrumentParamsStates — a room that never touched a
      // non-synth instrument's pre-gain.
      const result = service.serializeRoomState(mockRoomState, 'Test');

      expect(result.instrumentParamsStates).toBeUndefined();
    });

    it('round-trips instrumentParamsStates through serializeRoomState -> deserializeProjectData', () => {
      const stateWithInstrumentParams = {
        ...mockRoomState,
        instrumentParamsStates: { 'track-1': { volume: -9 } },
      };

      const serialized = service.serializeRoomState(stateWithInstrumentParams, 'Test');
      const result = service.deserializeProjectData(serialized);

      expect(result.instrumentParamsStates).toEqual({ 'track-1': { volume: -9 } });
    });

    it('deserializeProjectData loads a pre-DEV-301 project with no instrumentParamsStates key without throwing', () => {
      const legacyProjectData: ProjectData = {
        version: PROJECT_SCHEMA_VERSION,
        metadata: {
          name: 'Legacy Project',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
        project: {
          bpm: 120,
          timeSignature: { numerator: 4, denominator: 4 },
          gridDivision: 16,
          loop: { enabled: false, start: 0, end: 0 },
          isMetronomeEnabled: true,
          snapToGrid: true,
        },
        scale: { rootNote: 'C', scale: 'major' },
        tracks: [],
        regions: [],
        effectChains: {},
        synthStates: {},
        markers: [],
        // No instrumentParamsStates field — simulates a project saved before DEV-301.
      };
      expect(legacyProjectData).not.toHaveProperty('instrumentParamsStates');

      expect(() => service.deserializeProjectData(legacyProjectData)).not.toThrow();
      const result = service.deserializeProjectData(legacyProjectData);
      expect(result.instrumentParamsStates).toBeUndefined();
    });
  });

  describe('computeProjectJsonHash', () => {
    it('should compute a SHA-256 hash of project data', () => {
      const projectData: ProjectData = {
        version: PROJECT_SCHEMA_VERSION,
        metadata: {
          name: 'Test',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
        project: {
          bpm: 120,
          timeSignature: { numerator: 4, denominator: 4 },
          gridDivision: 16,
          loop: { enabled: false, start: 0, end: 0 },
          isMetronomeEnabled: false,
          snapToGrid: true,
        },
        scale: { rootNote: 'C', scale: 'major' },
        tracks: [],
        regions: [],
        effectChains: {},
        synthStates: {},
        markers: [],
      };

      const hash = service.computeProjectJsonHash(projectData);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      // SHA-256 hex is always 64 characters
      expect(hash).toHaveLength(64);
    });

    it('should return different hashes for different data', () => {
      const base: ProjectData = {
        version: PROJECT_SCHEMA_VERSION,
        metadata: {
          name: 'Test',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
        project: {
          bpm: 120,
          timeSignature: { numerator: 4, denominator: 4 },
          gridDivision: 16,
          loop: { enabled: false, start: 0, end: 0 },
          isMetronomeEnabled: false,
          snapToGrid: true,
        },
        scale: { rootNote: 'C', scale: 'major' },
        tracks: [],
        regions: [],
        effectChains: {},
        synthStates: {},
        markers: [],
      };

      const hash1 = service.computeProjectJsonHash(base);

      const modified = {
        ...base,
        project: { ...base.project, bpm: 130 },
      };
      const hash2 = service.computeProjectJsonHash(modified);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('serializeCompleteProject', () => {
    it('should serialize project with audio files', async () => {
      const mockBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockBuffer);

      const result = await service.serializeCompleteProject(mockRoomState, 'Test Project');

      expect(result.projectData).toBeDefined();
      expect(result.projectData.metadata.name).toBe('Test Project');
      expect(result.audioFiles).toHaveLength(1);
    });

    it('should handle rooms with no audio regions', async () => {
      const stateWithoutAudio = {
        ...mockRoomState,
        regions: [mockMidiRegion],
      };

      const result = await service.serializeCompleteProject(stateWithoutAudio, 'Test');

      expect(result.audioFiles).toHaveLength(0);
    });
  });
});

describe('ProjectSerializationService — version gate (DEV-310)', () => {
  let service: ProjectSerializationService;
  let mockAudioStorage: jest.Mocked<AudioRegionStorageService>;

  const mockState: ArrangeRoomState = {
    roomId: 'room-1',
    roomType: 'arrange',
    tracks: [],
    regions: [],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    scale: { rootNote: 'C', scale: 'major' },
    occupancy: new Map(),
    selectedTrackId: null,
    selectedRegionIds: [],
    synthStates: {},
    effectChains: {},
    markers: [],
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date(),
    chordTrack: { id: 'chord-track-1', projectId: 'project-1', blocks: [] },
  };

  beforeEach(() => {
    mockAudioStorage = {
      getAudioPath: jest.fn((roomId, regionId) => `/record-audio/${roomId}/${regionId}.webm`),
      audioExists: jest.fn().mockResolvedValue(true),
      resolveRegionFilePath: jest.fn((roomId, regionId) => `/record-audio/${roomId}/${regionId}.ogg`),
    } as unknown as jest.Mocked<AudioRegionStorageService>;

    service = new ProjectSerializationService(mockAudioStorage);
  });

  it('serializeRoomState stamps PROJECT_SCHEMA_VERSION, not a hardcoded literal', () => {
    const result = service.serializeRoomState(mockState, 'Test Project');
    expect(result.version).toBe(PROJECT_SCHEMA_VERSION);
  });

  // DEV-295: the gate now refuses only files from a NEWER build — a pre-epic ("1.0.0") or
  // older-integer (v4) file is accepted (no reset logic here; that's FE-only).
  it('deserializeProjectData accepts a pre-epic "1.0.0"-stamped file', () => {
    const legacyData = { ...mockProjectData, version: '1.0.0' } as unknown as ProjectData;
    expect(() => service.deserializeProjectData(legacyData)).not.toThrow();
  });

  it('deserializeProjectData accepts a file stamped with an older integer version (v4)', () => {
    const olderIntData = { ...mockProjectData, version: PROJECT_SCHEMA_VERSION - 1 };
    expect(() => service.deserializeProjectData(olderIntData)).not.toThrow();
  });

  it('deserializeProjectData throws ProjectVersionMismatchError for a file from a NEWER build', () => {
    const futureData = { ...mockProjectData, version: PROJECT_SCHEMA_VERSION + 1 };
    expect(() => service.deserializeProjectData(futureData)).toThrow(ProjectVersionMismatchError);
  });

  it('deserializeProjectData succeeds normally for a current-version file', () => {
    const current = { ...mockProjectData, version: PROJECT_SCHEMA_VERSION };
    expect(() => service.deserializeProjectData(current)).not.toThrow();
  });
});
