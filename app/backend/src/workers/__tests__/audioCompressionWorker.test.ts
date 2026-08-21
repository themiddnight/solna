/**
 * Unit tests for audioCompressionWorker decision logic.
 *
 * Documents the skip-if-optimized decision tree of `processAudio`:
 * - .ogg + opus codec + bitrate within tolerance -> skipped, ratio 1, buffer unmodified
 * - non-.ogg input -> always re-encode (skip check short-circuits before ffprobe)
 * - ffprobe failure -> skip check returns false, falls through to re-encode, no crash
 * - encode failure -> success:false payload, never throws
 * - filename rewrite to `${base}.ogg` and the ratio guard when originalSize === 0
 *
 * All ffmpeg/ffprobe/fs work is mocked — no real encoding ever runs. The worker
 * entry point is gated by `parentPort != null`, so importing the module in the
 * jest main thread is side-effect-free (verified by the first test).
 */
import { parentPort } from 'worker_threads';
import ffmpeg from 'fluent-ffmpeg';
import type { FfprobeData, FfprobeFormat, FfprobeStream } from 'fluent-ffmpeg';
import fs from 'fs/promises';
import { processAudio } from '@/workers/audioCompressionWorker';
import type { WorkerInput } from '@/workers/audioCompressionWorker';

/**
 * Shared fluent-ffmpeg command chain. The mock factory returns this same chain
 * instance so tests can drive `on('end')` / `on('error')` and assert the exact
 * encode options the worker applies. (The `mock` prefix is what jest's hoist
 * plugin permits the factory to reference.)
 */
const mockFfmpegChain = {
  audioCodec: jest.fn(),
  audioBitrate: jest.fn(),
  audioChannels: jest.fn(),
  format: jest.fn(),
  outputOptions: jest.fn(),
  on: jest.fn(),
  save: jest.fn(),
};

jest.mock('fluent-ffmpeg', () => {
  // module.exports is the callable itself, mirroring the real CJS export —
  // esModuleInterop resolves a default import straight to it.
  return Object.assign(jest.fn(() => mockFfmpegChain), {
    ffprobe: jest.fn(),
    setFfmpegPath: jest.fn(),
    setFfprobePath: jest.fn(),
  });
});

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  mkdir: jest.fn(),
}));

/** Event handlers registered by the worker through the chain's `on()` method. */
const chainHandlers: Record<string, (error?: Error) => void> = {};

/** ffprobe behavior, set per test. */
let mockFfprobeError: Error | null = null;
let mockFfprobeData: FfprobeData | null = null;

/** Error the mocked encode should fail with; null means the encode succeeds. */
let mockEncodeError: Error | null = null;

/**
 * Builds an ffprobe result for an ogg/opus file. Field assignments (instead of
 * object literals) keep the snake_case wire-format names out of
 * naming-convention lint checks.
 */
function opusOggProbe(bitRate: string): FfprobeData {
  const format: FfprobeFormat = {} as FfprobeFormat;
  format.format_name = 'ogg';
  const stream: FfprobeStream = {} as FfprobeStream;
  stream.index = 0;
  stream.codec_type = 'audio';
  stream.codec_name = 'opus';
  stream.bit_rate = bitRate;
  const data: FfprobeData = {} as FfprobeData;
  data.chapters = [];
  data.format = format;
  data.streams = [stream];
  return data;
}

function baseInput(overrides: Partial<WorkerInput> = {}): WorkerInput {
  return {
    inputPath: overrides.inputPath ?? '/tmp/input-test.mp3',
    outputPath: overrides.outputPath ?? '/tmp/output-test.ogg',
    originalFileName: overrides.originalFileName ?? 'song.mp3',
    targetBitrate: overrides.targetBitrate ?? 64000,
    bitrateTolerance: overrides.bitrateTolerance ?? 10000,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockFfprobeError = null;
  mockFfprobeData = null;
  mockEncodeError = null;

  for (const key of Object.keys(chainHandlers)) {
    delete chainHandlers[key];
  }

  // Rebuild the command chain behavior (resetMocks clears implementations
  // between tests): `ffmpeg(inputPath)` returns the chain, every chain method
  // returns the chain so the worker can chain calls; `on` captures event
  // handlers; `save` triggers end/error.
  (ffmpeg as unknown as jest.Mock).mockImplementation(() => mockFfmpegChain);
  mockFfmpegChain.audioCodec.mockReturnThis();
  mockFfmpegChain.audioBitrate.mockReturnThis();
  mockFfmpegChain.audioChannels.mockReturnThis();
  mockFfmpegChain.format.mockReturnThis();
  mockFfmpegChain.outputOptions.mockReturnThis();
  mockFfmpegChain.on.mockImplementation(
    (event: string, handler: (error?: Error) => void) => {
      chainHandlers[event] = handler;
      return mockFfmpegChain;
    }
  );
  mockFfmpegChain.save.mockImplementation(() => {
    if (mockEncodeError != null) {
      chainHandlers.error?.(mockEncodeError);
    } else {
      chainHandlers.end?.();
    }
  });

  (ffmpeg.ffprobe as jest.Mock).mockImplementation(
    (_filePath: string, callback: (error: Error | null, data: FfprobeData) => void) => {
      callback(mockFfprobeError, mockFfprobeData as FfprobeData);
    }
  );

  (fs.stat as jest.Mock).mockResolvedValue({ size: 5120 });
});

