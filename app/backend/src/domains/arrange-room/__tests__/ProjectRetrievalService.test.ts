import { ProjectRetrievalService } from '../domain/services/ProjectRetrievalService';
import type { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import type { ProjectStorageService } from '../infrastructure/storage/ProjectStorageService';
import type { AudioRegionStorageService } from '../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomState, Track, MidiRegion } from '../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';

jest.mock('../application/ArrangeRoomStateService');
jest.mock('../infrastructure/storage/ProjectStorageService');
jest.mock('../infrastructure/storage/AudioRegionStorageService');
jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('ProjectRetrievalService', () => {
  let service: ProjectRetrievalService;
  let mockStateService: jest.Mocked<ArrangeRoomStateService>;
  let mockProjectStorage: jest.Mocked<ProjectStorageService>;
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

  const mockRoomState: ArrangeRoomState = {
    roomId: 'room-1',
    roomType: 'arrange',
    tracks: [mockTrack],
    regions: [mockMidiRegion],
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

    mockStateService = {
      getState: jest.fn().mockResolvedValue(mockRoomState),
    } as unknown as jest.Mocked<ArrangeRoomStateService>;

    mockProjectStorage = {
      getProject: jest.fn().mockReturnValue(null),
    } as unknown as jest.Mocked<ProjectStorageService>;

    mockAudioStorage = {} as unknown as jest.Mocked<AudioRegionStorageService>;

    service = new ProjectRetrievalService(
      mockStateService,
      mockProjectStorage,
      mockAudioStorage
    );
  });

  describe('getProject', () => {
    it('should retrieve project from Redis state', async () => {
      const result = await service.getProject('room-1');

      expect(result.project).toBeDefined();
      expect(result.project?.project.bpm).toBe(120);
      expect(result.project?.tracks).toHaveLength(1);
    });

    it('should use state.scale not state.ownerScale for arrange rooms', async () => {
      const result = await service.getProject('room-1');

      expect(result.project?.scale).toEqual({ rootNote: 'D', scale: 'minor' });
    });

    it('should default to C major if no scale in state', async () => {
      const { scale: _unusedScale, ...stateWithoutScale } = mockRoomState;
      mockStateService.getState.mockResolvedValue(stateWithoutScale);

      const result = await service.getProject('room-1');

      expect(result.project?.scale).toEqual({ rootNote: 'C', scale: 'major' });
    });

    it('should include metadata from ProjectStorageService', async () => {
      mockProjectStorage.getProject.mockReturnValue({
        projectName: 'Stored Project',
        uploadedBy: 'user-1',
        uploadedAt: new Date('2026-01-01'),
      });

      const result = await service.getProject('room-1');

      // When Redis state exists, it uses metadata from ProjectStorageService
      expect(result.metadata?.projectName).toBe('Stored Project');
      expect(result.metadata?.uploadedBy).toBe('user-1');
    });

    it('should return null if no Redis state', async () => {
      mockStateService.getState.mockResolvedValue(null);

      mockProjectStorage.getProject.mockReturnValue({
        projectName: 'Stored Project',
        uploadedBy: 'user-2',
        uploadedAt: new Date(),
      });

      const result = await service.getProject('room-1');

      // No fallback to ProjectStorageService.projectData anymore
      // ProjectData is always serialized from Redis state
      expect(result.project).toBeNull();
      expect(result.metadata).toBeNull();
    });

    it('should return null if no Redis state exists', async () => {
      mockStateService.getState.mockResolvedValue(null);
      mockProjectStorage.getProject.mockReturnValue(null);

      const result = await service.getProject('room-1');

      expect(result.project).toBeNull();
      expect(result.metadata).toBeNull();
    });

    it('should always use Redis state as single source of truth', async () => {
      mockProjectStorage.getProject.mockReturnValue({
        projectName: 'Stored Metadata',
        uploadedBy: 'user-1',
        uploadedAt: new Date(),
      });

      const result = await service.getProject('room-1');

      // Should use Redis state (BPM 120) and metadata from ProjectStorageService
      expect(result.project?.project.bpm).toBe(120);
      expect(result.metadata?.projectName).toBe('Stored Metadata');
    });
  });

  describe('mapStateToProjectData', () => {
    it('should map ArrangeRoomState to ProjectData format', async () => {
      const result = await service.getProject('room-1');

      expect(result.project?.version).toBe(PROJECT_SCHEMA_VERSION);
      expect(result.project?.metadata).toBeDefined();
      expect(result.project?.project).toBeDefined();
      expect(result.project?.tracks).toBeDefined();
      expect(result.project?.regions).toBeDefined();
    });

    it('should include effect chains', async () => {
      const trackChainKey = 'track:track-1';
      const stateWithEffects: ArrangeRoomState = {
        ...mockRoomState,
        effectChains: {
          [trackChainKey]: {
            type: trackChainKey,
            effects: [],
          },
        },
      };
      mockStateService.getState.mockResolvedValue(stateWithEffects);

      const result = await service.getProject('room-1');

      expect(result.project?.effectChains).toBeDefined();
    });

    it('should include markers', async () => {
      const stateWithMarkers: ArrangeRoomState = {
        ...mockRoomState,
        markers: [
          { id: 'marker-1', position: 16, description: 'Verse', color: '#ff0000' },
        ],
      };
      mockStateService.getState.mockResolvedValue(stateWithMarkers);

      const result = await service.getProject('room-1');

      expect(result.project?.markers).toHaveLength(1);
    });
  });
});
