/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { ProjectSaveService } from '../domain/services/ProjectSaveService';
import { ProjectManifestService } from '../domain/services/ProjectManifestService';
import { ProjectSerializationService } from '../domain/services/ProjectSerializationService';
import type { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '../infrastructure/storage/AudioRegionStorageService';
import type { ProjectStorageService } from '../infrastructure/storage/ProjectStorageService';
import type { ArrangeRoomState, Track, AudioRegion, MidiRegion } from '../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';
import { createHash } from 'crypto';
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';

jest.mock('../application/ArrangeRoomStateService');
jest.mock('../infrastructure/storage/AudioRegionStorageService');
jest.mock('../infrastructure/storage/ProjectStorageService');
jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('ProjectSaveService', () => {
  let service: ProjectSaveService;
  let mockStateService: jest.Mocked<ArrangeRoomStateService>;
  let mockAudioStorage: jest.Mocked<AudioRegionStorageService>;
  let mockProjectStorage: jest.Mocked<ProjectStorageService>;

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
    scale: { rootNote: 'C', scale: 'major' },
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

    mockAudioStorage = {
      getAudioPath: jest.fn((roomId, regionId) => `/record-audio/${roomId}/${regionId}.webm`),
      audioExists: jest.fn().mockResolvedValue(true),
      resolveRegionFilePath: jest.fn((roomId, regionId) => `/record-audio/${roomId}/${regionId}.ogg`),
    } as unknown as jest.Mocked<AudioRegionStorageService>;

    mockProjectStorage = {
      saveProjectFiles: jest.fn().mockResolvedValue(undefined),
      replaceProjectFilesSafely: jest.fn().mockResolvedValue(undefined),
      getManifest: jest.fn().mockResolvedValue(null),
      saveManifest: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProjectStorageService>;

    service = new ProjectSaveService(mockStateService, mockAudioStorage, mockProjectStorage);
  });

  describe('saveProjectFromRoom', () => {
    it('should save project from room state to Backblaze', async () => {
      const mockAudioBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockAudioBuffer);

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test Project');

      expect(mockStateService.getState).toHaveBeenCalledWith('room-1');
      expect(mockProjectStorage.saveProjectFiles).toHaveBeenCalled();
    });

    it('should use provided project name', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'My Custom Name');

      const saveCall = mockProjectStorage.saveProjectFiles.mock.calls[0];
      expect(saveCall).toBeDefined();
      const projectJson = saveCall![2].projectJson;
      const projectData = JSON.parse(projectJson);

      expect(projectData.metadata.name).toBe('My Custom Name');
    });

    it('should default to "Untitled Project" if no name provided', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1');

      const saveCall = mockProjectStorage.saveProjectFiles.mock.calls[0];
      expect(saveCall).toBeDefined();
      const projectJson = saveCall![2].projectJson;
      const projectData = JSON.parse(projectJson);

      expect(projectData.metadata.name).toBe('Untitled Project');
    });

    it('should collect and save audio files', async () => {
      const mockAudioBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockAudioBuffer);

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test');

      const saveCall = mockProjectStorage.saveProjectFiles.mock.calls[0];
      expect(saveCall).toBeDefined();
      const audioFiles = saveCall![2].audioFiles;

      expect(audioFiles).toHaveLength(1);
      expect(audioFiles?.[0]?.fileName).toBe('file-123.ogg');
    });

    it('should handle rooms with no audio regions', async () => {
      const stateWithoutAudio = {
        ...mockRoomState,
        regions: [mockMidiRegion],
      };
void mockStateService.getState.mockResolvedValue(stateWithoutAudio);

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test');

      const saveCall = mockProjectStorage.saveProjectFiles.mock.calls[0];
      expect(saveCall).toBeDefined();
      const audioFiles = saveCall![2].audioFiles;

      expect(audioFiles).toHaveLength(0);
    });

    it('should throw error if room state not found', async () => {
void mockStateService.getState.mockResolvedValue(null);

      await expect(
        service.saveProjectFromRoom('non-existent', 'project-1', 'user-1', 'Test')
      ).rejects.toThrow('Room state not found');
    });

    it('should pass correct parameters to ProjectStorageService', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      await service.saveProjectFromRoom('room-1', 'project-123', 'user-456', 'Test Project');

      expect(mockProjectStorage.saveProjectFiles).toHaveBeenCalledWith(
        'user-456',
        'project-123',
        expect.objectContaining({
          projectJson: expect.any(String),
          audioFiles: expect.any(Array),
        })
      );
    });

    it('should use safe replacement path for existing project saves', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));
      mockProjectStorage.getManifest.mockResolvedValue(null);

      await service.saveProjectFromRoom('room-1', 'project-123', 'user-456', 'Test Project', {
        replaceExisting: true,
      });

      expect(mockProjectStorage.replaceProjectFilesSafely).toHaveBeenCalledWith(
        'user-456',
        'project-123',
        expect.objectContaining({
          projectJson: expect.any(String),
          audioFiles: expect.any(Array),
        })
      );
      expect(mockProjectStorage.saveProjectFiles).not.toHaveBeenCalled();
    });

    it('should invoke onProgress callback at each save step', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const progressSteps: Array<{ step: string; detail?: unknown }> = [];
      const onProgress = jest.fn((step: string, detail?: unknown) => {
        progressSteps.push({ step, detail });
      });

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test', {
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();

      // Must include the main save phases
      const steps = progressSteps.map((p) => p.step);
      expect(steps).toContain('preparing');
      expect(steps).toContain('saving_data');
      expect(steps).toContain('finalizing');
    });

    it('should not fail save when onProgress callback throws', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const explodingCallback = jest.fn(() => {
        throw new Error('callback error');
      });

      await expect(
        service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test', {
          onProgress: explodingCallback,
        })
      ).resolves.toBeUndefined();

      expect(explodingCallback).toHaveBeenCalled();
    });

    it('should handle Backblaze upload errors', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));
