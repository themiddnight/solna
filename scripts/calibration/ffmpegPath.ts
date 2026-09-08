/**
 * Locates the ffmpeg the calibration harness measures with.
 *
 * solna uses the SYSTEM ffmpeg on PATH rather than murva's
 * `@ffmpeg-installer/ffmpeg`. D-383-2 commits this epic to exactly one new
 * devDependency (`node-web-audio-api`); a second one shipping platform
 * binaries, for a script that runs manually on a machine that already has
 * ffmpeg, is footprint for nothing. The cost is that "not installed" must be a
 * clear error rather than an impossibility — which is this file.
 */

// The full `bun-types` package globally re-types `bun:test`'s `spyOn`/`mock`
// surface in ways that conflict with the signatures the existing `src/`
// suite already compiles against, so it is not added as a devDependency
// here. This is the one Bun global this file needs, scoped to this module
// only — it does not leak into or affect any other file's types.
declare const Bun: { which(command: string): string | null };

export function resolveFfmpegPath(binary = 'ffmpeg'): string {
  // `Bun.which` resolves via Bun's own PATH search, unlike shelling out to
  // `/usr/bin/which` — a binary that is not guaranteed to exist on every
  // machine this harness runs on, and whose absence previously reported
  // "not on PATH" even when the binary was sitting right there.
  const path = Bun.which(binary);
  if (path === null || path.length === 0) {
    throw new Error(
      `${binary} is not on PATH. The calibration harness measures loudness with ` +
        `ffmpeg's ebur128 filter; install it with \`brew install ffmpeg\` (macOS) or ` +
        `\`apt install ffmpeg\` (Debian/Ubuntu) and re-run. ` +
        `Nothing in \`bun run verify\` needs it — only \`bun run calibration:generate\`.`,
    );
  }
  if (!path.startsWith('/')) {
    throw new Error(`Bun.which('${binary}') resolved to a non-absolute path: ${path}`);
  }
  return path;
}
