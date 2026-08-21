import fs from 'fs';
import path from 'path';
import { config } from '@/config/environment';
import { AudioRegionStorageService } from '../AudioRegionStorageService';

/**
 * DEV-195: a private room's recorded audio is streamed via
 * GET /api/rooms/:roomId/audio/regions/:regionId. `regionId` is an untrusted path param that
 * was composed straight into the on-disk filename. A traversal value such as
 * "../<otherRoom>/<region>" stays inside the recordings base dir (a sibling room dir), so a
 * baseDir-only containment check would miss it — the storage layer must contain region files to
 * the *room* directory. These tests prove the cross-room read is blocked at the storage backstop.
 */
describe('AudioRegionStorageService path containment (DEV-195)', () => {
  const baseDir = path.resolve(config.storage.recordingsDir);
  const victimRoom = 'dev195-victim-room';
  const attackerRoom = 'dev195-attacker-room';
  const regionId = 'dev195-secret-region';
  const victimDir = path.join(baseDir, victimRoom);
  const victimFile = path.join(victimDir, `${regionId}.ogg`);

  let service: AudioRegionStorageService;

  beforeAll(() => {
    fs.mkdirSync(victimDir, { recursive: true });
    fs.writeFileSync(victimFile, 'secret-audio-bytes');
    service = new AudioRegionStorageService();
  });

  afterAll(() => {
    fs.rmSync(victimDir, { recursive: true, force: true });
    fs.rmSync(path.join(baseDir, attackerRoom), { recursive: true, force: true });
  });

  it('resolves a legitimate same-room recording (positive control)', () => {
    expect(service.resolveRegionFilePath(victimRoom, regionId)).toBe(victimFile);
  });

  it('does NOT resolve another room\'s recording via a traversal regionId', () => {
    const traversalRegionId = `../${victimRoom}/${regionId}`;
    expect(service.resolveRegionFilePath(attackerRoom, traversalRegionId)).toBeNull();
  });

  it('does NOT resolve a file outside the recordings dir via a traversal regionId', () => {
    expect(service.resolveRegionFilePath(attackerRoom, '../../package')).toBeNull();
  });
});
