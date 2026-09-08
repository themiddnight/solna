import type { Layer } from '../types';

/**
 * The single source of truth for playback MODE.
 *
 *   none — unscoped. Nothing owns the transport: no card is auditioning, no
 *          card button is disabled, and the arrangement does NOT advance —
 *          songMode's reconcile gates the advance subscription on
 *          `scope.kind === 'song'` specifically, not merely `!== 'loop'`, so
 *          a song never runs while nothing owns the transport. There is no
 *          per-module play left in the song layer to run it anyway; that path
 *          was removed earlier in this phase.
 *   song — Play All owns the transport. Every loop-card button is disabled.
 *   loop — one loop is auditioned alone (a SOLO LOOP). Song advance is
 *          suppressed; that card shows Stop and every other card button is
 *          disabled. Unrelated to TRACK SOLO (`soloTracks` in the ui slice,
 *          formula in store/trackAudibility.ts), which is a set of source
 *          buses, is never persisted, and never touches this union.
 *
 * The three are mutually exclusive by construction, which is the whole point:
 * the old `auditionLoopId: string | null` could sit non-null underneath a
 * running Play All, and nothing but a page refresh cleared it.
 *
 * `songLoopIndex` is NOT part of this union — it is a pure cursor into loops[].
 * Never read its null-ness as a mode.
 *
 * INVARIANT, locked by transportSlice.test.ts: playAll, soloLoop, hardStopAll
 * and softStopAll leave the scope agreeing with the players — playAll and
 * soloLoop start players and set a scope in the same set(); hardStopAll and
 * softStopAll stop them and reset the scope to `none`. Phase 3's focus-loop
 * rule reads the scope alone to decide what survives a navigation, which is
 * only sound while that holds.
 *
 * It holds across the two internal stop-and-restart paths as well, since
 * DEV Phase 3: loadLoop.ts's non-boundary branch and vibes.ts's
 * applyVibeToStore both hard-stop and restart, and both now go through
 * restartAfterStop + restartPlayersPatch, which decide whether the players
 * come back at all and write the scope with them in one set() instead of
 * leaving the `none` that hardStopAll wrote. songMode reads the scope alone
 * to decide what survives a navigation, so a restart that sets no scope
 * would make that decision act on a lie — silence where music should
 * continue, or a hard stop the user did not ask for.
 *
 * A source-scan guard in playbackScope.test.ts keeps that true: the only
 * file allowed to reference play(module) is transportSlice.ts, which defines
 * it. A new caller anywhere else fails the suite.
 */
export type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  /** One loop auditioned alone — a SOLO LOOP. Track solo (`soloTracks` in the
   *  ui slice) is a different feature in a different slice and never appears
   *  here. */
  | { kind: 'loop'; loopId: string };

export type PlaybackScopeAction =
  /** Master transport Play — starts the song, and TAKES OVER from a solo loop. */
  | { type: 'play-all' }
  /** Master transport soft or hard stop. */
  | { type: 'stop-all' }
  /** A loop card's own play/stop button. */
  | { type: 'toggle-loop'; loopId: string }
  /**
   * The Loop layer now shows `loopId` — dispatched when the layer becomes
   * `loop`, and when activeLoopId changes while the layer is already `loop`.
   * It REPLACES 'layer-change', which cleared the scope on any boundary
   * crossing in either direction; entering the Song layer now stops nothing.
   */
  | { type: 'focus-loop'; loopId: string };

/**
 * Frozen singletons: the reducer must be reference-stable for no-op
 * transitions, because songMode's subscribeWithSelector equality compares
 * scopes with === and would otherwise re-run reconcile on every stop.
 */
export const SCOPE_NONE: PlaybackScope = Object.freeze({ kind: 'none' as const });
export const SCOPE_SONG: PlaybackScope = Object.freeze({ kind: 'song' as const });

/**
 * The whole transition logic, in one total pure function.
 *
 * Two cells are unreachable through the UI (a card the UI disables can never
 * be clicked), but the reducer still answers them — with identity, never a
 * new state — so a stray programmatic call can never produce a scope the UI
 * offers no exit from: while `kind === 'song'` every card button is disabled,
 * so `toggle-loop` is a no-op; while `kind === 'loop'` every other card is
 * disabled, so `toggle-loop` for a different id is also a no-op. This holds
 * for the WHOLE arrangement, not just up to the first loop boundary: song
 * advance reloads the next loop via loadLoop, which hard-stops and restarts
 * the players internally, and loadLoop preserves the caller's scope across
 * that internal stop instead of letting it decay to `none` the way a
 * user-initiated Stop does.
 */
export function playbackScopeReducer(
  scope: PlaybackScope,
  action: PlaybackScopeAction,
): PlaybackScope {
  switch (action.type) {
    case 'play-all':
      // Takeover: from a solo loop this is one click, not two. Disabling the
      // transport instead would leave audio sounding with no visible global
      // stop once the auditioning card scrolls out of view.
      return scope.kind === 'song' ? scope : SCOPE_SONG;
    case 'stop-all':
      return scope.kind === 'none' ? scope : SCOPE_NONE;
    case 'focus-loop':
      // "Playback survives a navigation if and only if what sounds
      // afterwards is exactly the loop now in focus."
      //
      // Nothing sounding -> nothing to reconcile, and returning `scope`
      // rather than SCOPE_NONE keeps the reference songMode compares with ===.
      if (scope.kind === 'none') return scope;
      // The loop in focus IS what is sounding: it plays on, across the
      // boundary. This is the carry-over the phase exists to build.
      if (scope.kind === 'loop' && scope.loopId === action.loopId) return scope;
      // Anything else sounding — the arrangement, or a different loop — is
      // not what the user is now editing. SCOPE_NONE means stopped, and
      // songMode turns that into the actual hard stop.
      return SCOPE_NONE;
    case 'toggle-loop':
      if (scope.kind === 'loop') {
        // Same card again = stop. A different card is unreachable (disabled).
        return scope.loopId === action.loopId ? SCOPE_NONE : scope;
      }
      // Unreachable while the song owns the transport: cards stay disabled
      // for the arrangement's whole run, including across the internal
      // restarts song advance drives through loadLoop (see the reducer's
      // own doc comment above).
      if (scope.kind === 'song') return scope;
      return { kind: 'loop', loopId: action.loopId };
  }
}

