import { describe, expect, test } from 'bun:test';
import { resolveFfmpegPath } from './ffmpegPath.ts';

describe('resolveFfmpegPath', () => {
  test('throws an install instruction when the binary is not on PATH', () => {
    expect(() => resolveFfmpegPath('solna-definitely-not-a-real-binary')).toThrow(
      /solna-definitely-not-a-real-binary is not on PATH/,
    );
  });

  test('the thrown message names the install command, not just the failure', () => {
    expect(() => resolveFfmpegPath('solna-definitely-not-a-real-binary')).toThrow(
      /brew install ffmpeg/,
    );
  });

  test('resolves a binary that is always present to an absolute path', () => {
    // `sh` is on PATH on every POSIX machine this repo is developed on, so the
    // positive case is provable without asserting that ffmpeg itself is installed —
    // which would make `bun test` red on a machine that only ever reads the
    // committed table, exactly the machine this harness is designed not to burden.
    expect(resolveFfmpegPath('sh')).toMatch(/^\//);
  });
});
