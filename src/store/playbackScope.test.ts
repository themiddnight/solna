import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  loopPlayButton,
  playbackScopeReducer,
  SCOPE_NONE,
  SCOPE_SONG,
  soloLoopId,
  type PlaybackScope,
  type PlaybackScopeAction,
} from './playbackScope';

const SOLO_A: PlaybackScope = { kind: 'solo', loopId: 'A' };

const PLAY_ALL: PlaybackScopeAction = { type: 'play-all' };
const STOP_ALL: PlaybackScopeAction = { type: 'stop-all' };
const LAYER: PlaybackScopeAction = { type: 'layer-change' };
const TOGGLE_A: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'A' };
const TOGGLE_B: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'B' };

// Every cell of the transition table, as data.
const TABLE: Array<[PlaybackScope, PlaybackScopeAction, PlaybackScope]> = [
  [SCOPE_NONE, PLAY_ALL, { kind: 'song' }],
  [SCOPE_NONE, STOP_ALL, { kind: 'none' }],
  [SCOPE_NONE, TOGGLE_A, { kind: 'solo', loopId: 'A' }],
  [SCOPE_NONE, TOGGLE_B, { kind: 'solo', loopId: 'B' }],
  [SCOPE_NONE, LAYER, { kind: 'none' }],

  [SCOPE_SONG, PLAY_ALL, { kind: 'song' }],
  [SCOPE_SONG, STOP_ALL, { kind: 'none' }],
  [SCOPE_SONG, TOGGLE_A, { kind: 'song' }],
  [SCOPE_SONG, TOGGLE_B, { kind: 'song' }],
  [SCOPE_SONG, LAYER, { kind: 'none' }],

  [SOLO_A, PLAY_ALL, { kind: 'song' }],
  [SOLO_A, STOP_ALL, { kind: 'none' }],
  [SOLO_A, TOGGLE_A, { kind: 'none' }],
  [SOLO_A, TOGGLE_B, { kind: 'solo', loopId: 'A' }],
  [SOLO_A, LAYER, { kind: 'none' }],
];

describe('playbackScopeReducer', () => {
  for (const [from, action, expected] of TABLE) {
    const label = from.kind === 'solo' ? `solo(${from.loopId})` : from.kind;
    const act = action.type === 'toggle-loop' ? `toggle-loop(${action.loopId})` : action.type;
    test(`${label} + ${act} -> ${expected.kind === 'solo' ? `solo(${expected.loopId})` : expected.kind}`, () => {
      expect(playbackScopeReducer(from, action)).toEqual(expected);
    });
  }

  // The bug, stated as an invariant: no action can leave a solo id behind
  // under a song, and none can produce a solo the user did not ask for.
  test('play-all takes over from a solo — a solo id can never survive it', () => {
    expect(playbackScopeReducer(SOLO_A, PLAY_ALL)).toEqual({ kind: 'song' });
    expect(soloLoopId(playbackScopeReducer(SOLO_A, PLAY_ALL))).toBe(null);
  });

  test('no-op transitions return the identical object (songMode compares by ===)', () => {
    expect(playbackScopeReducer(SCOPE_NONE, STOP_ALL)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_NONE, LAYER)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_SONG, PLAY_ALL)).toBe(SCOPE_SONG);
    expect(playbackScopeReducer(SOLO_A, TOGGLE_B)).toBe(SOLO_A);
  });
});

/**
 * The INVARIANT comment above names exactly two call sites — loadLoop.ts and
 * vibes.ts — that restart through play(module) with no scope, and states
 * that as a fact a reviewer can check. The comment cannot enforce itself: a
 * third caller added anywhere in src/ would leave it holding a stale claim
 * with nothing failing. This is the same shape as
 * `src/data/dataLayerPurity.test.ts` — a filesystem scan plus an explicit
 * allowlist — applied to a store invariant instead of an eslint rule.
 *
 * It is deliberately a separate assertion from `transportSlice.test.ts`'s
 * "per-module play never touches the scope" test just above (in this file's
 * sibling): that test pins the SLICE's `play` action doing nothing to the
 * scope, by design. This test pins WHO is allowed to call it, which the
 * slice-level test cannot see at all.
 */
describe('play(module) caller guard', () => {
  // Everything that may legitimately call the per-module play(module) with
  // no scope set: the two documented holes named in playbackScope.ts's
  // INVARIANT comment, and the slice that defines `play` itself. Test files
  // are exempt below by extension, not listed here, because they legitimately
  // drive `play(module)` as a fixture and never run in production.
  const ALLOWED = new Set([
    'src/store/loadLoop.ts',
    'src/store/vibes.ts',
    'src/store/transportSlice.ts',
  ]);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
      return [path];
    });
  }

  // The real call shapes in this repo are store.play('sequencer'),
  // store.play(module) and h.state.play('chords') — always a `.play(`
  // member call with a non-empty argument. Deliberately not anchored to a
  // string-literal argument, so a future caller passing a variable (the way
  // loadLoop.ts and vibes.ts pass `module`) is still caught.
  const CALL = /\.play\(\s*[^)]+\)/;

  // Strip comments before matching. Prose referencing `store.play(module)` —
  // like the INVARIANT comment this guard sits next to — must not itself
  // read as a caller; a scan that can't tell code from documentation would
  // force this file's own comments to dodge the pattern they describe.
  function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  test('every play(module) call site outside the allowlist is a new, undocumented hole', () => {
    const offenders: string[] = [];
    const root = process.cwd();
    for (const path of sourceFiles(join(root, 'src'))) {
      const rel = path.slice(root.length + 1).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const text = stripComments(readFileSync(path, 'utf8'));
      if (CALL.test(text)) {
        offenders.push(
          `${rel} calls play(module) but is not on the allowlist ` +
            `(${[...ALLOWED].join(', ')}). play(module) can start a stopped ` +
            `player without setting a playbackScope, which breaks the ` +
            `invariant Phase 3 reads (see the INVARIANT comment above ` +
            `playbackScope.ts's PlaybackScope type). Route the new caller ` +
            `through playAll/soloLoop instead, or — only with a documented ` +
            `reason matching loadLoop.ts/vibes.ts — add it to ALLOWED here.`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('loopPlayButton', () => {
  test('unscoped: every card offers Play', () => {
    expect(loopPlayButton(SCOPE_NONE, 'A')).toEqual({ disabled: false });
  });
  test('song scope disables every card button', () => {
    expect(loopPlayButton(SCOPE_SONG, 'A')).toEqual({ disabled: true });
    expect(loopPlayButton(SCOPE_SONG, 'B')).toEqual({ disabled: true });
  });
  test('solo: the soloing card is enabled, the others are disabled', () => {
    expect(loopPlayButton(SOLO_A, 'A')).toEqual({ disabled: false });
    expect(loopPlayButton(SOLO_A, 'B')).toEqual({ disabled: true });
  });
});
