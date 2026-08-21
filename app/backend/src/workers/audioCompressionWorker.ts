/**
 * Audio Compression Worker
 * Offloads FFmpeg audio encoding to a worker thread to prevent blocking the main event loop
 * 
 * Usage: This worker receives audio file paths and returns compressed audio data
 */
import { parentPort, workerData } from 'worker_threads';
import ffmpeg, { type FfprobeData } from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import fs from 'fs/promises';
import path from 'path';

// Set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface WorkerInput {
  inputPath: string;
  outputPath: string;
  originalFileName: string;
  targetBitrate: number;
  bitrateTolerance: number;
}

export interface WorkerOutput {
  success: boolean;
  error?: string;
  skipped?: boolean;
  compressedBuffer?: number[]; // Buffer as array for transfer
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  newFileName: string;
}

async function extractMetadata(filePath: string): Promise<{
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

async function checkIfOptimized(
  filePath: string,
  fileName: string,
  targetBitrate: number,
  bitrateTolerance: number
): Promise<boolean> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.ogg') {
    return false;
  }

  try {
    const metadata = await extractMetadata(filePath);

    const format = metadata.format?.toLowerCase() || '';
    const isOggFormat = format.includes('ogg');

    const codec = metadata.codec?.toLowerCase() || '';
    const isOpusCodec = codec === 'opus';

    const bitrateDiff = Math.abs(metadata.bitrate - targetBitrate);
    const isTargetBitrate = bitrateDiff <= bitrateTolerance;

    return isOggFormat && isOpusCodec && isTargetBitrate;
  } catch {
    return false;
  }
}

async function encodeToOpus(inputPath: string, outputPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libopus')
      .audioBitrate('192k')
      .audioChannels(2)
      .format('ogg')
      .outputOptions(['-vbr', 'on'])
      .on('end', () => resolve())
      .on('error', (error: Error) => reject(error))
      .save(outputPath);
  });
}

async function processAudio(input: WorkerInput): Promise<WorkerOutput> {
  const { inputPath, outputPath, originalFileName, targetBitrate, bitrateTolerance } = input;

  try {
    // Read original file size
    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size;
    const baseName = path.parse(originalFileName).name;
    const newFileName = `${baseName}.ogg`;

    // Check if already optimized
    const isOptimized = await checkIfOptimized(inputPath, originalFileName, targetBitrate, bitrateTolerance);

    if (isOptimized) {
      const buffer = await fs.readFile(inputPath);
      return {
        success: true,
        skipped: true,
        compressedBuffer: Array.from(buffer),
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
        newFileName,
      };
    }

    // Encode to Opus
    await encodeToOpus(inputPath, outputPath);

    // Read compressed file
    const compressedBuffer = await fs.readFile(outputPath);
    const compressedSize = compressedBuffer.length;
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

    return {
      success: true,
      skipped: false,
      compressedBuffer: Array.from(compressedBuffer),
      originalSize,
      compressedSize,
      compressionRatio,
      newFileName,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      originalSize: 0,
      compressedSize: 0,
      compressionRatio: 0,
      newFileName: '',
    };
  }
}

// Worker entry point
if (parentPort != null && workerData != null) {
  processAudio(workerData as WorkerInput)
    .then((result) => {
      parentPort!.postMessage(result);
    })
    .catch((error) => {
      parentPort!.postMessage({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        originalSize: 0,
        compressedSize: 0,
        compressionRatio: 0,
        newFileName: '',
      });
    });
}

export { processAudio };
