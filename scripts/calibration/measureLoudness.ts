/**
 * Ported from murva's `scripts/calibration/measureLoudness.ts`. Two changes and
 * no others: ffmpeg comes from PATH (see ffmpegPath.ts) rather than
 * `@ffmpeg-installer/ffmpeg`, and the pure median selection is split out so it
 * can be tested without spawning anything.
 */
import { spawn } from 'node:child_process';
import { toDbfs, type Dbfs } from '@/utils/gainUnits';
import { resolveFfmpegPath } from './ffmpegPath.ts';
import { parseEbur128Output } from './parseEbur128Output.ts';

/**
 * A single representative short-term LUFS reading: the MEDIAN of every valid `S:`
 * sample. Median, not mean, so one anomalous frame cannot skew a committed default.
 */
export function medianShortTermLufs(stderr: string, label: string): number {
  const { shortTermLufs } = parseEbur128Output(stderr);
  if (shortTermLufs.length === 0) {
    throw new Error(
      `No valid short-term LUFS readings for ${label}. Either the rendered clip is ` +
        `shorter than the EBU R128 3s short-term gate — widen the calibration pattern's ` +
        `duration — or the voice is genuinely silent, which is a bug in the voice, not ` +
        `in this harness. Play it in the app before assuming the harness is wrong.`,
    );
  }
  const sorted = [...shortTermLufs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === undefined) throw new Error(`Unreachable: empty LUFS sample for ${label}`);
  return median;
}

export async function measureLoudness(wavPath: string, label = wavPath): Promise<Dbfs> {
  const ffmpeg = resolveFfmpegPath();
  const stderr = await new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-i', wavPath, '-af', 'ebur128', '-f', 'null', '-']);
    let output = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', reject);
  });
  return toDbfs(medianShortTermLufs(stderr, label));
}
