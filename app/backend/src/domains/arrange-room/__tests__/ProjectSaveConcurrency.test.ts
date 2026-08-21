import { ProjectSaveService } from '../domain/services/ProjectSaveService';
import type { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import type { AudioRegionStorageService } from '../infrastructure/storage/AudioRegionStorageService';
import type { ProjectStorageService } from '../infrastructure/storage/ProjectStorageService';
import type { ArrangeRoomState } from '../domain/models/ArrangeRoomState';
import { createPartialMock } from '@/testing/mocks';

// Mock dependencies (we want to test concurrency logic in the service layer, not actual DB/Storage contention for now)
// In a real scenario, we might want to use real DB to test transaction isolation,
// but here we focus on the service's handling of parallel requests if it has any internal locking.
// If the service delegates locking to Redis/DB, we should mock that behavior or use real instances.
//
// Assuming ProjectSaveLockService is used internally or needs to be tested.
// For this example, let's simulate a scenario where multiple requests try to save the same project.

const mockStateService = createPartialMock<ArrangeRoomStateService>({
  getState: jest.fn(),
});

const mockAudioStorage = createPartialMock<AudioRegionStorageService>({
  resolveRegionFilePath: jest.fn(),
});

const mockProjectStorage = createPartialMock<ProjectStorageService>({
  saveProjectFiles: jest.fn().mockImplementation(async () => {
    // Simulate delay to allow overlap
    await new Promise(resolve => setTimeout(resolve, 50));
    return;
  }),
  getManifest: jest.fn().mockResolvedValue(null),
  saveManifest: jest.fn().mockResolvedValue(undefined),
  replaceProjectFilesSafely: jest.fn().mockResolvedValue(undefined),
});

describe('ProjectSaveConcurrency Integration', () => {
  let service: ProjectSaveService;
  const roomId = 'concurrent-room-1';
  const projectId = 'concurrent-project-1';
  const userId = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectSaveService(mockStateService, mockAudioStorage, mockProjectStorage);

    // Setup mock state
    const mockState: ArrangeRoomState = {
      roomId,
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
      chordTrack: { id: 'chord-track-1', projectId, blocks: [] },
      voiceStates: {},
      broadcastStates: {},
      hasBeenSaved: false,
      lastUpdated: new Date(),
    };
    mockStateService.getState.mockResolvedValue(mockState);
  });

  it('should handle multiple concurrent save requests correctly', async () => {
    const numberOfRequests = 5;
    const promises = [];

    for (let i = 0; i < numberOfRequests; i++) {
        promises.push(
            service.saveProjectFromRoom(roomId, projectId, userId, `Project Version ${i}`)
                .then(() => `success-${i}`)
                .catch((err: unknown) => `error-${i}: ${err instanceof Error ? err.message : String(err)}`)
        );
    }

    const results = await Promise.all(promises);

    // Verify all succeeded (assuming no optimistic locking failure is expected in this service logic itself)
    // If we had a lock service, we might expect some to fail or wait.
    // If ProjectSaveService doesn't implement locking, they should all go through.
    // This test primarily verifies that the service DIES NOT crash or cause inconsistent state errors 
    // when hammered with requests.
    
    const successCount = results.filter(r => r.startsWith('success')).length;
    expect(successCount).toBe(numberOfRequests);

    // Verify Storage was called correct number of times
    expect(mockProjectStorage.saveProjectFiles).toHaveBeenCalledTimes(numberOfRequests);
  });
});
