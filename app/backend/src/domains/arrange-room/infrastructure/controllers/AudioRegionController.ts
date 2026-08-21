import type { Request, Response } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import type { RoomLifecycleService } from '../../../room-management/application/RoomLifecycleService';
import { RoomType } from '../../../../types';
import type { AudioRegionStorageService } from '../../infrastructure/storage/AudioRegionStorageService';
import type { ArrangeRoomStateService } from '../../application/ArrangeRoomStateService';
import { canStreamRoomMedia } from '../../../room-management/infrastructure/services/RoomStreamAccess';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";

/**
 * Parse an RFC 7233 `bytes=` range against a known size.
 * Returns null when the range header is malformed or uses an unsupported
 * form (multi-range, other units) — per RFC 7233 §3.1 such a header MUST be
 * ignored and the full 200 body served, not answered with 416.
 * Returns `{ type: 'unsatisfiable' }` for a syntactically valid range that
 * cannot be satisfied (caller answers 416 with a wildcard-total Content-Range).
 * Clamps end to size - 1; supports suffix ranges (`bytes=-N` = last N bytes).
 * The unit name is matched case-insensitively (HTTP ABNF strings are
 * case-insensitive unless `%s` is used).
 */
type RangeParseResult =
  | { type: 'valid'; start: number; end: number }
  | { type: 'unsatisfiable' }
  | null;

function parseRange(rangeHeader: string, size: number): RangeParseResult {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (match === null) {
    // Not a single `bytes` range (multi-range, other unit, `bytes=` with no
    // range-spec) — ignore and serve the full representation (RFC 7233 §3.1).
    return null;
  }
  const startStr = match[1] ?? '';
  const endStr = match[2] ?? '';
  if (startStr === '' && endStr === '') {
    return null;
  }
  if (size === 0) {
    // Nothing to serve — every byte-range-set is unsatisfiable (RFC 7233 §2.1).
    return { type: 'unsatisfiable' };
  }
  if (startStr === '') {
    // Suffix range: the last N bytes.
    const suffixLength = parseInt(endStr, 10);
    if (Number.isNaN(suffixLength)) {
      return null;
    }
    if (suffixLength <= 0) {
      // `bytes=-0` covers nothing — unsatisfiable.
      return { type: 'unsatisfiable' };
    }
    if (suffixLength >= size) {
      return { type: 'valid', start: 0, end: size - 1 };
    }
    return { type: 'valid', start: size - suffixLength, end: size - 1 };
  }
  const start = parseInt(startStr, 10);
  const end = endStr === '' ? size - 1 : parseInt(endStr, 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0) {
    return null;
  }
  if (start >= size || end < start) {
    return { type: 'unsatisfiable' };
  }
  return { type: 'valid', start, end: Math.min(end, size - 1) };
}

