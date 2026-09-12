import { describe, expect, test } from 'bun:test';
import {
  SOLNA_OPEN_TYPE,
  SOLNA_SAVE_TYPE,
  ensureWritePermission,
  fileNameWithoutExtension,
  pickLocalOpenHandle,
  pickLocalSaveHandle,
  readTextFromHandle,
  resolveSaveFilePicker,
  writeTextToHandle,
} from './localFileSave';

const handle = (name = 'sketch.solna') => ({ name }) as unknown as FileSystemFileHandle;

describe('resolveSaveFilePicker', () => {
  test('a scope without the API resolves to null — the capability probe, not an error', () => {
    expect(resolveSaveFilePicker({})).toBeNull();
    expect(resolveSaveFilePicker(null)).toBeNull();
    expect(resolveSaveFilePicker({ showSaveFilePicker: 'nope' })).toBeNull();
  });

  test('the picker is bound to the scope it was found on', async () => {
    const scope = {
      showSaveFilePicker(this: unknown, options?: unknown) {
        return { self: this, options };
      },
    };
    const pick = resolveSaveFilePicker(scope);
    expect(pick).not.toBeNull();
    expect(await pick!({ suggestedName: 'x.solna' })).toEqual({ self: scope, options: { suggestedName: 'x.solna' } });
  });
});

describe('pickLocalSaveHandle', () => {
  test('no API reports unavailable so the caller can fall back to download', async () => {
    expect(await pickLocalSaveHandle('x.solna', {})).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a dismissed picker is a cancel, not a failure', async () => {
    const scope = {
      showSaveFilePicker: async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      },
    };
    expect(await pickLocalSaveHandle('x.solna', scope)).toEqual({ ok: false, reason: 'cancelled' });
  });

  test('a picker that refuses for any other reason is unavailable, never a crash', async () => {
    const scope = {
      showSaveFilePicker: async () => {
        throw new TypeError('blocked by permissions policy');
      },
    };
    expect(await pickLocalSaveHandle('x.solna', scope)).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a chosen handle comes back with the solna picker type offered', async () => {
    const chosen = handle();
    let seen: unknown;
    const scope = {
      showSaveFilePicker: async (options: unknown) => {
        seen = options;
        return chosen;
      },
    };
    expect(await pickLocalSaveHandle('sketch.solna', scope)).toEqual({ ok: true, handle: chosen });
    expect(seen).toEqual({ suggestedName: 'sketch.solna', types: [SOLNA_SAVE_TYPE] });
  });
});

describe('pickLocalOpenHandle', () => {
  test('no API reports unavailable so the caller can fall back to the file input', async () => {
    expect(await pickLocalOpenHandle({})).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a dismissed picker is a cancel: the open simply does not happen', async () => {
    const scope = {
      showOpenFilePicker: async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      },
    };
    expect(await pickLocalOpenHandle(scope)).toEqual({ ok: false, reason: 'cancelled' });
  });

  test('asks for one solna file and unwraps the array the API returns', async () => {
    const chosen = handle('mix.solna');
    let seen: unknown;
    const scope = {
      showOpenFilePicker: async (options: unknown) => {
        seen = options;
        return [chosen];
      },
    };
    expect(await pickLocalOpenHandle(scope)).toEqual({ ok: true, handle: chosen });
    expect(seen).toEqual({ multiple: false, types: [SOLNA_OPEN_TYPE] });
  });

  test('an empty selection is a cancel, not a crash on [0]', async () => {
    expect(await pickLocalOpenHandle({ showOpenFilePicker: async () => [] })).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  test('the open type also accepts .json — the mobile providers that rewrite the extension', () => {
    expect(SOLNA_OPEN_TYPE.accept['application/json']).toEqual(['.solna', '.json']);
    expect(SOLNA_SAVE_TYPE.accept['application/json']).toEqual(['.solna']);
  });
});

describe('readTextFromHandle', () => {
  test('reads through getFile so the same handle can be written back later', async () => {
    const target = {
      getFile: async () => ({ text: async () => '{"a":1}', size: 7 }),
    } as unknown as FileSystemFileHandle;
    expect(await readTextFromHandle(target)).toBe('{"a":1}');
  });

  test('an unreadable handle yields empty text, which parses as malformed', async () => {
    // Same contract as readFileAsText: the caller reports "not a Solna project"
    // rather than catching a DOMException of its own.
    const target = {
      getFile: async () => {
        throw new DOMException('gone', 'NotFoundError');
      },
    } as unknown as FileSystemFileHandle;
    expect(await readTextFromHandle(target)).toBe('');
  });
});

describe('writeTextToHandle', () => {
  test('writes the text and closes the stream, in that order', async () => {
    const calls: string[] = [];
    const target = {
      createWritable: async () => ({
        write: async (text: string) => {
          calls.push(`write:${text}`);
        },
        close: async () => {
          calls.push('close');
        },
      }),
    } as unknown as FileSystemFileHandle;
    await writeTextToHandle(target, '{"a":1}');
    expect(calls).toEqual(['write:{"a":1}', 'close']);
  });

  test('a refused write rejects so the caller can surface a notice', async () => {
    const target = {
      createWritable: async () => ({
        write: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
        close: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    // `await`, not a bare expect: an un-awaited assertion on a floating promise
    // passes whatever the code does. Spread over try/catch rather than a
    // `.rejects` matcher because this repo's `bun:test` shim declares no
    // `.rejects` member — see src/types/bun-test.d.ts.
    let caught: unknown;
    try {
      await writeTextToHandle(target, 'x');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as Error).message).toBe('denied');
  });
});

describe('ensureWritePermission', () => {
  test('a granted handle needs no prompt', async () => {
    let prompts = 0;
    const target = {
      queryPermission: async () => 'granted',
      requestPermission: async () => {
        prompts++;
        return 'granted';
      },
    } as unknown as FileSystemFileHandle;
    expect(await ensureWritePermission(target)).toBe(true);
    expect(prompts).toBe(0);
  });

  test('a prompt-state handle is asked once and its answer is the result', async () => {
    const target = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'denied',
    } as unknown as FileSystemFileHandle;
    expect(await ensureWritePermission(target)).toBe(false);
  });

  test('a handle without the permission API writes straight through', async () => {
    expect(await ensureWritePermission(handle())).toBe(true);
  });
});

describe('fileNameWithoutExtension', () => {
  test('drops a .solna suffix and keeps the rest', () => {
    expect(fileNameWithoutExtension('my-sketch.solna')).toBe('my-sketch');
    expect(fileNameWithoutExtension('my.sketch.solna')).toBe('my.sketch');
    expect(fileNameWithoutExtension('sketch')).toBe('sketch');
  });
});
