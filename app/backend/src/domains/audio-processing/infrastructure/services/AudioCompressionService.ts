/**
 * Audio Compression Service
 * Compresses audio files to Opus/Ogg format using worker threads
 * to prevent blocking the main event loop
 * 
 * Performance Optimization: Uses WorkerPoolService for FFmpeg operations
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'node:crypto';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { WorkerPoolService } from '../../../../shared/infrastructure/workers/WorkerPoolService';
import { getAudioCompressionPool } from '../../../../shared/infrastructure/workers/WorkerPoolService';
import type { WorkerInput, WorkerOutput } from '../../../../workers/audioCompressionWorker';

// Fallback imports for when workers are not available
import ffmpeg, { type FfprobeData } from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface CompressAudioResult {
  buffer: Buffer;
  fileName: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

/**
 * Service for compressing audio files to Opus/Ogg format
 * Uses worker threads to prevent blocking the main event loop
 * Standardizes all audio to .ogg 192kbps format
 */
export class AudioCompressionService {
  private readonly TARGET_BITRATE = 192000; // 192kbps in bits per second
  private readonly BITRATE_TOLERANCE = 20000; // +/- 20kbps tolerance for existing files
  private readonly useWorkerThreads: boolean;
  private readonly workerPool: WorkerPoolService<WorkerInput, WorkerOutput> | null = null;