void mockProjectStorage.saveProjectFiles.mockRejectedValue(new Error('Upload failed'));

      await expect(
        service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test')
      ).rejects.toThrow('Upload failed');
    });

    it('should serialize complete project data', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test');

      const saveCall = mockProjectStorage.saveProjectFiles.mock.calls[0];
      expect(saveCall).toBeDefined();
      const projectJson = saveCall![2].projectJson;
      const projectData = JSON.parse(projectJson);

      expect(projectData.version).toBe(PROJECT_SCHEMA_VERSION);
      expect(projectData.project.bpm).toBe(120);
      expect(projectData.tracks).toHaveLength(1);
      expect(projectData.regions).toHaveLength(2);
      expect(projectData.scale).toEqual({ rootNote: 'C', scale: 'major' });
    });

    it('should include manifest in save call', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      await service.saveProjectFromRoom('room-1', 'project-1', 'user-1', 'Test Project');

      expect(mockProjectStorage.saveProjectFiles).toHaveBeenCalledWith(
        'user-1',
        'project-1',
        expect.objectContaining({
          manifest: expect.objectContaining({ version: 1 }),
        })
      );
    });
  });

  describe('createProjectFromRoom', () => {
    it('should create new project with auto-generated ID', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const projectId = await service.createProjectFromRoom('room-1', 'user-1', 'New Project');

      expect(projectId).toBeDefined();
      expect(typeof projectId).toBe('string');
      expect(mockProjectStorage.saveProjectFiles).toHaveBeenCalled();
    });

    it('should generate unique project IDs', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const id1 = await service.createProjectFromRoom('room-1', 'user-1', 'Project 1');
      const id2 = await service.createProjectFromRoom('room-1', 'user-1', 'Project 2');

      expect(id1).not.toBe(id2);
    });
  });

  describe('incremental save', () => {
    let computeProjectJsonHashSpy: jest.SpyInstance;
    let collectAudioFilesSpy: jest.SpyInstance;

    beforeEach(() => {
      computeProjectJsonHashSpy = jest.spyOn(
        ProjectManifestService,
        'computeProjectJsonHash'
      );

      collectAudioFilesSpy = jest.spyOn(
        ProjectSerializationService.prototype,
        'collectAudioFiles'
      );
    });

    afterEach(() => {
      computeProjectJsonHashSpy.mockRestore();
      collectAudioFilesSpy.mockRestore();
    });

    it('skips project.json upload when hash unchanged', async () => {
      const audioFileId = 'file-123';
      computeProjectJsonHashSpy.mockReturnValue('mock-hash');
      collectAudioFilesSpy.mockResolvedValue([
        {
          audioFileId,
          regionId: audioFileId,
          fileName: 'file-123.ogg',
          buffer: Buffer.from('test'),
        },
      ]);
      mockProjectStorage.getManifest.mockResolvedValue({
        version: 1,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
        projectJsonHash: 'mock-hash',
        audioFiles: { [audioFileId]: 'some-audio-hash' },
      });

      await service.saveProjectFromRoom('room-1', 'proj-1', 'user-1', 'Test', {
        replaceExisting: true,
      });

      const callArgs = mockProjectStorage.replaceProjectFilesSafely.mock.calls[0]!;
      expect(callArgs[2].projectJson).toBeUndefined();
    });

    it('skips audio upload when audio hash matches manifest', async () => {
      const audioFileId = 'file-123';
      const testBuffer = Buffer.from('test');
      const knownAudioHash = createHash('sha256').update(testBuffer).digest('hex');

      computeProjectJsonHashSpy.mockReturnValue('new-hash');
      collectAudioFilesSpy.mockResolvedValue([
        {
          audioFileId,
          regionId: audioFileId,
          fileName: 'file-123.ogg',
          buffer: testBuffer,
        },
      ]);
      mockProjectStorage.getManifest.mockResolvedValue({
        version: 1,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
        projectJsonHash: 'old-hash',
        audioFiles: { [audioFileId]: knownAudioHash },
      });

      await service.saveProjectFromRoom('room-1', 'proj-1', 'user-1', 'Test', {
        replaceExisting: true,
      });

      const callArgs = mockProjectStorage.replaceProjectFilesSafely.mock.calls[0]!;
      // projectJson changed (old-hash vs new-hash) so it IS included
      expect(callArgs[2].projectJson).toEqual(expect.any(String));
      // audio hash matches, so no audio files included
      expect(callArgs[2].audioFiles).toHaveLength(0);
    });

    it('deletes orphan audio files no longer referenced', async () => {
      const audioFileId = 'file-123';
      const staleFileId = 'stale-file';
      computeProjectJsonHashSpy.mockReturnValue('new-hash');
      collectAudioFilesSpy.mockResolvedValue([
        {
          audioFileId,
          regionId: audioFileId,
          fileName: 'file-123.ogg',
          buffer: Buffer.from('current audio'),
        },
      ]);
      mockProjectStorage.getManifest.mockResolvedValue({
        version: 1,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
        projectJsonHash: 'old-hash',
        audioFiles: { [audioFileId]: 'audio-hash', [staleFileId]: 'stale-hash' },
      });

      await service.saveProjectFromRoom('room-1', 'proj-1', 'user-1', 'Test', {
        replaceExisting: true,
      });

      const callArgs = mockProjectStorage.replaceProjectFilesSafely.mock.calls[0]!;
      expect(callArgs[2].orphanAudioIds).toContain('stale-file');
    });

    it('uploads only new audio files on first save', async () => {
      computeProjectJsonHashSpy.mockReturnValue('first-hash');
      collectAudioFilesSpy.mockResolvedValue([
        {
          audioFileId: 'file-123',
          regionId: 'file-123',
          fileName: 'file-123.ogg',
          buffer: Buffer.from('test'),
        },
      ]);
      mockProjectStorage.getManifest.mockResolvedValue(null);

      await service.saveProjectFromRoom('room-1', 'proj-1', 'user-1', 'Test');

      expect(mockProjectStorage.saveProjectFiles).toHaveBeenCalledWith(
        'user-1', 'proj-1',
        expect.objectContaining({
          manifest: expect.objectContaining({ version: 1 }),
        })
      );
    });
  });
});
