import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from "../../../../shared/infrastructure/logging/LoggingService";
import { config } from "../../../../config/environment";
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Get FFmpeg path from installer
const ffmpegPath = ffmpegInstaller.path;

interface BroadcastSession {
  roomId: string;
  ffmpegProcess: ChildProcess | null;
  outputDir: string;
  isActive: boolean;
  startTime: number;
  segmentCount: number;
}

/**
 * HLS Broadcast Service
 * Handles real-time transcoding of WebM/Opus audio to HLS segments using FFmpeg
 * 
 * Flow:
 * 1. Room owner starts broadcast
 * 2. Audio chunks (WebM/Opus) are piped to FFmpeg stdin
 * 3. FFmpeg transcodes to AAC and outputs HLS segments
 * 4. Audience fetches playlist and segments via HTTP
 */
export class HLSBroadcastService {
  /* eslint-disable @typescript-eslint/member-ordering */
  private readonly sessions = new Map<string, BroadcastSession>();
  private readonly baseOutputDir: string;

  constructor() {
    // Use temp directory for HLS output
    this.baseOutputDir = path.join(os.tmpdir(), 'jam-band-hls');
    this.ensureDirectoryExists(this.baseOutputDir);
    logger.info(`HLS output directory: ${this.baseOutputDir}`);
  }

