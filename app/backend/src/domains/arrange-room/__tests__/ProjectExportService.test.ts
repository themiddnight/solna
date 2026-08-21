/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { ProjectExportService } from '../domain/services/ProjectExportService';
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';
import type { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomState, Track, AudioRegion, MidiRegion } from '../domain/models/ArrangeRoomState';
import { UNITY_DB, toDecibels } from '../domain/models/ArrangeRoomState';
import JSZip from 'jszip';
import { Midi } from '@tonejs/midi';

jest.mock('../application/ArrangeRoomStateService');
jest.mock('../infrastructure/storage/AudioRegionStorageService');
jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('ProjectExportService', () => {
  let service: ProjectExportService;
  let mockStateService: jest.Mocked<ArrangeRoomStateService>;
  let mockAudioStorage: jest.Mocked<AudioRegionStorageService>;

  const mockMidiTrack: Track = {
    id: 'track-1',
    name: 'Piano',
    type: 'midi',
    instrumentId: 'piano',
    instrumentCategory: 'keys',
    volume: UNITY_DB, // DEV-303: generic default test-fixture volume, was linear 0.8
    pan: 0,
    color: '#ff0000',
    regionIds: ['region-1'],
  };

  const mockAudioTrack: Track = {
    id: 'track-2',
    name: 'Vocals',
    type: 'audio',
    volume: toDecibels(-3), // DEV-303: distinct fixture value from mockMidiTrack (dB, not a leftover linear/percent value)
    pan: 0,
    color: '#00ff00',
    regionIds: ['region-2'],
  };

  const mockMidiRegion: MidiRegion = {
    id: 'region-1',
    type: 'midi',
    trackId: 'track-1',
    start: 0,
    length: 4,
    notes: [
      { id: 'note-1', pitch: 60, start: 0, duration: 1, velocity: 100 },
      { id: 'note-2', pitch: 64, start: 1, duration: 1, velocity: 90 },
      { id: 'note-3', pitch: 67, start: 2, duration: 1, velocity: 85 },
    ],
    sustainEvents: [],
    name: 'MIDI Region 1',
    color: '#ff0000',
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
    color: '#00ff00',
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
    tracks: [mockMidiTrack, mockAudioTrack],
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
    chordTrack: { id: 'chord-track-1', projectId: 'project-1', blocks: [] },
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

    service = new ProjectExportService(mockStateService, mockAudioStorage);
  });

  describe('exportProjectAsCollab', () => {
    it('should create a ZIP file with project.json and audio files', async () => {
      const mockAudioBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockAudioBuffer);

      const zipBuffer = await service.exportProjectAsCollab('room-1', 'Test Project');

      expect(zipBuffer).toBeInstanceOf(Buffer);

      // Verify ZIP contents
      const zip = await JSZip.loadAsync(zipBuffer);
      const files = Object.keys(zip.files);
      
      const hasProjectJson = files.includes('project.json');
      const hasAudioFile = files.some(f => f.startsWith('audio/'));

      expect(hasProjectJson).toBe(true);
      expect(hasAudioFile).toBe(true);
    });

    it('should include correct project data in project.json', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const zipBuffer = await service.exportProjectAsCollab('room-1', 'Test Project');
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const projectJsonFile = zip.file('project.json');
      const projectJsonContent = await projectJsonFile!.async('string');
      const projectData = JSON.parse(projectJsonContent);

      expect(projectData.metadata.name).toBe('Test Project');
      expect(projectData.project.bpm).toBe(120);
      expect(projectData.tracks).toHaveLength(2);
      expect(projectData.regions).toHaveLength(2);
    });

    it('should handle rooms with no audio regions', async () => {
      const stateWithoutAudio = {
        ...mockRoomState,
        regions: [mockMidiRegion],
      };
void mockStateService.getState.mockResolvedValue(stateWithoutAudio);

      const zipBuffer = await service.exportProjectAsCollab('room-1', 'Test');
      const zip = await JSZip.loadAsync(zipBuffer);
      const files = Object.keys(zip.files);

      const audioFiles = files.filter(f => f.startsWith('audio/') && !f.endsWith('/'));
      expect(audioFiles).toHaveLength(0);
    });

    it('should throw error if room state not found', async () => {
void mockStateService.getState.mockResolvedValue(null);

      await expect(
        service.exportProjectAsCollab('non-existent', 'Test')
      ).rejects.toThrow('Room state not found');
    });
  });

  describe('exportProjectStems', () => {
    it('should create a ZIP with MIDI, audio, and manifest.json', async () => {
      const mockAudioBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockAudioBuffer);

      const zipBuffer = await service.exportProjectStems('room-1', 'Test Project');

      expect(zipBuffer).toBeInstanceOf(Buffer);

      const zip = await JSZip.loadAsync(zipBuffer);
      const files = Object.keys(zip.files);

      const hasMidiFile = files.some(f => f.endsWith('.mid'));
      const hasAudioFile = files.some(f => f.startsWith('audio/') && !f.endsWith('/'));
      const hasManifest = files.includes('manifest.json');

      expect(hasMidiFile).toBe(true);
      expect(hasAudioFile).toBe(true);
      expect(hasManifest).toBe(true);
    });

    it('should include correct manifest data', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const zipBuffer = await service.exportProjectStems('room-1', 'Test Project');
      const zip = await JSZip.loadAsync(zipBuffer);

      const manifestFile = zip.file('manifest.json');
      const manifestContent = await manifestFile!.async('string');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.version).toBe(PROJECT_SCHEMA_VERSION);
      expect(manifest.projectName).toBe('Test Project');
      expect(manifest.bpm).toBe(120);
      expect(manifest.timeSignature).toEqual({ numerator: 4, denominator: 4 });
      expect(manifest.tracks).toHaveLength(2);
    });

    it('stem-export manifest.json stamps the shared PROJECT_SCHEMA_VERSION (DEV-310, consistency only)', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const zipBuffer = await service.exportProjectStems('room-1', 'Test Project');
      const zip = await JSZip.loadAsync(zipBuffer);

      const manifestFile = zip.file('manifest.json');
      const manifestContent = await manifestFile!.async('string');
      const manifestJson = JSON.parse(manifestContent);

      expect(manifestJson.version).toBe(PROJECT_SCHEMA_VERSION);
    });

    it('should create separate MIDI files per track', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('audio'));

      const zipBuffer = await service.exportProjectStems('room-1', 'Test');
      const zip = await JSZip.loadAsync(zipBuffer);
      const files = Object.keys(zip.files);

      const midiFiles = files.filter(f => f.endsWith('.mid'));
      expect(midiFiles.length).toBeGreaterThan(0);
    });

    it('should handle projects with only MIDI tracks', async () => {
      const stateWithOnlyMidi = {
        ...mockRoomState,
        tracks: [mockMidiTrack],
        regions: [mockMidiRegion],
      };
void mockStateService.getState.mockResolvedValue(stateWithOnlyMidi);

      const zipBuffer = await service.exportProjectStems('room-1', 'Test');
      const zip = await JSZip.loadAsync(zipBuffer);
      const files = Object.keys(zip.files);

      const hasMidiFile = files.some(f => f.endsWith('.mid'));
      expect(hasMidiFile).toBe(true);
    });

    it('should handle projects with only audio tracks', async () => {
      const mockAudioBuffer = Buffer.from('audio data');
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(mockAudioBuffer);

      const stateWithOnlyAudio = {
        ...mockRoomState,
        tracks: [mockAudioTrack],
        regions: [mockAudioRegion],
      };
void mockStateService.getState.mockResolvedValue(stateWithOnlyAudio);

      const zipBuffer = await service.exportProjectStems('room-1', 'Test');
      const zip = await JSZip.loadAsync(zipBuffer);
      const files = Object.keys(zip.files);

      const hasAudioFile = files.some(f => f.startsWith('audio/') && !f.endsWith('/'));
      expect(hasAudioFile).toBe(true);
    });
  });

  describe('convertToMIDI', () => {
    const readGeneratedMidi = async (): Promise<Midi> => {
      const zipBuffer = await service.exportProjectStems('room-1', 'Test');
      const zip = await JSZip.loadAsync(zipBuffer);
      const midiFile = zip.file('midi/Piano_MIDI Region 1.mid');
      const midiBuffer = await midiFile!.async('nodebuffer');
      return new Midi(midiBuffer);
    };

    it('should convert MIDI region to buffer', async () => {
      const midi = await readGeneratedMidi();
      expect(midi.tracks).toHaveLength(1);
      expect(midi.tracks[0]!.notes).toHaveLength(mockMidiRegion.notes.length);
    });

    it('should handle regions with multiple notes', async () => {
      const midi = await readGeneratedMidi();
      const pitches = midi.tracks[0]!.notes.map((n) => n.midi).sort((a, b) => a - b);
      expect(pitches).toEqual(mockMidiRegion.notes.map((n) => n.pitch).sort((a, b) => a - b));
    });

    it('should apply correct BPM to MIDI file', async () => {
      const midi = await readGeneratedMidi();
      expect(midi.header.tempos[0]?.bpm).toBeCloseTo(mockRoomState.bpm, 1);
    });
  });

  describe('error handling', () => {
    it('should handle missing audio files gracefully', async () => {
      jest.spyOn(require('fs').promises, 'readFile').mockRejectedValue(new Error('File not found'));

      // Should not throw, just skip missing files
      const zipBuffer = await service.exportProjectAsCollab('room-1', 'Test');
      expect(zipBuffer).toBeInstanceOf(Buffer);
    });

    it('should throw error for invalid room state', async () => {
void mockStateService.getState.mockResolvedValue(null);

      await expect(
        service.exportProjectStems('invalid', 'Test')
      ).rejects.toThrow();
    });
  });
});
