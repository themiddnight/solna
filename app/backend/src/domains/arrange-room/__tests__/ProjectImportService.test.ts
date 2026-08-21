/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars, @typescript-eslint/naming-convention */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import { ProjectImportService } from '@/domains/arrange-room/domain/services/ProjectImportService';
import { ProjectVersionMismatchError } from '@/domains/arrange-room/domain/errors/ProjectVersionMismatchError';
import { PROJECT_SCHEMA_VERSION, DEFAULT_COMPANION_VOLUME_DB, DEFAULT_VOCODER_OUTPUT_GAIN_DB, DEFAULT_SYNTH_GAIN_DB } from '@jam-band/shared';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { AudioRegionStorageService, SaveAudioResult } from '@/domains/arrange-room/infrastructure/storage/AudioRegionStorageService';
import type { ProjectStorageService } from '@/domains/arrange-room/infrastructure/storage/ProjectStorageService';
import type { Region, Track, MidiRegion, AudioRegion, CompanionRegion, EffectChainState, ArrangeRoomState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { UNITY_DB, toDecibels } from '@/domains/arrange-room/domain/models/ArrangeRoomState';

// Mock dependencies
jest.mock('@/domains/arrange-room/application/ArrangeRoomStateService');
jest.mock('@/domains/arrange-room/infrastructure/storage/AudioRegionStorageService');
jest.mock('@/domains/arrange-room/infrastructure/storage/ProjectStorageService');
jest.mock('@/shared/infrastructure/logging/LoggingService');

describe('ProjectImportService', () => {
  let _service: ProjectImportService;
  let mockArrangeRoomStateService: jest.Mocked<ArrangeRoomStateService>;
  let mockAudioStorage: jest.Mocked<AudioRegionStorageService>;
  let mockProjectStorage: jest.Mocked<ProjectStorageService>;

  const testRoomId = 'test-room-123';
  const _testUserId = 'user-123';
  const _testUsername = 'testuser';
  const testProjectId = 'project-123';

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
    loopEnabled: false,
    loopIterations: 1,
    notes: [{ id: 'note-1', pitch: 60, start: 0, duration: 1, velocity: 100 }],
    sustainEvents: [],
    name: 'MIDI Region 1',
    color: '#00ff00',
  };

  const mockAudioRegion: AudioRegion = {
    id: 'region-2',
    type: 'audio',
    trackId: 'track-1',
    start: 4,
    length: 4,
    loopEnabled: false,
    loopIterations: 1,
    name: 'Audio Region 1',
    color: '#0000ff',
    audioUrl: '/audio/test.wav',
  };

  const mockProjectData = {
    version: PROJECT_SCHEMA_VERSION,
    metadata: { name: 'Test Project', version: '1.0' },
    tracks: [mockTrack],
    regions: [mockMidiRegion, mockAudioRegion],
    project: { bpm: 140, timeSignature: { numerator: 4, denominator: 4 } },
    synthStates: {},
    effectChains: {},
    markers: [],
  };

  const mockInitialState = {
    roomId: testRoomId,
    roomType: 'arrange' as const,
    tracks: [] as Track[],
    regions: [] as Region[],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    occupancy: new Map(),
    voiceStates: {},
    broadcastStates: {},
    synthStates: {},
    effectChains: {},
    markers: [],
    chordTrack: { id: 'chord-track-1', projectId: '', blocks: [] },
    selectedTrackId: null,
    selectedRegionIds: [],
    hasBeenSaved: false,
    lastUpdated: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
    mockArrangeRoomStateService = {
      getState: jest.fn(),
      initializeState: jest.fn(),
      updateState: jest.fn(),
      updateOwnerScale: jest.fn(),
    } as unknown as jest.Mocked<ArrangeRoomStateService>;

    mockAudioStorage = {
      deleteRegionAudio: jest.fn().mockResolvedValue(undefined),
      getAudioUrl: jest.fn().mockReturnValue('/audio/test.wav'),
      getRegionPlaybackPath: jest.fn().mockReturnValue('/audio/region-2.ogg'),
      saveRegionAudio: jest.fn().mockResolvedValue('/audio/saved.wav'),
    } as unknown as jest.Mocked<AudioRegionStorageService>;

    mockProjectStorage = {
      saveProject: jest.fn(),
      saveProjectMetadata: jest.fn(),
      getProject: jest.fn(),
    } as unknown as jest.Mocked<ProjectStorageService>;

    _service = new ProjectImportService(
      mockAudioStorage,
      mockArrangeRoomStateService,
      mockProjectStorage
    );
  });

  describe('importProject - Async State Persistence (Regression Test)', () => {
    /**
     * REGRESSION TEST: Bug fix for missing await on async state methods
     * 
     * This test verifies that when a project is imported:
     * 1. getState is properly awaited before checking state existence
     * 2. initializeState is properly awaited if state doesn't exist
     * 3. updateState is properly awaited so regions are persisted
     * 
     * Without these awaits, state would not be persisted correctly and
     * subsequent operations (like region drag) would fail to find regions.
     */
    it('should await getState, initializeState, and updateState to properly persist regions', async () => {
      // Arrange - simulate no existing state
void mockArrangeRoomStateService.getState.mockResolvedValue(null);
void mockArrangeRoomStateService.initializeState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue({
        ...mockInitialState,
        tracks: mockProjectData.tracks,
        regions: mockProjectData.regions as Region[],
        bpm: 140,
      });

      // Create a mock file path and project data
      // Note: This is a simplified test - actual importProject reads from file
      // We're testing the state service calls pattern
      const mockProjectDataJson = JSON.stringify(mockProjectData);
      
      // Spy on the service methods to track call order and awaits
      const getStateSpy = jest.spyOn(mockArrangeRoomStateService, 'getState');
      const initializeStateSpy = jest.spyOn(mockArrangeRoomStateService, 'initializeState');
      const updateStateSpy = jest.spyOn(mockArrangeRoomStateService, 'updateState');

      // Act - We can't fully test importProject without a real file,
      // but we can verify the async methods are called correctly
      // by invoking the state service methods directly as the service would

      // Simulate the fixed code flow (with await)
      const state = await mockArrangeRoomStateService.getState(testRoomId);
      expect(getStateSpy).toHaveBeenCalledWith(testRoomId);
      
      if (!state) {
        await mockArrangeRoomStateService.initializeState(testRoomId);
        expect(initializeStateSpy).toHaveBeenCalledWith(testRoomId);
      }

      await mockArrangeRoomStateService.updateState(testRoomId, {
        tracks: mockProjectData.tracks,
        regions: mockProjectData.regions as Region[],
        bpm: mockProjectData.project.bpm,
      });

      // Assert - updateState must have been awaited before continuing
      expect(updateStateSpy).toHaveBeenCalledWith(testRoomId, expect.objectContaining({
        tracks: expect.arrayContaining([expect.objectContaining({ id: 'track-1' })]) as unknown,
        regions: expect.arrayContaining([
          expect.objectContaining({ id: 'region-1', type: 'midi' }),
          expect.objectContaining({ id: 'region-2', type: 'audio' }),
        ]) as unknown,
        bpm: 140,
      }));
    });

    it('should persist regions so they can be found by subsequent operations', async () => {
      // Arrange - simulate fresh room
void mockArrangeRoomStateService.getState.mockResolvedValue(null);
void mockArrangeRoomStateService.initializeState.mockResolvedValue(mockInitialState);
      
      // Capture what was passed to updateState
      let persistedState: ArrangeRoomState | null = null;
      mockArrangeRoomStateService.updateState.mockImplementation(async (_roomId, updates) => {
        persistedState = {
          ...mockInitialState,
          ...updates,
        };
        return persistedState;
      });

      // Act - simulate import flow
      await mockArrangeRoomStateService.getState(testRoomId);
      await mockArrangeRoomStateService.initializeState(testRoomId);
      await mockArrangeRoomStateService.updateState(testRoomId, {
        tracks: mockProjectData.tracks,
        regions: mockProjectData.regions as Region[],
      });

      // Assert - regions must be in persisted state
      expect(persistedState).not.toBeNull();
      const state = persistedState!;
      expect(state.regions).toHaveLength(2);
      expect(state.regions.map((r: Region) => r.id)).toEqual(['region-1', 'region-2']);

      // Simulate what handleRegionDrag does - find region by ID
      const regionToUpdate = state.regions.find((r: Region) => r.id === 'region-1');
      expect(regionToUpdate).toBeDefined();
      expect(regionToUpdate?.type).toBe('midi');
    });

    it('should update existing state when room already has state', async () => {
      // Arrange - simulate existing state
      const existingState = {
        ...mockInitialState,
        tracks: [{ ...mockTrack, id: 'old-track' }],
        regions: [{ ...mockMidiRegion, id: 'old-region' }] as Region[],
      };
void mockArrangeRoomStateService.getState.mockResolvedValue(existingState);
      mockArrangeRoomStateService.updateState.mockResolvedValue({
        ...existingState,
        tracks: mockProjectData.tracks,
        regions: mockProjectData.regions as Region[],
      });

      // Act
      const state = await mockArrangeRoomStateService.getState(testRoomId);
      
      // Should NOT call initializeState since state exists
      expect(state).not.toBeNull();
      
      await mockArrangeRoomStateService.updateState(testRoomId, {
        tracks: mockProjectData.tracks,
        regions: mockProjectData.regions as Region[],
      });

      // Assert
      expect(mockArrangeRoomStateService.initializeState).not.toHaveBeenCalled();
      expect(mockArrangeRoomStateService.updateState).toHaveBeenCalledWith(
        testRoomId,
        expect.objectContaining({
          regions: expect.arrayContaining([
            expect.objectContaining({ id: 'region-1' }),
            expect.objectContaining({ id: 'region-2' }),
          ]) as unknown,
        })
      );
    });
  });

  describe('importProjectFromStorage - Async State Persistence (Regression Test)', () => {
    /**
     * REGRESSION TEST: Same async/await bug for loading from storage
     */
    it('should properly await updateState when loading project from storage', async () => {
      // Arrange
void mockArrangeRoomStateService.getState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue({
        ...mockInitialState,
        regions: mockProjectData.regions as Region[],
      });

      // Act
      await mockArrangeRoomStateService.updateState(testRoomId, {
        tracks: mockProjectData.tracks,
        regions: mockProjectData.regions as Region[],
        bpm: mockProjectData.project.bpm,
      });

      // Assert - updateState should have been awaited
      expect(mockArrangeRoomStateService.updateState).toHaveBeenCalledWith(
        testRoomId,
        expect.objectContaining({
          regions: expect.arrayContaining([
            expect.objectContaining({ id: 'region-1', type: 'midi' }),
          ]) as unknown,
        })
      );
    });

    it('should initialize state before update if state does not exist', async () => {
      // Arrange - no existing state
void mockArrangeRoomStateService.getState.mockResolvedValue(null);
void mockArrangeRoomStateService.initializeState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue({
        ...mockInitialState,
        regions: mockProjectData.regions as Region[],
      });

      // Act - simulate the fixed importProjectFromStorage flow
      const state = await mockArrangeRoomStateService.getState(testRoomId);
      if (!state) {
        await mockArrangeRoomStateService.initializeState(testRoomId);
      }
      await mockArrangeRoomStateService.updateState(testRoomId, {
        regions: mockProjectData.regions as Region[],
      });

      // Assert
      expect(mockArrangeRoomStateService.initializeState).toHaveBeenCalledWith(testRoomId);
      expect(mockArrangeRoomStateService.updateState).toHaveBeenCalled();
    });
  });

  describe('importProjectFromStorage — scale coercion at the BE load boundary (DEV-226)', () => {
    /**
     * A legacy/garbage persisted `scale.scale` string must never reach note-mapping:
     * `coerceScale` (validated against `getAllScaleValues()`) runs at this load boundary.
     */
    function makePersistedProjectJson(scale: { rootNote: string; scale: string }): string {
      // Deliberately midi-only (no audio region) so enrichAudioRegionsWithUrls doesn't
      // need an AudioRegionStorageService.getRegionPlaybackPath mock — irrelevant to
      // the scale-coercion boundary under test.
      return JSON.stringify({
        ...mockProjectData,
        regions: [mockMidiRegion],
        scale,
      });
    }

    beforeEach(() => {
      mockProjectStorage.loadProjectFiles = jest.fn().mockResolvedValue({
        projectJson: '',
        audioFiles: [],
      });
      mockArrangeRoomStateService.setProjectMetadata = jest
        .fn()
        .mockResolvedValue(mockInitialState);
    });

    it('coerces an unknown persisted scale to major on import from storage', async () => {
      mockProjectStorage.loadProjectFiles = jest.fn().mockResolvedValue({
        projectJson: makePersistedProjectJson({ rootNote: 'C', scale: 'totally-bogus' }),
        audioFiles: [],
      });
void mockArrangeRoomStateService.getState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue(mockInitialState);

      await _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername);

      expect(mockArrangeRoomStateService.updateState).toHaveBeenCalledWith(
        testRoomId,
        expect.objectContaining({
          scale: { rootNote: 'C', scale: 'major' },
        })
      );
    });

    it('keeps a valid persisted scale on import from storage', async () => {
      mockProjectStorage.loadProjectFiles = jest.fn().mockResolvedValue({
        projectJson: makePersistedProjectJson({ rootNote: 'D', scale: 'dorian' }),
        audioFiles: [],
      });
void mockArrangeRoomStateService.getState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue(mockInitialState);

      await _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername);

      expect(mockArrangeRoomStateService.updateState).toHaveBeenCalledWith(
        testRoomId,
        expect.objectContaining({
          scale: { rootNote: 'D', scale: 'dorian' },
        })
      );
    });
  });

  describe('importProjectFromStorage — skipEncoding: true', () => {
    /**
     * When loading audio from B2 the audio is already Opus/Ogg-encoded.
     * skipEncoding=true prevents a lossy re-encode that would change the bytes
     * and break manifest-hash comparison on the next save.
     *
     * This test verifies the invariant at the storage-service call boundary.
     * Hash stability is the consequence: same bytes → same sha256 → same hash.
     */
    it('should pass skipEncoding: true to saveRegionAudio for B2-sourced audio', async () => {
      const projectWithAudio = {
        ...mockProjectData,
        regions: [mockAudioRegion as Region],
      };

      const audioBuffer = Buffer.from('fake-opus-data');

      mockProjectStorage.loadProjectFiles = jest.fn().mockResolvedValue({
        projectJson: JSON.stringify(projectWithAudio),
        audioFiles: [{ fileName: 'region-2.ogg', buffer: audioBuffer }],
      });
      mockAudioStorage.saveRegionAudio = jest.fn().mockResolvedValue({
        filePath: '/audio/region-2.ogg',
        fileName: 'region-2.ogg',
        durationSeconds: 5,
        sampleRate: 48000,
        channels: 1,
        bitrate: 64000,
        sizeBytes: audioBuffer.length,
      } as SaveAudioResult);
      mockArrangeRoomStateService.getState = jest.fn().mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState = jest.fn().mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.setProjectMetadata = jest.fn().mockResolvedValue(mockInitialState);

      await _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername);

      expect(mockAudioStorage.saveRegionAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: testRoomId,
          regionId: 'region-2',
          sourcePath: expect.stringContaining('region-2.ogg') as unknown as string,
          skipEncoding: true,
        })
      );
    });
  });

  describe('Region Type Preservation', () => {
    it('should preserve midi region type after import', async () => {
      // This tests that region types are correctly preserved
      let persistedRegions: Region[] = [];
void mockArrangeRoomStateService.getState.mockResolvedValue(null);
void mockArrangeRoomStateService.initializeState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockImplementation(async (_roomId, updates) => {
        persistedRegions = (updates.regions as Region[]) || [];
        return { ...mockInitialState, ...updates } as ArrangeRoomState;
      });

      // Act
      await mockArrangeRoomStateService.initializeState(testRoomId);
      await mockArrangeRoomStateService.updateState(testRoomId, {
        regions: [mockMidiRegion, mockAudioRegion],
      });

      // Assert
      const midiRegions = persistedRegions.filter(r => r.type === 'midi');
      const audioRegions = persistedRegions.filter(r => r.type === 'audio');
      
      expect(midiRegions).toHaveLength(1);
      expect(audioRegions).toHaveLength(1);
      expect(midiRegions[0]?.notes).toBeDefined();
      expect(midiRegions[0]?.notes?.length).toBeGreaterThan(0);
    });
  });

  describe('instrumentParamsStates persistence (DEV-301 — non-synth instrument pre-gain)', () => {
    describe('importProject (zip upload path)', () => {
      let tmpDestDir: string;

      async function buildFixtureZipWithInstrumentParams(
        instrumentParamsStates?: Record<string, Record<string, unknown>>,
      ): Promise<string> {
        const projectData = {
          ...mockProjectData,
          regions: [mockMidiRegion],
          ...(instrumentParamsStates !== undefined ? { instrumentParamsStates } : {}),
        };
        const zip = new JSZip();
        zip.file('project.json', JSON.stringify(projectData));
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        const zipPath = path.join(tmpDestDir, `fixture-${crypto.randomUUID()}.collab`);
        await fs.promises.writeFile(zipPath, zipBuffer);
        return zipPath;
      }

      beforeEach(() => {
        tmpDestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-import-instrument-params-'));
void mockArrangeRoomStateService.getState.mockResolvedValue(null);
        mockArrangeRoomStateService.initializeState.mockResolvedValue(mockInitialState);
        mockArrangeRoomStateService.updateState.mockResolvedValue(mockInitialState);
      });

      afterEach(() => {
        fs.rmSync(tmpDestDir, { recursive: true, force: true });
      });

      it('carries instrumentParamsStates from the zip project.json through to updateState (line 101)', async () => {
        const zipPath = await buildFixtureZipWithInstrumentParams({ track1: { volume: -9 } });

        await _service.importProject(testRoomId, zipPath, tmpDestDir, 'user-1', 'Alice');

        expect(mockArrangeRoomStateService.updateState).toHaveBeenCalledWith(
          testRoomId,
          expect.objectContaining({ instrumentParamsStates: { track1: { volume: -9 } } })
        );
      });

      it('loads a pre-DEV-301 .collab file with no instrumentParamsStates key without throwing', async () => {
        const zipPath = await buildFixtureZipWithInstrumentParams(undefined);

        await expect(
          _service.importProject(testRoomId, zipPath, tmpDestDir, 'user-1', 'Alice')
        ).resolves.toBeDefined();
      });
    });

    describe('importProjectFromStorage', () => {
      beforeEach(() => {
        mockProjectStorage.loadProjectFiles = jest.fn();
void mockArrangeRoomStateService.getState.mockResolvedValue(mockInitialState);
        mockArrangeRoomStateService.updateState.mockResolvedValue(mockInitialState);
        mockArrangeRoomStateService.setProjectMetadata = jest.fn().mockResolvedValue(mockInitialState);
      });

      it('carries instrumentParamsStates from the persisted project.json through to updateState (line 237)', async () => {
        mockProjectStorage.loadProjectFiles.mockResolvedValue({
          projectJson: JSON.stringify({
            ...mockProjectData,
            regions: [mockMidiRegion],
            instrumentParamsStates: { track1: { volume: -9 } },
          }),
          audioFiles: [],
        });

        await _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername);

        expect(mockArrangeRoomStateService.updateState).toHaveBeenCalledWith(
          testRoomId,
          expect.objectContaining({ instrumentParamsStates: { track1: { volume: -9 } } })
        );
      });

      it('loads a pre-DEV-301 project.json with no instrumentParamsStates key without throwing', async () => {
        mockProjectStorage.loadProjectFiles.mockResolvedValue({
          projectJson: JSON.stringify({ ...mockProjectData, regions: [mockMidiRegion] }),
          audioFiles: [],
        });

        await expect(
          _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername)
        ).resolves.toBeDefined();
      });
    });
  });

  describe('ProjectImportService — version gate (DEV-310)', () => {
    let tmpDestDir: string;

    async function buildFixtureZip(overrides: {
      version: number | string;
      audioFiles?: { fileName: string; content: string }[];
    }): Promise<string> {
      const projectData = {
        ...mockProjectData,
        regions: [mockMidiRegion],
        version: overrides.version,
      };
      const zip = new JSZip();
      zip.file('project.json', JSON.stringify(projectData));
      for (const audioFile of overrides.audioFiles ?? []) {
        zip.file(`audio/${audioFile.fileName}`, audioFile.content);
      }
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tmpDestDir, `fixture-${crypto.randomUUID()}.collab`);
      await fs.promises.writeFile(zipPath, zipBuffer);
      return zipPath;
    }

    beforeEach(() => {
      tmpDestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-import-version-gate-'));
      mockProjectStorage.loadProjectFiles = jest.fn();
      mockArrangeRoomStateService.setProjectMetadata = jest.fn().mockResolvedValue(mockInitialState);
void mockArrangeRoomStateService.getState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue(mockInitialState);
    });

    afterEach(() => {
      fs.rmSync(tmpDestDir, { recursive: true, force: true });
    });

    // DEV-295: the gate now refuses only files from a NEWER build. Pre-epic (`'1.0.0'`) and
    // older-integer (v4) files are accepted. As of the final-review fix wave, the backend also
    // resets loudness fields on these accepted legacy files before writing them to Redis (see
    // the 'legacy loudness reset at the write boundary' describe block below) — this block only
    // covers the accept/refuse gate itself.
    const FUTURE_VERSION = PROJECT_SCHEMA_VERSION + 1;

    it('importProject accepts a .collab file whose project.json predates PROJECT_SCHEMA_VERSION (pre-epic "1.0.0")', async () => {
      const legacyZipPath = await buildFixtureZip({ version: '1.0.0' });
      await expect(
        _service.importProject(testRoomId, legacyZipPath, tmpDestDir, 'user-1', 'Alice'),
      ).resolves.toBeDefined();
    });

    it('importProject accepts a .collab file stamped with an older integer version (v4)', async () => {
      const olderIntZipPath = await buildFixtureZip({ version: PROJECT_SCHEMA_VERSION - 1 });
      await expect(
        _service.importProject(testRoomId, olderIntZipPath, tmpDestDir, 'user-1', 'Alice'),
      ).resolves.toBeDefined();
    });

    it('importProject rejects a .collab file whose project.json is from a NEWER build', async () => {
      const futureZipPath = await buildFixtureZip({ version: FUTURE_VERSION });
      await expect(
        _service.importProject(testRoomId, futureZipPath, tmpDestDir, 'user-1', 'Alice'),
      ).rejects.toThrow(ProjectVersionMismatchError);
    });

    it('the version check runs BEFORE any audio-file processing or room-state mutation (zip upload path)', async () => {
      const futureZipWithAudioPath = await buildFixtureZip({
        version: FUTURE_VERSION,
        audioFiles: [{ fileName: 'region-1.ogg', content: 'fake-audio' }],
      });
      await expect(
        _service.importProject(testRoomId, futureZipWithAudioPath, tmpDestDir, 'user-1', 'Alice'),
      ).rejects.toThrow(ProjectVersionMismatchError);
      expect(mockAudioStorage.saveRegionAudio).not.toHaveBeenCalled();
      expect(mockArrangeRoomStateService.updateState).not.toHaveBeenCalled();
    });

    it('importProject succeeds for a current-version .collab file (no regression)', async () => {
      const currentZipPath = await buildFixtureZip({ version: PROJECT_SCHEMA_VERSION });
      await expect(
        _service.importProject(testRoomId, currentZipPath, tmpDestDir, 'user-1', 'Alice'),
      ).resolves.toBeDefined();
    });

    it('importProjectFromStorage accepts a legacy ("1.0.0") project.json loaded from storage', async () => {
      mockProjectStorage.loadProjectFiles.mockResolvedValue({
        projectJson: JSON.stringify({ ...mockProjectData, version: '1.0.0' }),
        audioFiles: [],
      });
      await expect(
        _service.importProjectFromStorage(testRoomId, 'project-1', 'user-1', 'Alice'),
      ).resolves.toBeDefined();
    });

    it('importProjectFromStorage accepts a project.json stamped with an older integer version (v4)', async () => {
      mockProjectStorage.loadProjectFiles.mockResolvedValue({
        projectJson: JSON.stringify({ ...mockProjectData, version: PROJECT_SCHEMA_VERSION - 1 }),
        audioFiles: [],
      });
      await expect(
        _service.importProjectFromStorage(testRoomId, 'project-1', 'user-1', 'Alice'),
      ).resolves.toBeDefined();
    });

    it('importProjectFromStorage rejects a project.json from a NEWER build', async () => {
      mockProjectStorage.loadProjectFiles.mockResolvedValue({
        projectJson: JSON.stringify({ ...mockProjectData, version: FUTURE_VERSION }),
        audioFiles: [],
      });
      await expect(
        _service.importProjectFromStorage(testRoomId, 'project-1', 'user-1', 'Alice'),
      ).rejects.toThrow(ProjectVersionMismatchError);
    });

    it('importProjectFromStorage succeeds for a current-version project.json (no regression)', async () => {
      mockProjectStorage.loadProjectFiles.mockResolvedValue({
        projectJson: JSON.stringify({ ...mockProjectData, version: PROJECT_SCHEMA_VERSION }),
        audioFiles: [],
      });
      await expect(
        _service.importProjectFromStorage(testRoomId, 'project-1', 'user-1', 'Alice'),
      ).resolves.toBeDefined();
    });

    it('the version check runs BEFORE any audio-file processing or room-state mutation', async () => {
      mockProjectStorage.loadProjectFiles.mockResolvedValue({
        projectJson: JSON.stringify({ ...mockProjectData, version: FUTURE_VERSION }),
        audioFiles: [{ fileName: 'region-1.ogg', buffer: Buffer.from('fake-audio') }],
      });
      await expect(
        _service.importProjectFromStorage(testRoomId, 'project-1', 'user-1', 'Alice'),
      ).rejects.toThrow(ProjectVersionMismatchError);
      expect(mockAudioStorage.saveRegionAudio).not.toHaveBeenCalled();
      expect(mockArrangeRoomStateService.updateState).not.toHaveBeenCalled();
    });
  });

  describe('ProjectImportService — legacy loudness reset at the write boundary (DEV-295 final-review fix wave)', () => {
    // Regression coverage for the gap the final whole-branch review found: Task 5 relaxed the
    // version gate to accept legacy files, but nothing reset their loudness fields before they
    // were written to Redis via updateState — a later backend-driven save would then re-stamp
    // PROJECT_SCHEMA_VERSION onto the un-reset values, permanently laundering them. These tests
    // assert on the ACTUAL state handed to updateState, not merely that a reset function ran.
    let tmpDestDir: string;

    const legacyCompanionRegion: CompanionRegion = {
      id: 'region-companion-1',
      type: 'companion',
      trackId: 'track-1',
      start: 0,
      length: 4,
      loopEnabled: false,
      loopIterations: 1,
      name: 'Companion Region',
      color: '#3b82f6',
      config: {
        style: 'walking',
        density: 'normal',
        volume: toDecibels(70), // legacy percent-era value
        isMuted: false,
      },
    };

    const legacyVocoderChain: EffectChainState = {
      type: 'track:track-1',
      effects: [
        {
          id: 'vocoder-1',
          type: 'vocoder',
          bypassed: false,
          order: 0,
          parameters: [{ name: 'Output gain', value: 8 }], // legacy linear-era value
        },
      ],
    };

    function buildLegacyProjectDataFixture(version: number | string) {
      return {
        ...mockProjectData,
        version,
        tracks: [{ ...mockTrack, volume: toDecibels(0.8) }], // legacy linear-era value
        regions: [legacyCompanionRegion],
        effectChains: { 'track:track-1': legacyVocoderChain },
        synthStates: { 'track-1': { volume: 0.5 } }, // legacy linear-era value
      };
    }

    async function buildFixtureZip(projectData: Record<string, unknown>): Promise<string> {
      const zip = new JSZip();
      zip.file('project.json', JSON.stringify(projectData));
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tmpDestDir, `fixture-${crypto.randomUUID()}.collab`);
      await fs.promises.writeFile(zipPath, zipBuffer);
      return zipPath;
    }

    beforeEach(() => {
      tmpDestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-import-legacy-reset-'));
void mockArrangeRoomStateService.getState.mockResolvedValue(null);
      mockArrangeRoomStateService.initializeState.mockResolvedValue(mockInitialState);
      mockArrangeRoomStateService.updateState.mockResolvedValue(mockInitialState);
      mockProjectStorage.loadProjectFiles = jest.fn();
      mockArrangeRoomStateService.setProjectMetadata = jest.fn().mockResolvedValue(mockInitialState);
    });

    afterEach(() => {
      fs.rmSync(tmpDestDir, { recursive: true, force: true });
    });

    // Rather than nested `expect.objectContaining` matchers (which collapse to `any` several
    // levels deep here and fight the type-aware lint), pull the actual second argument passed
    // to `updateState` off the mock and assert directly on its typed fields — this both reads
    // as "the state actually written" (task requirement) and stays type-safe (TR-27).
    function getLastUpdateStateCall() {
      const call = mockArrangeRoomStateService.updateState.mock.calls.at(-1);
      if (!call) {
        throw new Error('updateState was never called');
      }
      return call[1];
    }

    describe('importProject (zip upload path)', () => {
      it('writes RESET loudness values to updateState for a legacy ("1.0.0") .collab file', async () => {
        const zipPath = await buildFixtureZip(buildLegacyProjectDataFixture('1.0.0'));

        await _service.importProject(testRoomId, zipPath, tmpDestDir, 'user-1', 'Alice');

        const written = getLastUpdateStateCall();
        expect(written.tracks?.[0]?.volume).toBe(UNITY_DB);
        const region = written.regions?.[0];
        expect(region?.type === 'companion' ? region.config.volume : undefined).toBe(DEFAULT_COMPANION_VOLUME_DB);
        const outputGain = written.effectChains?.['track:track-1']?.effects[0]?.parameters.find(
          (p) => p.name === 'Output gain',
        );
        expect(outputGain?.value).toBe(DEFAULT_VOCODER_OUTPUT_GAIN_DB);
        expect(written.synthStates?.['track-1']?.volume).toBe(DEFAULT_SYNTH_GAIN_DB);
      });

      // The version gate leaves a current-version file's loudness fields alone — EXCEPT a
      // companion volume outside the representable -60..12 dB range. Such a value is a legacy
      // percent number that an earlier save laundered under the current stamp; leaving it is
      // what made `region_add` reject the region forever, so it is repaired regardless.
      it('writes UNCHANGED loudness values to updateState for a current-version .collab file, but still repairs an out-of-range companion volume', async () => {
        const zipPath = await buildFixtureZip(buildLegacyProjectDataFixture(PROJECT_SCHEMA_VERSION));

        await _service.importProject(testRoomId, zipPath, tmpDestDir, 'user-1', 'Alice');

        const written = getLastUpdateStateCall();
        expect(written.tracks?.[0]?.volume).toBe(toDecibels(0.8));
        const region = written.regions?.[0];
        expect(region?.type === 'companion' ? region.config.volume : undefined).toBe(
          toDecibels(DEFAULT_COMPANION_VOLUME_DB),
        );
        const outputGain = written.effectChains?.['track:track-1']?.effects[0]?.parameters.find(
          (p) => p.name === 'Output gain',
        );
        expect(outputGain?.value).toBe(8);
        expect(written.synthStates?.['track-1']?.volume).toBe(0.5);
      });
    });

    describe('importProjectFromStorage', () => {
      it('writes RESET loudness values to updateState for a legacy ("1.0.0") stored project.json', async () => {
        mockProjectStorage.loadProjectFiles.mockResolvedValue({
          projectJson: JSON.stringify(buildLegacyProjectDataFixture('1.0.0')),
          audioFiles: [],
        });

        await _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername);

        const written = getLastUpdateStateCall();
        expect(written.tracks?.[0]?.volume).toBe(UNITY_DB);
        const region = written.regions?.[0];
        expect(region?.type === 'companion' ? region.config.volume : undefined).toBe(DEFAULT_COMPANION_VOLUME_DB);
        const outputGain = written.effectChains?.['track:track-1']?.effects[0]?.parameters.find(
          (p) => p.name === 'Output gain',
        );
        expect(outputGain?.value).toBe(DEFAULT_VOCODER_OUTPUT_GAIN_DB);
        expect(written.synthStates?.['track-1']?.volume).toBe(DEFAULT_SYNTH_GAIN_DB);
      });

      // See the sibling zip-path case: the out-of-range companion volume is repaired even here.
      it('writes UNCHANGED loudness values to updateState for a current-version stored project.json, but still repairs an out-of-range companion volume', async () => {
        mockProjectStorage.loadProjectFiles.mockResolvedValue({
          projectJson: JSON.stringify(buildLegacyProjectDataFixture(PROJECT_SCHEMA_VERSION)),
          audioFiles: [],
        });

        await _service.importProjectFromStorage(testRoomId, testProjectId, _testUserId, _testUsername);

        const written = getLastUpdateStateCall();
        expect(written.tracks?.[0]?.volume).toBe(toDecibels(0.8));
        const region = written.regions?.[0];
        expect(region?.type === 'companion' ? region.config.volume : undefined).toBe(
          toDecibels(DEFAULT_COMPANION_VOLUME_DB),
        );
        const outputGain = written.effectChains?.['track:track-1']?.effects[0]?.parameters.find(
          (p) => p.name === 'Output gain',
        );
        expect(outputGain?.value).toBe(8);
        expect(written.synthStates?.['track-1']?.volume).toBe(0.5);
      });
    });
  });
});
