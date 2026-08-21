import JSZip from 'jszip';
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';
import type { MidiRegion, AudioRegion } from '../models/ArrangeRoomState';
import { ProjectSerializationService } from './ProjectSerializationService';
import type { ArrangeRoomStateService } from '../../application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import MidiWriter from 'midi-writer-js';

/**
 * Service for exporting projects in various formats
 * - .collab format (ZIP with project.json + audio files)
 * - stem package format (ZIP with MIDI files + audio files + manifest.json)
 */
export class ProjectExportService {
  private readonly serializationService: ProjectSerializationService;

  constructor(
    private readonly arrangeRoomStateService: ArrangeRoomStateService,
    private readonly audioStorage: AudioRegionStorageService
  ) {
    this.serializationService = new ProjectSerializationService(audioStorage);
  }

  /**
   * Export project as .collab file (ZIP format)
   */
  async exportProjectAsCollab(
    roomId: string,
    projectName: string
  ): Promise<Buffer> {
    const state = await this.arrangeRoomStateService.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    // Serialize project data and collect audio files
    const { projectData, audioFiles } = await this.serializationService.serializeCompleteProject(
      state,
      projectName
    );

    // Create ZIP file
    const zip = new JSZip();

    // Add project.json
    zip.file('project.json', JSON.stringify(projectData, null, 2));

    // Add audio files
    if (audioFiles.length > 0) {
      const audioFolder = zip.folder('audio');
      if (audioFolder) {
        for (const audioFile of audioFiles) {
          audioFolder.file(audioFile.fileName, audioFile.buffer);
        }
      }
    }

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    loggingService.logInfo('Project exported as .collab', {
      roomId,
      projectName,
      audioFileCount: audioFiles.length,
      zipSizeBytes: zipBuffer.length,
    });

    return zipBuffer;
  }

  /**
   * Export project as a stem package
   * Includes: audio stems, MIDI files, and manifest.json
   */
  async exportProjectStems(
    roomId: string,
    projectName: string
  ): Promise<Buffer> {
    const state = await this.arrangeRoomStateService.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    const zip = new JSZip();

    // 1. Export MIDI tracks
    const midiRegions = state.regions.filter((r) => r.type === 'midi') as MidiRegion[];
    if (midiRegions.length > 0) {
      const midiFolder = zip.folder('midi');
      if (midiFolder) {
        for (const region of midiRegions) {
          try {
            const midiBuffer = this.convertToMIDI(region, state.bpm);
            const track = state.tracks.find((t) => t.id === region.trackId);
            const fileName = `${track?.name || 'Track'}_${region.name}.mid`;
            midiFolder.file(fileName, midiBuffer);
          } catch (error) {
            loggingService.logError(error as Error, {
              context: 'ProjectExportService:exportProjectStems:midiConversion',
              roomId,
              regionId: region.id,
            });
          }
        }
      }
    }

    // 2. Export audio tracks (multitrack)
    const audioRegions = state.regions.filter((r) => r.type === 'audio') as AudioRegion[];
    if (audioRegions.length > 0) {
      const audioFolder = zip.folder('audio');
      if (audioFolder) {
        const audioFiles = await this.serializationService.collectAudioFiles(roomId, state.regions);
        for (const audioFile of audioFiles) {
          const region = audioRegions.find(
            (r) => (r.audioFileId || r.id) === audioFile.regionId
          );
          if (region) {
            const track = state.tracks.find((t) => t.id === region.trackId);
            const fileName = `${track?.name || 'Track'}_${region.name}.ogg`;
            audioFolder.file(fileName, audioFile.buffer);
          }
        }
      }
    }

    // 3. Export manifest (JSON with track info, tempo, etc.)
    const manifest = {
      version: PROJECT_SCHEMA_VERSION,
      projectName,
      exportedAt: new Date().toISOString(),
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      scale: state.scale,
      tracks: state.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        instrumentId: t.instrumentId,
        instrumentCategory: t.instrumentCategory,
        volume: t.volume,
        pan: t.pan,
        color: t.color,
      })),
      regions: state.regions.map((r) => ({
        id: r.id,
        trackId: r.trackId,
        name: r.name,
        start: r.start,
        length: r.length,
        type: r.type,
      })),
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    loggingService.logInfo('Project exported as stem package', {
      roomId,
      projectName,
      midiRegionCount: midiRegions.length,
      audioRegionCount: audioRegions.length,
      zipSizeBytes: zipBuffer.length,
    });

    return zipBuffer;
  }

  /**
   * Convert MIDI region to MIDI file buffer
   * Uses midi-writer-js library
   */
  private convertToMIDI(region: MidiRegion, bpm: number): Buffer {
    try {
      // Create a new MIDI track
      const track = new MidiWriter.Track();

      // Set tempo (BPM)
      track.setTempo(bpm);

      // Convert notes to MIDI events
      // Group notes by start time for proper timing
      const notesByTime = new Map<number, typeof region.notes>();
      
      for (const note of region.notes) {
        const startTime = note.start;
        if (!notesByTime.has(startTime)) {
          notesByTime.set(startTime, []);
        }
        notesByTime.get(startTime)!.push(note);
      }

      // Sort by start time
      const sortedTimes = Array.from(notesByTime.keys()).sort((a, b) => a - b);

      // Add notes to track
      for (const startTime of sortedTimes) {
        const notesAtTime = notesByTime.get(startTime)!;
        
        for (const note of notesAtTime) {
          // Convert pitch (MIDI note number)
          const pitch = Math.round(note.pitch);
          
          // Convert duration from beats to ticks (assuming 128 ticks per beat)
          const duration = Math.round(note.duration * 128);
          
          // Convert velocity (0-127)
          const velocity = Math.round(note.velocity * 127);

          // Create MIDI note event
          const noteEvent = new MidiWriter.NoteEvent({
            pitch: [pitch],
            duration: `T${duration}`,
            velocity,
          });

          track.addEvent(noteEvent);
        }
      }

      // Create MIDI file
      const write = new MidiWriter.Writer([track]);
      
      // Get MIDI file as buffer
      const midiData = write.buildFile();
      
      // Convert to Buffer
      const buffer = Buffer.from(midiData as Uint8Array);

      loggingService.logInfo('MIDI conversion successful', {
        regionId: region.id,
        noteCount: region.notes.length,
        bpm,
        bufferSize: buffer.length,
      });

      return buffer;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectExportService:convertToMIDI',
        regionId: region.id,
        noteCount: region.notes.length,
      });

      throw new Error(`Failed to convert MIDI region "${region.name}" (${region.id}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
