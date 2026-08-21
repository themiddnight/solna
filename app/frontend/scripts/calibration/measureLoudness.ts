import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { spawn } from "node:child_process";
import { toDbfs, type Dbfs } from "../../src/shared/audio/gainUnits";
import { parseEbur128Output } from "./parseEbur128Output";

/** Runs ffmpeg's ebur128 filter over a rendered calibration WAV and returns a single
 * representative short-term LUFS reading: the MEDIAN of every valid S: sample (already
 * gate-filtered by `parseEbur128Output` — EBU R128 short-term needs a 3s rolling window before
 * its first reading is meaningful, so every calibration pattern must render for 3s+ or this
 * throws with zero samples) — median, not mean, so one anomalous frame doesn't skew the
 * committed default. */
export async function measureLoudness(wavPath: string): Promise<Dbfs> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpegPath.path, ["-i", wavPath, "-af", "ebur128", "-f", "null", "-"]);
    let output = "";
    proc.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    proc.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`ffmpeg exited ${code}`))));
    proc.on("error", reject);
  });

  const { shortTermLufs } = parseEbur128Output(stderr);
  if (shortTermLufs.length === 0) {
    throw new Error(
      `No valid short-term LUFS readings for ${wavPath} — the rendered clip is likely shorter ` +
        `than the EBU R128 3s short-term gate. Widen the calibration pattern's duration.`,
    );
  }
  const sorted = [...shortTermLufs].sort((a, b) => a - b);
  const median = sorted.at(Math.floor(sorted.length / 2));
  if (median === undefined) throw new Error(`Unreachable: empty LUFS sample for ${wavPath}`);
  return toDbfs(median);
}