export class AudioRegionController {
  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly audioStorage: AudioRegionStorageService,
    private readonly arrangeRoomStateService: ArrangeRoomStateService
  ) {}

  uploadRegionAudio = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;
    const rawBody: unknown = req.body;
    const bodyFields = rawBody !== null && typeof rawBody === 'object' ? rawBody as Record<string, unknown> : {};
    // TR-33: the uploader is the verified token identity. A multipart `userId` field
    // would let any caller upload into a room as any member. Mirrors the DEV-190 fix
    // on streamRegionAudio in this same controller.
    const userId = req.user?.id;
    const bodyRegionId = typeof bodyFields['regionId'] === 'string' ? bodyFields['regionId'] : undefined;
    const trackId = typeof bodyFields['trackId'] === 'string' ? bodyFields['trackId'] : undefined;
    const originalName = typeof bodyFields['originalName'] === 'string' ? bodyFields['originalName'] : undefined;
    const file = req.file;

    if (roomId === undefined || roomId.length === 0 || !file) {
      res.status(400).json({ success: false, message: 'Audio file is required' });
      return;
    }

    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room || room.roomType !== RoomType.ARRANGE) {
      res.status(404).json({ success: false, message: 'Arrange room not found' });
      await this.removeTempFile(file.path);
      return;
    }

    if (!userId) {
      res.status(403).json({ success: false, message: 'User not authorized for this room' });
      await this.removeTempFile(file.path);
      return;
    }
    
    const hasUser = room.bandMembers.has(userId) || room.audiences.has(userId);
    if (!hasUser) {
      res.status(403).json({ success: false, message: 'User not authorized for this room' });
      await this.removeTempFile(file.path);
      return;
    }

    const resolvedRegionId = typeof bodyRegionId === 'string' && bodyRegionId.length > 0
      ? bodyRegionId
      : crypto.randomUUID();

    try {
      const saveOptions = {
        roomId,
        regionId: resolvedRegionId,
        sourcePath: file.path,
        originalName: typeof originalName === 'string' ? originalName : file.originalname,
      } as {
        roomId: string;
        regionId: string;
        sourcePath: string;
        originalName: string;
        trackId?: string;
      };

      if (typeof trackId === 'string' && trackId.length > 0) {
        saveOptions.trackId = trackId;
      }

      const result = await this.audioStorage.saveRegionAudio(saveOptions);
      const audioUrl = this.audioStorage.getRegionPlaybackPath(roomId, resolvedRegionId);

      // Update Redis state with audioUrl if region exists
      try {
        const state = await this.arrangeRoomStateService.getState(roomId);
        if (state) {
          const existingRegion = state.regions.find(r => r.id === resolvedRegionId);
          if (existingRegion && existingRegion.type === 'audio') {
            await this.arrangeRoomStateService.updateRegion(roomId, resolvedRegionId, {
              audioUrl,
            });
          }
        }
      } catch {
        // Non-critical - region might not exist in state yet (will be added by socket handler)
        loggingService.logInfo('Could not update region audioUrl in Redis (region may not exist yet)', {
          roomId,
          regionId: resolvedRegionId,
        });
      }

      res.status(201).json({
        success: true,
        regionId: resolvedRegionId,
        audioUrl,
        durationSeconds: result.durationSeconds,
        sampleRate: result.sampleRate,
        channels: result.channels,
        bitrate: result.bitrate,
        sizeBytes: result.sizeBytes,
        format: 'opus',
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'AudioRegionController:uploadRegionAudio',
        roomId,
      });
      res.status(500).json({
        success: false,
        message: 'Failed to process audio recording',
      });
    } finally {
      await this.removeTempFile(file.path);
    }
  };

  streamRegionAudio = async (req: Request, res: Response): Promise<void> => {
    const { roomId, regionId } = req.params as { roomId: string; regionId: string };

    if (roomId.length === 0 || regionId.length === 0) {
      res.status(400).json({ success: false, message: 'Room ID and region ID are required' });
      return;
    }

    // DEV-195: regionId is an untrusted path param composed into the on-disk filename. Reject any
    // path separator or traversal sequence at the boundary so it cannot escape the room's recording
    // directory (the storage layer also asserts containment as a universal backstop).
    if (/[/\\]/.test(regionId) || regionId.includes('..')) {
      res.status(400).json({ success: false, message: 'Invalid region ID' });
      return;
    }

    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room || room.roomType !== RoomType.ARRANGE) {
      res.status(404).json({ success: false, message: 'Arrange room not found' });
      return;
    }

    // DEV-190: recorded audio of a private room is members-only. Identity comes from the verified
    // Bearer token, never a client-supplied `userId` query param (which could simply be omitted to
    // bypass the check). Public rooms remain open.
    if (!canStreamRoomMedia(room, req)) {
      res.status(403).json({ success: false, message: 'Not authorized to stream this room\'s audio' });
      return;
    }

    const filePath = this.audioStorage.resolveRegionFilePath(roomId, regionId);
    if (!filePath) {
      loggingService.logInfo('Audio file not found', {
        context: 'AudioRegionController:streamRegionAudio',
        roomId,
        regionId,
      });
      res.status(404).json({ success: false, message: 'Audio file not found' });
      return;
    }

    loggingService.logInfo('Streaming audio region', {
      context: 'AudioRegionController:streamRegionAudio',
      roomId,
      regionId,
      filePath,
    });

    try {
      const stat = await fs.promises.stat(filePath);
      const range = req.headers.range;
      const mimeType = 'audio/ogg';

      if (range) {
        const parsed = parseRange(range, stat.size);
        if (parsed !== null && parsed.type === 'unsatisfiable') {
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          res.status(416).json({ success: false, message: 'Range not satisfiable' });
          return;
        }
        if (parsed !== null) {
          const { start, end } = parsed;
          const chunkSize = end - start + 1;
          const fileStream = fs.createReadStream(filePath, { start, end });

          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', chunkSize);
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.writeHead(206);
          fileStream.pipe(res);
          return;
        }
        // Malformed/unsupported range header — ignored per RFC 7233 §3.1:
        // fall through and serve the full 200 representation.
      }
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'AudioRegionController:streamRegionAudio',
        roomId,
        regionId,
      });
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to stream audio' });
      } else {
        res.end();
      }
    }
  };

  private async removeTempFile(tempPath: string): Promise<void> {
    if (tempPath.length === 0) return;
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}