/**
 * The id of the loop the scope names, or null. The one accessor views should
 * need. Named for the SCOPE, not for "solo", because track solo (`soloTracks`
 * in the ui slice) has nothing to do with this value — a reader grepping
 * `solo` would otherwise get two unrelated features.
 */
export function scopedLoopId(scope: PlaybackScope): string | null {
  return scope.kind === 'loop' ? scope.loopId : null;
}

/** Whether an internal stop-and-restart brings the players back, and under what scope. */
export interface RestartDecision {
  restart: boolean;
  scope: PlaybackScope;
}

/**
 * The decision an INTERNAL stop-and-restart has to make — the shape
 * loadLoop's non-boundary branch and applyVibeToStore both have: capture who
 * was active, hardStopAll (which resets the scope to `none`), rewrite the
 * content, and then decide. Before this existed the "decide" step was three
 * unconditional play(module) calls, which set no scope and left playback
 * running under `none`.
 *
 * The layer is a parameter because it is what distinguishes two user actions
 * that both land here:
 *
 *   LOOP layer — "switch the loop I am editing" while the transport runs.
 *     Seamless by design: the new loop comes up on the next bar line and the
 *     scope re-points to it, because what sounds afterwards IS the loop now
 *     in focus.
 *
 *   SONG layer — "pick a different loop to work on" from an Arrange card or
 *     the header dropdown, while one loop is auditioning. The audition does
 *     NOT follow the pick: it stops. That is §6 row 3 and it is the user's
 *     own request ("ถ้าเข้า edit คนละ loop ที่เล่น solo loop อยู่ ให้ stop").
 *     It is also the only answer consistent with the Arrange UI, which
 *     already disables every other card's play button for the whole run of
 *     an audition — letting a card SELECT move the audition would be a back
 *     door around that rule.
 *
 * A song scope survives either way: an arrangement is not one loop, its
 * cursor was already carried across by the caller, and dropping it would
 * strand a playing song under a scope that means stopped.
 *
 * The `none`-with-players-running row is unreachable while "playing implies
 * a scope" holds. It is answered honestly rather than propagated, because
 * handing songMode a scope that lies is exactly the failure this closes.
 *
 * Distinct from rescopeToLoop below, which answers a different question: this
 * one runs after an internal hard stop and decides whether anything comes
 * back at all; that one moves the scope with the edit cursor for a change
 * that stops nothing, because nothing about the sound changed.
 */
export function restartAfterStop(
  before: PlaybackScope,
  focusedLoopId: string,
  layer: Layer,
  wasPlaying: boolean,
): RestartDecision {
  if (!wasPlaying) return { restart: false, scope: SCOPE_NONE };
  if (before.kind === 'song') return { restart: true, scope: SCOPE_SONG };
  if (layer === 'loop') {
    return before.kind === 'loop' && before.loopId === focusedLoopId
      ? { restart: true, scope: before }
      : { restart: true, scope: { kind: 'loop', loopId: focusedLoopId } };
  }
  if (before.kind === 'loop' && before.loopId === focusedLoopId) {
    return { restart: true, scope: before };
  }
  return { restart: false, scope: SCOPE_NONE };
}

/**
 * Move the scope with the EDIT CURSOR for a cursor move that changes no
 * sound. addLoop and duplicateLoop are the two: each makes the new loop a
 * copy of the loop that was already active, so the flat slices — and
 * therefore what is audible — are unchanged, which is exactly why neither
 * calls loadLoop. Leaving the scope on the old id would point it at a loop
 * that is no longer in focus, and the master Play would then render enabled
 * and do nothing (soloLoop early-returns on an unchanged scope reference).
 *
 * Distinct from restartAfterStop above, which answers a different question.
 * That one runs after an internal hard stop and has to decide whether
 * anything comes back at all — including the song-layer case where picking a
 * DIFFERENT loop stops the audition. Nothing stops here, because nothing
 * about the sound changed: a copy of what is already playing is still what
 * is already playing. `none` stays `none` (claiming a scope with nothing
 * playing breaks "none means stopped" as surely as playing under `none`
 * does), and `song` stays `song` (an arrangement is not one loop, and adding
 * a loop to it must not convert it into one).
 */
export function rescopeToLoop(scope: PlaybackScope, loopId: string): PlaybackScope {
  if (scope.kind !== 'loop' || scope.loopId === loopId) return scope;
  return { kind: 'loop', loopId };
}

/**
 * Whether a loop card's own play/stop button is disabled, derived from the
 * scope alone. Pure so it can be tested without a DOM. The button's Play/Stop
 * FACE is derived separately in ArrangeView from isPlaying + scopedLoopId(),
 * which also accounts for an auditioning player mid-release ('stopping') — a
 * distinction this function's scope-only view cannot make.
 */
export function loopPlayButton(scope: PlaybackScope, loopId: string): { disabled: boolean } {
  if (scope.kind === 'song') return { disabled: true };
  if (scope.kind === 'loop') return { disabled: scope.loopId !== loopId };
  return { disabled: false };
}