  constructor(useWorkerThreads: boolean = true) {
    this.useWorkerThreads = useWorkerThreads;

    if (useWorkerThreads) {
      try {
        this.workerPool = getAudioCompressionPool() as WorkerPoolService<WorkerInput, WorkerOutput>;
        loggingService.logInfo('AudioCompressionService initialized with worker threads');
      } catch (error) {
        loggingService.logInfo('Worker threads not isAvailable, falling back to main thread', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.workerPool = null;
      }
    }
  }

  /**
   * Compress audio buffer to Opus/Ogg format with 192kbps bitrate
   * Uses worker threads when available to prevent blocking the main event loop
   * 
   * @param audioBuffer - Original audio file buffer
   * @param originalFileName - Original file name (for extension detection)
   * @returns Compressed audio buffer and metadata
   */
  async compressAudio(
    audioBuffer: Buffer,
    originalFileName: string
  ): Promise<CompressAudioResult> {
    const tempDir = os.tmpdir();
    const uniqueId = randomUUID();
    const inputPath = path.join(tempDir, `input-${uniqueId}.${this.getExtension(originalFileName)}`);
    const outputPath = path.join(tempDir, `output-${uniqueId}.ogg`);

    try {
      // Write input buffer to temp file
      await fs.writeFile(inputPath, audioBuffer);

      // Use worker thread if available
      if (this.workerPool) {
        return await this.compressWithWorker(inputPath, outputPath, originalFileName, audioBuffer.length);
      }

      // Fallback to main thread processing
      return await this.compressOnMainThread(inputPath, outputPath, originalFileName, audioBuffer);
    } finally {
      // Clean up temp files
      await Promise.all([
        fs.unlink(inputPath).catch(() => { }),
        fs.unlink(outputPath).catch(() => { }),
      ]);
    }
  }

  /**
   * Compress multiple audio files
   * Uses worker pool for parallel processing
   */
  async compressAudioFiles(
    audioFiles: Array<{ fileName: string; buffer: Buffer }>
  ): Promise<Array<{ fileName: string; buffer: Buffer }>> {
    const results = await Promise.all(
      audioFiles.map((file) => this.compressAudio(file.buffer, file.fileName))
    );

    return results.map((result) => ({
      fileName: result.fileName,
      buffer: result.buffer,
    }));
  }

  /**
   * Get worker pool statistics
   */
  getPoolStats(): {
    activeWorkers: number;
    busyWorkers: number;
    queuedTasks: number;
    totalProcessed: number;
    totalFailed: number;
    avgProcessingTime: number;
  } | null {
    if (this.workerPool) {
      return this.workerPool.getStats();
    }
    return null;
  }

  /**
   * Compress audio using worker thread (non-blocking)
   */
  private async compressWithWorker(
    inputPath: string,
    outputPath: string,
    originalFileName: string,
    _originalSize: number
  ): Promise<CompressAudioResult> {
    const workerInput: WorkerInput = {
      inputPath,
      outputPath,
      originalFileName,
      targetBitrate: this.TARGET_BITRATE,
      bitrateTolerance: this.BITRATE_TOLERANCE,
    };

    const startTime = Date.now();
    const result = await this.workerPool!.execute(workerInput);
    const processingTime = Date.now() - startTime;

    if (!result.success) {
      throw new Error(result.error || 'Worker thread compression failed');
    }

    loggingService.logInfo('Audio compressed via worker thread', {
      originalFileName,
      newFileName: result.newFileName,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionRatio: (result.compressionRatio * 100).toFixed(2) + '%',
      skipped: result.skipped,
      processingTimeMs: processingTime,
    });

    return {
      buffer: Buffer.from(result.compressedBuffer || []),
      fileName: result.newFileName,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionRatio: result.compressionRatio,
    };
  }

  /**
   * Compress audio on main thread (fallback when workers not isAvailable)
   */
  private async compressOnMainThread(
    inputPath: string,
    outputPath: string,
    originalFileName: string,
    audioBuffer: Buffer
  ): Promise<CompressAudioResult> {
    // Check if file is already in the target format
    const isAlreadyOptimized = await this.checkIfOptimized(inputPath, originalFileName);

    if (isAlreadyOptimized) {
      loggingService.logInfo('Audio file already in target format, skipping compression', {
        originalFileName,
        originalSize: audioBuffer.length,
      });

      const baseName = path.parse(originalFileName).name;
      const newFileName = `${baseName}.ogg`;

      return {
        buffer: audioBuffer,
        fileName: newFileName,
        originalSize: audioBuffer.length,
        compressedSize: audioBuffer.length,
        compressionRatio: 1,
      };
    }

    // Compress to Opus/Ogg with 192kbps
    await this.encodeToOpus(inputPath, outputPath);

    // Read compressed file
    const compressedBuffer = await fs.readFile(outputPath);

    // Get file sizes
    const originalSize = audioBuffer.length;
    const compressedSize = compressedBuffer.length;
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

    // Generate new filename with .ogg extension
    const baseName = path.parse(originalFileName).name;
    const newFileName = `${baseName}.ogg`;

    loggingService.logInfo('Audio file compressed on main thread', {
      originalFileName,
      newFileName,
      originalSize,
      compressedSize,
      compressionRatio: (compressionRatio * 100).toFixed(2) + '%',
    });

    return {
      buffer: compressedBuffer,
      fileName: newFileName,
      originalSize,
      compressedSize,
      compressionRatio,
    };
  }

  /**
   * Check if audio file is already in target format (.ogg 192kbps)
   */
  private async checkIfOptimized(filePath: string, fileName: string): Promise<boolean> {
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.ogg') {
      return false;
    }

    try {
      const metadata = await this.extractMetadata(filePath);

      const format = metadata.format?.toLowerCase() || '';
      const isOggFormat = format.includes('ogg');

      const codec = metadata.codec?.toLowerCase() || '';
      const isOpusCodec = codec === 'opus';

      const bitrateDiff = Math.abs(metadata.bitrate - this.TARGET_BITRATE);
      const isTargetBitrate = bitrateDiff <= this.BITRATE_TOLERANCE;

      const isOptimized = isOggFormat && isOpusCodec && isTargetBitrate;

      if (!isOptimized) {
        loggingService.logInfo('Audio file needs compression', {
          fileName,
          format,
          codec,
          bitrate: metadata.bitrate,
          targetBitrate: this.TARGET_BITRATE,
        });
      }

      return isOptimized;
    } catch (error) {
      loggingService.logInfo('Could not check audio metadata, will compress', {
        fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Extract metadata from audio file
   */
  private async extractMetadata(filePath: string): Promise<{
    bitrate: number;
    format?: string;
    codec?: string;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: Error | null, data: FfprobeData) => {
        if (err) {
          reject(err);
          return;
        }

        const stream = data.streams.find(
          (s: FfprobeData['streams'][number]) => s.codec_type === 'audio'
        );

        const result: {
          bitrate: number;
          format?: string;
          codec?: string;
        } = {
          bitrate: stream?.bit_rate ? Number(stream.bit_rate) : 0,
        };

        if (data.format.format_name) {
          result.format = data.format.format_name;
        }

        if (stream?.codec_name) {
          result.codec = stream.codec_name;
        }

        resolve(result);
      });
    });
  }

  /**
   * Encode audio to Opus/Ogg format with 192kbps bitrate
   */
  private async encodeToOpus(inputPath: string, outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('192k')
        .audioChannels(2)
        .format('ogg')
        .outputOptions(['-vbr', 'on'])
        .on('end', () => resolve())
        .on('error', (error: Error) => {
          loggingService.logError(error, { context: 'AudioCompressionService', inputPath, outputPath });
          reject(error);
        })
        .save(outputPath);
    });
  }

  /**
   * Get file extension from filename
   */
  private getExtension(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    return ext !== '' ? ext : 'wav';
  }
}

export const audioCompressionService = new AudioCompressionService(); // Re-enabled with JS worker file
