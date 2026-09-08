import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  loopPlayButton,
  playbackScopeReducer,
  rescopeToLoop,
  restartAfterStop,
  SCOPE_NONE,
  SCOPE_SONG,
  scopedLoopId,
  type PlaybackScope,
  type PlaybackScopeAction,
} from './playbackScope';

const LOOP_A: PlaybackScope = { kind: 'loop', loopId: 'A' };

const PLAY_ALL: PlaybackScopeAction = { type: 'play-all' };
const STOP_ALL: PlaybackScopeAction = { type: 'stop-all' };
const TOGGLE_A: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'A' };
const TOGGLE_B: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'B' };
const FOCUS_A: PlaybackScopeAction = { type: 'focus-loop', loopId: 'A' };
const FOCUS_B: PlaybackScopeAction = { type: 'focus-loop', loopId: 'B' };

// Every cell of the transition table, as data.
const TABLE: Array<[PlaybackScope, PlaybackScopeAction, PlaybackScope]> = [
  [SCOPE_NONE, PLAY_ALL, { kind: 'song' }],
  [SCOPE_NONE, STOP_ALL, { kind: 'none' }],
  [SCOPE_NONE, TOGGLE_A, { kind: 'loop', loopId: 'A' }],
  [SCOPE_NONE, TOGGLE_B, { kind: 'loop', loopId: 'B' }],
  [SCOPE_NONE, FOCUS_A, { kind: 'none' }],
  [SCOPE_NONE, FOCUS_B, { kind: 'none' }],

  [SCOPE_SONG, PLAY_ALL, { kind: 'song' }],
  [SCOPE_SONG, STOP_ALL, { kind: 'none' }],
  [SCOPE_SONG, TOGGLE_A, { kind: 'song' }],
  [SCOPE_SONG, TOGGLE_B, { kind: 'song' }],
  [SCOPE_SONG, FOCUS_A, { kind: 'none' }],
  [SCOPE_SONG, FOCUS_B, { kind: 'none' }],

  [LOOP_A, PLAY_ALL, { kind: 'song' }],
  [LOOP_A, STOP_ALL, { kind: 'none' }],
  [LOOP_A, TOGGLE_A, { kind: 'none' }],
  [LOOP_A, TOGGLE_B, { kind: 'loop', loopId: 'A' }],
  [LOOP_A, FOCUS_A, { kind: 'loop', loopId: 'A' }],
  [LOOP_A, FOCUS_B, { kind: 'none' }],
];

describe('playbackScopeReducer', () => {
  for (const [from, action, expected] of TABLE) {
    const label = from.kind === 'loop' ? `loop(${from.loopId})` : from.kind;
    const act =
      action.type === 'toggle-loop'
        ? `toggle-loop(${action.loopId})`
        : action.type === 'focus-loop'
        ? `focus-loop(${action.loopId})`
        : action.type;
    test(`${label} + ${act} -> ${expected.kind === 'loop' ? `loop(${expected.loopId})` : expected.kind}`, () => {
      expect(playbackScopeReducer(from, action)).toEqual(expected);
    });
  }

  // The bug, stated as an invariant: no action can leave a solo-loop id
  // behind under a song, and none can produce a solo loop the user did not
  // ask for.
  test('play-all takes over from a solo loop — a loop id can never survive it', () => {
    expect(playbackScopeReducer(LOOP_A, PLAY_ALL)).toEqual({ kind: 'song' });
    expect(scopedLoopId(playbackScopeReducer(LOOP_A, PLAY_ALL))).toBe(null);
  });

  test('no-op transitions return the identical object (songMode compares by ===)', () => {
    expect(playbackScopeReducer(SCOPE_NONE, STOP_ALL)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_NONE, FOCUS_A)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(LOOP_A, FOCUS_A)).toBe(LOOP_A);
    expect(playbackScopeReducer(SCOPE_SONG, PLAY_ALL)).toBe(SCOPE_SONG);
    expect(playbackScopeReducer(LOOP_A, TOGGLE_B)).toBe(LOOP_A);
  });

  // §6's rule, restated as the reducer sees it. The player-state half of
  // each row is asserted in songMode.test.ts, where a stop actually happens.
  test('focus-loop keeps exactly what the focused loop is sounding', () => {
    // Nothing sounding: nothing to reconcile.
    expect(playbackScopeReducer(SCOPE_NONE, FOCUS_B)).toBe(SCOPE_NONE);
    // The loop in focus is the one sounding: it survives, same reference.
    expect(playbackScopeReducer(LOOP_A, FOCUS_A)).toBe(LOOP_A);
    // A different loop is sounding: it is not what the user is now looking at.
    expect(playbackScopeReducer(LOOP_A, FOCUS_B)).toBe(SCOPE_NONE);
    // The arrangement is sounding: an arrangement is never "the loop in focus".
    expect(playbackScopeReducer(SCOPE_SONG, FOCUS_A)).toBe(SCOPE_NONE);
  });
});