  /**
   * Start a new broadcast session for a room
   */
  startBroadcast(roomId: string): boolean {
    if (this.sessions.has(roomId)) {
      logger.warn(`Broadcast already active for room ${roomId}`);
      return false;
    }

    const outputDir = path.join(this.baseOutputDir, roomId);
    this.ensureDirectoryExists(outputDir);

    // Clean up any old files
    this.cleanupDirectory(outputDir);

    const playlistPath = path.join(outputDir, 'playlist.m3u8');

    // FFmpeg command for HLS output
    // Input: WebM/Opus from stdin
    // Output: HLS with AAC audio
    const ffmpegArgs = [
      // Input options
      '-f', 'webm',           // Input format
      '-i', 'pipe:0',         // Read from stdin
      
      // Audio encoding
      '-c:a', 'aac',          // AAC codec for HLS compatibility
      '-b:a', `${config.hls.audioBitrate}`, // Audio bitrate
      '-ar', '48000',         // Sample rate
      '-ac', '2',             // Stereo
      
      // HLS options
      '-f', 'hls',                    // Output format
      '-hls_time', `${config.hls.segmentDuration}`, // Segment duration
      '-hls_list_size', `${config.hls.playlistLength}`, // Keep segments in playlist
      '-hls_flags', 'delete_segments+append_list+omit_endlist', // Live streaming flags
      '-hls_segment_type', 'mpegts',  // MPEG-TS segments
      '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
      
      // Output
      playlistPath
    ];

    logger.info(`Starting FFmpeg for room ${roomId}`, { ffmpegPath, outputDir });

    try {
      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
      if (ffmpegProcess.stdout) {
        ffmpegProcess.stdout.on('data', (data: Buffer) => {
          logger.debug(`FFmpeg stdout [${roomId}]: ${data.toString()}`);
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
      if (ffmpegProcess.stderr) {
        ffmpegProcess.stderr.on('data', (data: Buffer) => {
          const message = data.toString();
          // FFmpeg outputs progress info to stderr, only log errors
          if (message.includes('Error') || message.includes('error')) {
            logger.error(`FFmpeg error [${roomId}]: ${message}`);
          } else {
            logger.debug(`FFmpeg [${roomId}]: ${message}`);
          }
        });
      }

      ffmpegProcess.on('close', (code) => {
        logger.info(`FFmpeg process closed for room ${roomId}`, { code });
        const session = this.sessions.get(roomId);
        if (session) {
          session.isActive = false;
          session.ffmpegProcess = null;
        }
      });

      ffmpegProcess.on('error', (err) => {
        logger.error(`FFmpeg process error for room ${roomId}: ${err.message}`);
        this.stopBroadcast(roomId);
      });

      const session: BroadcastSession = {
        roomId,
        ffmpegProcess,
        outputDir,
        isActive: true,
        startTime: Date.now(),
        segmentCount: 0
      };

      this.sessions.set(roomId, session);
      logger.info(`Broadcast started for room ${roomId}`);
      return true;
    } catch (err) {
      logger.error(`Failed to start FFmpeg for room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Stop a broadcast session
   */
  stopBroadcast(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (!session) {
      return;
    }

    logger.info(`Stopping broadcast for room ${roomId}`);

    // Close FFmpeg stdin to signal end of input
    if (session.ffmpegProcess?.stdin) {
      session.ffmpegProcess.stdin.end();
    }

    // Kill FFmpeg process
    if (session.ffmpegProcess) {
      session.ffmpegProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
          session.ffmpegProcess.kill('SIGKILL');
        }
      }, 5000);
    }

    session.isActive = false;

    // Clean up files after a delay to allow final segment fetches
    setTimeout(() => {
      this.cleanupDirectory(session.outputDir);
      this.sessions.delete(roomId);
    }, 30000); // 30 second delay

    logger.info(`Broadcast stopped for room ${roomId}`);
  }

  /**
   * Write audio chunk to FFmpeg stdin
   */
  writeAudioChunk(roomId: string, chunk: Buffer): boolean {
    const session = this.sessions.get(roomId);
    if (!session || !session.isActive || !session.ffmpegProcess?.stdin) {
      return false;
    }

    try {
      const canWrite = session.ffmpegProcess.stdin.write(chunk);
      if (!canWrite) {
        // Handle backpressure - wait for drain
        session.ffmpegProcess.stdin.once('drain', () => {
          logger.debug(`FFmpeg stdin drained for room ${roomId}`);
        });
      }
      return true;
    } catch (err) {
      logger.error(`Failed to write audio chunk for room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Get the HLS playlist content
   */
  getPlaylist(roomId: string): string | null {
    const session = this.sessions.get(roomId);
    if (!session) {
      return null;
    }

    const playlistPath = path.join(session.outputDir, 'playlist.m3u8');
    
    try {
      if (fs.existsSync(playlistPath)) {
        return fs.readFileSync(playlistPath, 'utf-8');
      }
    } catch (err) {
      logger.error(`Failed to read playlist for room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return null;
  }

  /**
   * Get an HLS segment
   */
  getSegment(roomId: string, segmentName: string): Buffer | null {
    const session = this.sessions.get(roomId);
    if (!session) {
      return null;
    }

    // Validate segment name to prevent path traversal
    if (!segmentName.match(/^segment_\d{3}\.ts$/)) {
      logger.warn(`Invalid segment name requested: ${segmentName}`);
      return null;
    }

    const segmentPath = path.join(session.outputDir, segmentName);
    
    try {
      if (fs.existsSync(segmentPath)) {
        return fs.readFileSync(segmentPath);
      }
    } catch (err) {
      logger.error(`Failed to read segment ${segmentName} for room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return null;
  }

  /**
   * Check if a broadcast is active
   */
  isActive(roomId: string): boolean {
    const session = this.sessions.get(roomId);
    return session?.isActive ?? false;
  }

  /**
   * Get playlist URL for a room
   */
  getPlaylistUrl(roomId: string): string {
    return `/api/broadcast/${roomId}/playlist.m3u8`;
  }

  /**
   * Clean up directory
   */
  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Clean up directory
   */
  private cleanupDirectory(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    } catch (err) {
      logger.error(`Failed to cleanup directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Cleanup all sessions (for graceful shutdown)
   */
  shutdown(): void {
    logger.info('Shutting down HLS Broadcast Service');
    for (const [roomId] of this.sessions) {
      this.stopBroadcast(roomId);
    }
  }
}

// Singleton instance
export const hlsBroadcastService = new HLSBroadcastService();
