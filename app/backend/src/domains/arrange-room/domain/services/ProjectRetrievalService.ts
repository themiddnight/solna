import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomStateService } from '../../application/ArrangeRoomStateService';
import type { ProjectStorageService } from '../../infrastructure/storage/ProjectStorageService';
import type { ProjectData } from '../models/ProjectData';
import type { ArrangeRoomState } from '../models/ArrangeRoomState';
import { DEFAULT_MASTER_VOLUME_DB, PROJECT_SCHEMA_VERSION } from '@jam-band/shared';

export interface ProjectRetrievalResult {
  project: ProjectData | null;
  metadata: {
    projectName: string;
    uploadedBy: string;
    uploadedAt: string;
  } | null;
}

export class ProjectRetrievalService {
  constructor(
    private readonly arrangeRoomStateService: ArrangeRoomStateService,
    private readonly projectStorageService: ProjectStorageService,
    private readonly audioStorage: AudioRegionStorageService
  ) {}

  /**
   * Get project data for a room, preferring in-memory state but falling back to storage.
   */
  async getProject(roomId: string): Promise<ProjectRetrievalResult> {
    // Get state from ArrangeRoomStateService (Redis - single source of truth)
    const state = await this.arrangeRoomStateService.getState(roomId);

    if (state && (state.tracks.length > 0 || state.regions.length > 0)) {
      // Get metadata from projectStorageService if available (for project name/owner)
      const projectMeta = this.projectStorageService.getProject(roomId);

      const projectData = await this.mapStateToProjectData(state, projectMeta?.projectName);

      return {
        project: projectData,
        metadata: {
          projectName: projectMeta?.projectName || 'Current Project',
          uploadedBy: projectMeta?.uploadedBy || 'Unknown',
          uploadedAt: (projectMeta?.uploadedAt.toISOString()) || state.lastUpdated.toISOString(),
        },
      };
    }

    // No state found - return null
    // Note: We no longer fallback to ProjectStorageService.projectData
    // because ProjectData is always serialized from Redis state
    return {
      project: null,
      metadata: null,
    };
  }

  private async mapStateToProjectData(state: ArrangeRoomState, projectName: string = 'Current Project'): Promise<ProjectData> {
    return {
      version: PROJECT_SCHEMA_VERSION,
      metadata: {
        name: projectName,
        createdAt: state.lastUpdated.toISOString(),
        modifiedAt: state.lastUpdated.toISOString(),
      },
      project: {
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        gridDivision: 16,
        loop: {
          enabled: false,
          start: 0,
          end: 0,
        },
        isMetronomeEnabled: true,
        snapToGrid: true,
        masterVolume: state.masterVolume ?? DEFAULT_MASTER_VOLUME_DB,
      },
      scale: state.scale ?? {
        rootNote: 'C',
        scale: 'major',
      },
      tracks: state.tracks,
      regions: state.regions,
      effectChains: state.effectChains,
      synthStates: state.synthStates,
      // DEV-301: conditional spread — same exactOptionalPropertyTypes reasoning as
      // ProjectSerializationService.serializeRoomState.
      ...(state.instrumentParamsStates !== undefined
        ? { instrumentParamsStates: state.instrumentParamsStates }
        : {}),
      markers: state.markers,
      // DEV-279: chordTrack was missing from the read path — the GET /projects/:id
      // API returned project data without chord blocks, so any consumer relying on
      // that response (export, remix) lost the chord track.
      chordTrack: state.chordTrack,
    };
  }
}