describe('restartAfterStop — what an internal stop-and-restart brings back', () => {
  test('nothing was playing: nothing restarts and the scope stays stopped', () => {
    expect(restartAfterStop(LOOP_A, 'A', 'loop', false)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
    expect(restartAfterStop(SCOPE_SONG, 'A', 'song', false)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
  });

  test('a song scope survives on either layer: the arrangement owns the transport', () => {
    expect(restartAfterStop(SCOPE_SONG, 'B', 'song', true)).toEqual({
      restart: true,
      scope: SCOPE_SONG,
    });
    expect(restartAfterStop(SCOPE_SONG, 'B', 'loop', true)).toEqual({
      restart: true,
      scope: SCOPE_SONG,
    });
  });

  test('switching the working loop ON THE LOOP LAYER is seamless and re-points', () => {
    expect(restartAfterStop(LOOP_A, 'B', 'loop', true)).toEqual({
      restart: true,
      scope: { kind: 'loop', loopId: 'B' },
    });
  });

  test('reloading the loop that is already auditioning keeps it playing', () => {
    expect(restartAfterStop(LOOP_A, 'A', 'song', true)).toEqual({
      restart: true,
      scope: LOOP_A,
    });
    // toBe, not toEqual: this row must hand BACK the scope it was given, not
    // an equal rebuild. songMode's subscribeWithSelector compares scopes with
    // === (see the reducer's own identity test above), so a refactor that
    // returned `{ kind: 'loop', loopId: focusedLoopId }` here would look
    // correct and re-run reconcile on every reload of the auditioning loop.
    expect(restartAfterStop(LOOP_A, 'A', 'song', true).scope).toBe(LOOP_A);
    expect(restartAfterStop(LOOP_A, 'A', 'loop', true).scope).toBe(LOOP_A);
  });

  // The fall-through cell, and the only one that stops rather than heals: on
  // the SONG layer an unscoped restart has no loop to claim, so it declines.
  // Unreachable in production now that nothing outside transportSlice.ts can
  // call play(module), but reachable from a fixture — and the function is
  // total, so the cell has an answer whether or not a test names it.
  test('a none scope with players running is NOT healed on the song layer', () => {
    expect(restartAfterStop(SCOPE_NONE, 'B', 'song', true)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
    expect(restartAfterStop(SCOPE_NONE, 'B', 'song', true).scope).toBe(SCOPE_NONE);
  });

  // §6 row 3, in its pure form: picking a DIFFERENT loop on the song layer
  // while one is auditioning stops the audition. It does not follow the pick.
  test('picking a different loop ON THE SONG LAYER stops the audition', () => {
    expect(restartAfterStop(LOOP_A, 'B', 'song', true)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
  });

  // Unreachable while "playing implies a scope" holds, but the function is
  // total and heals rather than propagating the broken state.
  test('a none scope with players running is healed on the loop layer', () => {
    expect(restartAfterStop(SCOPE_NONE, 'B', 'loop', true)).toEqual({
      restart: true,
      scope: { kind: 'loop', loopId: 'B' },
    });
  });
});

/**
 * The INVARIANT comment above states that the only file referencing
 * play(module) is the slice that defines it, as a fact a reviewer can check.
 * The comment cannot enforce itself: a new caller added anywhere in src/
 * would leave it holding a stale claim with nothing failing. This is the
 * same shape as
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
  // Everything that may legitimately reference the per-module play(module):
  // the slice that defines it. Nothing else. Phase 3 closed the two holes
  // this list used to hold open — loadLoop.ts and vibes.ts now restart
  // through one set() that writes the scope with the players (see
  // restartPlayersPatch) — so a production file reaching for play(module)
  // again is re-opening a closed hole, not joining a documented exception.
  // Test files are exempt below by extension, not listed here, because they
  // legitimately drive play(module) as a fixture and never run in production.
  const ALLOWED = new Set(['src/store/transportSlice.ts']);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
      return [path];
    });
  }

  // A member CALL (`store.play('sequencer')`, `h.state.play('chords')`) is
  // not the only risky shape: the dominant idiom in this repo binds a slice
  // action through a selector and calls the bare local afterwards —
  // `const play = useAppStore((s) => s.play); …; onPlay={() => play(tab.module)}`
  // is exactly how TransportBar.tsx binds playAll/softStopAll/hardStopAll
  // today, and it is the literal shape commit 331bf86 deleted from
  // Header.tsx's per-tab play buttons. A call-shaped pattern anchored on
  // `.play(` never sees that: the call itself is bare (`play(...)`, no
  // dot), only the binding line (`s.play`) carries one.
  //
  // So this matches ANY `.play` member reference, not just a call —
  // `\.play\b` — which catches the binding site instead of the call site.
  // Checked against every occurrence of `.play` in src/ before landing on
  // this: it matches nothing outside store/*.ts and store/*.test.ts (no
  // HTMLMediaElement .play(), no unrelated method), and the trailing `\b`
  // rules out `.playAll`, `.playbackScope`, `.playTargetLabel` and every
  // other `play`-prefixed identifier in the tree — so it needs no allowlist
  // entries beyond the one already here. Rejected the narrower
  // identifier-call alternative (`/(?<![.\w])play\s*\(\s*[^)]/`): it only
  // matches a BARE call and would stop seeing `store.play(...)` entirely,
  // trading one blind spot for another instead of covering both shapes.
  const CALL = /\.play\b/;

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
            `invariant songMode reads (see the INVARIANT comment above ` +
            `playbackScope.ts's PlaybackScope type). Route the new caller ` +
            `through playAll/soloLoop, or through restartAfterStop + ` +
            `restartPlayersPatch if it is an internal stop-and-restart like ` +
            `loadLoop's.`,
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
  test('loop: the auditioning card is enabled, the others are disabled', () => {
    expect(loopPlayButton(LOOP_A, 'A')).toEqual({ disabled: false });
    expect(loopPlayButton(LOOP_A, 'B')).toEqual({ disabled: true });
  });
});

describe('rescopeToLoop — the scope follows a cursor move that changes no sound', () => {
  test('a loop scope re-points at the new cursor', () => {
    expect(rescopeToLoop(LOOP_A, 'B')).toEqual({ kind: 'loop', loopId: 'B' });
  });

  test('the same id returns the identical object (songMode compares by ===)', () => {
    expect(rescopeToLoop(LOOP_A, 'A')).toBe(LOOP_A);
  });

  test('a song scope is untouched: the arrangement is not one loop', () => {
    expect(rescopeToLoop(SCOPE_SONG, 'B')).toBe(SCOPE_SONG);
  });

  test('a stopped transport stays stopped — this never claims a scope', () => {
    expect(rescopeToLoop(SCOPE_NONE, 'B')).toBe(SCOPE_NONE);
  });
});