describe('audioCompressionWorker decision logic', () => {
  describe('module import', () => {
    it('imports side-effect-free in the main thread: the parentPort guard keeps the worker entry point dormant', () => {
      // In the jest main thread parentPort is null, so the
      // `if (parentPort != null && workerData != null)` entry block never runs.
      expect(parentPort).toBeNull();
      expect(typeof processAudio).toBe('function');
    });
  });

  describe('checkIfOptimized skip decision', () => {
    it('skips re-encoding when the file is .ogg with opus codec and bitrate within tolerance', async () => {
      mockFfprobeData = opusOggProbe('64000');
      const originalBuffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
      (fs.readFile as jest.Mock).mockResolvedValue(originalBuffer);

      const result = await processAudio(
        baseInput({ originalFileName: 'track.ogg', targetBitrate: 64000, bitrateTolerance: 10000 })
      );

      expect(result).toMatchObject({
        success: true,
        skipped: true,
        originalSize: 5120,
        compressedSize: 5120,
        compressionRatio: 1,
        newFileName: 'track.ogg',
      });
      // Buffer is returned unmodified.
      expect(result.compressedBuffer).toEqual(Array.from(originalBuffer));
      expect(Buffer.from(result.compressedBuffer ?? [])).toEqual(originalBuffer);
      // No encoding was triggered at all.
      expect(ffmpeg).not.toHaveBeenCalled();
      expect(mockFfmpegChain.save).not.toHaveBeenCalled();
      // Only the input file was read (never the output path).
      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(fs.readFile).toHaveBeenCalledWith('/tmp/input-test.mp3');
      // The skip check did probe the file.
      expect(ffmpeg.ffprobe).toHaveBeenCalled();
    });

    it('always re-encodes non-.ogg inputs without probing metadata', async () => {
      (fs.stat as jest.Mock).mockResolvedValue({ size: 2048 });
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('COMPRESSED-DATA'));

      const result = await processAudio(baseInput({ originalFileName: 'song.mp3' }));

      expect(result).toMatchObject({
        success: true,
        skipped: false,
        originalSize: 2048,
        compressedSize: 15,
        compressionRatio: 15 / 2048,
        newFileName: 'song.ogg',
      });
      // Skip check short-circuits before ffprobe for non-.ogg names.
      expect(ffmpeg.ffprobe).not.toHaveBeenCalled();
      // Encode ran with the exact opus/ogg settings and output path.
      expect(ffmpeg).toHaveBeenCalledWith('/tmp/input-test.mp3');
      expect(mockFfmpegChain.audioCodec).toHaveBeenCalledWith('libopus');
      expect(mockFfmpegChain.audioBitrate).toHaveBeenCalledWith('192k');
      expect(mockFfmpegChain.audioChannels).toHaveBeenCalledWith(2);
      expect(mockFfmpegChain.format).toHaveBeenCalledWith('ogg');
      expect(mockFfmpegChain.outputOptions).toHaveBeenCalledWith(['-vbr', 'on']);
      expect(mockFfmpegChain.save).toHaveBeenCalledWith('/tmp/output-test.ogg');
    });

    it('falls through to re-encode when ffprobe fails (skip check returns false, no crash)', async () => {
      mockFfprobeError = new Error('ffprobe exploded');
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('COMPRESSED-DATA'));

      const result = await processAudio(baseInput({ originalFileName: 'clip.ogg' }));

      expect(result).toMatchObject({
        success: true,
        skipped: false,
        newFileName: 'clip.ogg',
      });
      expect(ffmpeg).toHaveBeenCalledWith('/tmp/input-test.mp3');
      expect(mockFfmpegChain.save).toHaveBeenCalledWith('/tmp/output-test.ogg');
    });

    it('re-encodes .ogg files whose bitrate is outside the tolerance window', async () => {
      mockFfprobeData = opusOggProbe('128000');
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('COMPRESSED-DATA'));

      const result = await processAudio(baseInput({ originalFileName: 'loud.ogg' }));

      expect(result).toMatchObject({
        success: true,
        skipped: false,
        newFileName: 'loud.ogg',
      });
      expect(mockFfmpegChain.save).toHaveBeenCalledWith('/tmp/output-test.ogg');
    });
  });

  describe('encode failure handling', () => {
    it('returns a success:false payload and never throws when encoding fails', async () => {
      mockEncodeError = new Error('FFmpeg encoding failed: boom');
      (fs.stat as jest.Mock).mockResolvedValue({ size: 2048 });

      // `resolves` documents that processAudio resolves with the error payload
      // instead of rejecting across the port.
      await expect(processAudio(baseInput({ originalFileName: 'fail.mp3' }))).resolves.toEqual({
        success: false,
        error: 'FFmpeg encoding failed: boom',
        originalSize: 0,
        compressedSize: 0,
        compressionRatio: 0,
        newFileName: '',
      });
      // The compressed output is never read after a failed encode.
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  describe('filename rewrite and ratio guard', () => {
    it('rewrites the filename to ${base}.ogg', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('COMPRESSED-DATA'));

      const result = await processAudio(baseInput({ originalFileName: 'my-session.wav' }));

      expect(result.newFileName).toBe('my-session.ogg');
      expect(result).toMatchObject({ success: true, skipped: false });
    });

    it('guards the ratio when the original file size is 0 (ratio falls back to 1, not Infinity)', async () => {
      (fs.stat as jest.Mock).mockResolvedValue({ size: 0 });
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('x'));

      const result = await processAudio(baseInput({ originalFileName: 'empty.wav' }));

      expect(result).toMatchObject({
        success: true,
        skipped: false,
        originalSize: 0,
        compressedSize: 1,
        compressionRatio: 1,
        newFileName: 'empty.ogg',
      });
    });
  });
});
