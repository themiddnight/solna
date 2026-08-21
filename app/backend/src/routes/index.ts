import { Router } from 'express';
import type { RoomController } from '../domains/room-management/infrastructure/controllers/RoomController';
import type { RoomLifecycleHandler } from '../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import { validateData, createRoomSchema } from '@jam-band/shared';
import { config } from '../config/environment';
import multer from 'multer';
import os from 'os';
import type { AudioRegionController } from '../domains/arrange-room/infrastructure/controllers/AudioRegionController';
import type { ProjectController } from '../domains/arrange-room/infrastructure/controllers/ProjectController';
import { hlsBroadcastService } from '../domains/perform-room/infrastructure/services/HLSBroadcastService';
import { hlsLimiter, inviteCodeLimiter } from '../middleware/rateLimit';
import { authenticateToken, authenticateTokenAllowGuest, type AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { canStreamRoomMedia } from '../domains/room-management/infrastructure/services/RoomStreamAccess';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { AUDIO_UPLOAD_MIMES, ARCHIVE_UPLOAD_MIMES, isAllowedUploadMime } from '../shared/utils/audioUploadMime';
import authRoutes from './auth';
import userPresetsRoutes from './userPresets';
import projectsRoutes from './projects';
import bandsRoutes from './bands';
import aiQueueRoutes from './aiQueue';
import aiGenerationRoutes from './aiGeneration';
import bugReportRoutes from './bugReport';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (_req, file, cb) => {
      const sanitized = file.originalname.replace(/\s+/g, '_');
      cb(null, `${Date.now()}-${sanitized}`);
    },
  }),
  limits: {
    fileSize: 200 * 1024 * 1024, // 200 MB
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [...AUDIO_UPLOAD_MIMES, ...ARCHIVE_UPLOAD_MIMES, 'application/json'];
    if (isAllowedUploadMime(file.mimetype, allowedMimes)) {
      cb(null, true);
    } else {
      loggingService.logWarn('Blocked upload with invalid MIME type', { mimetype: file.mimetype });
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

export const createRoutes = (
  roomController: RoomController,
  roomLifecycleHandler: RoomLifecycleHandler,
  audioRegionController: AudioRegionController,
  projectController: ProjectController
): Router => {
  const router = Router();

  // Auth routes
  router.use('/auth', authRoutes);

  // User presets and settings routes
  router.use('/user', userPresetsRoutes);

  // Saved projects routes
  router.use('/projects', projectsRoutes);

  // Bands routes
  router.use('/bands', bandsRoutes);

  // AI Generation routes
  router.use('/ai/queue', aiQueueRoutes);
  router.use('/ai', aiGenerationRoutes);

  // Bug report routes (no auth required — guests can report too)
  router.use('/bug-report', bugReportRoutes);

  // NTP-style time endpoint for metronome clock sync
  router.get('/time', (_req, res) => {
    res.json({ serverTime: Date.now() });
  });

  // Simple health check endpoint (no dependencies)
  router.get('/health/simple', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      frontendUrl: config.cors.frontendUrl,
      allowedOrigins: config.cors.allowedOrigins
    });
  });

  // Health check endpoint
  router.get('/health', (req, res) => roomController.getHealthCheck(req, res));

  // Get room list (optional auth - allows guest users)
  router.get('/rooms', (req, res) => roomController.getRoomList(req, res));

  // Get room details by invite code (public unauthenticated endpoint — rate limited)
  router.get('/rooms/invite/:code', inviteCodeLimiter, (req, res) => roomController.getInviteCodeDetails(req, res));

  // Owner-only on-demand fetch of a room's invite codes (DEV-262): re-delivers
  // codes to an owner who missed the one-shot ROOM_JOINED or became owner later.
  router.get('/rooms/:roomId/invite-codes', authenticateToken, inviteCodeLimiter, (req: AuthRequest, res) =>
    roomController.getRoomInviteCodes(req, res));

  // Check if a room exists (lightweight validation for stale activeRoomId)
  router.get('/rooms/:roomId/exists', (req, res) => roomController.checkRoomExists(req, res));

  // Delete ghost room endpoint (no auth required, but validates ghost status)
  router.delete('/rooms/:roomId/ghost', (req, res) => roomController.deleteGhostRoom(req, res));

  // Create room endpoint with validation. Guest-aware auth (DEV-215): identity/tier is derived from
  // the verified token (registered or guest), never the request body — parity with the socket path.
  router.post('/rooms', authenticateTokenAllowGuest, (req, res) => {
    // Validate request body
    const validationResult = validateData(createRoomSchema, req.body);
    if (validationResult.error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
    }

    // Update request body with validated data
    if (validationResult.value !== undefined) {
      req.body = validationResult.value;
    }

    return roomLifecycleHandler.handleCreateRoomHttp(req, res);
  });

  // Update room settings endpoint with validation (owner-only; actor derived from JWT)
  router.put('/rooms/:roomId/settings', authenticateToken, (req, res) => {
    return roomLifecycleHandler.handleUpdateRoomSettingsHttp(req, res);
  });

  // Audio recording upload endpoint. Guest-aware auth (TR-33): the uploader is the verified
  // token identity, never a multipart `userId` field. Auth runs BEFORE multer so an
  // unauthorized request never spools a temp file.
  router.post(
    '/rooms/:roomId/audio/regions',
    authenticateTokenAllowGuest,
    upload.single('audio'),
    (req, res) => audioRegionController.uploadRegionAudio(req, res)
  );

  // Audio streaming endpoint
  router.get('/rooms/:roomId/audio/regions/:regionId', (req, res) =>
    audioRegionController.streamRegionAudio(req, res)
  );

  // Project upload endpoint (registered-only; actor derived from JWT — BR-12)
  router.post(
    '/rooms/:roomId/projects',
    authenticateToken,
    upload.single('project'),
    (req, res) => projectController.uploadProject(req, res)
  );

  // Get current project for a room
  router.get('/rooms/:roomId/projects', (req, res) =>
    projectController.getProject(req, res)
  );

  // Load project from storage (Server-side load; registered-only; actor derived from the
  // JWT — BR-12). Restricted users never open projects (BR-20 — the share-link flow sends them to
  // signup/verification first): authenticateToken rejects guest tokens (401) and, since the OTP
  // hard gate, unverified registered accounts too.
  router.post(
    '/rooms/:roomId/projects/load',
    authenticateToken,
    (req, res) => projectController.loadProjectFromStorage(req, res)
  );
  // HLS Broadcast endpoints for audience streaming
  // Use separate rate limiter for HLS (more permissive than general API)
  // Playlist endpoint - returns the m3u8 playlist
  router.get('/broadcast/:roomId/playlist.m3u8', hlsLimiter, async (req, res) => {
    const roomId = req.params.roomId;
    if (!roomId) {
      return res.status(400).json({ error: 'Room ID required' });
    }

    // DEV-190: a private room's live broadcast is members-only (membership verified from the JWT,
    // sent by the hls.js xhrSetup header); public broadcasts stay open.
    const room = await roomLifecycleHandler.roomLifecycleService.getRoom(roomId);
    if (room && !canStreamRoomMedia(room, req)) {
      return res.status(403).json({ error: 'Not authorized to stream this broadcast' });
    }

    const playlist = hlsBroadcastService.getPlaylist(roomId);

    if (!playlist) {
      return res.status(404).json({ error: 'Broadcast not found or not ready' });
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    // CORS is handled by the global corsMiddleware (restricted to allowedOrigins) — no wildcard.
    return res.send(playlist);
  });

  // Segment endpoint - returns individual .ts segments
  router.get('/broadcast/:roomId/:segmentName', hlsLimiter, async (req, res) => {
    const roomId = req.params.roomId;
    const segmentName = req.params.segmentName;

    if (!roomId || !segmentName) {
      return res.status(400).json({ error: 'Room ID and segment name required' });
    }

    // Only allow .ts files
    if (!segmentName.endsWith('.ts')) {
      return res.status(400).json({ error: 'Invalid segment format' });
    }

    // DEV-190: same private-room membership gate as the playlist (segment URLs are guessable, so
    // gating the playlist alone is not enough).
    const room = await roomLifecycleHandler.roomLifecycleService.getRoom(roomId);
    if (room && !canStreamRoomMedia(room, req)) {
      return res.status(403).json({ error: 'Not authorized to stream this broadcast' });
    }

    const segment = hlsBroadcastService.getSegment(roomId, segmentName);

    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'max-age=3600');
    // CORS is handled by the global corsMiddleware (restricted to allowedOrigins) — no wildcard.
    return res.send(segment);
  });

  return router;
};
