/**
 * The single source of truth for playback MODE.
 *
 *   none — unscoped. Nothing owns the transport; song advance is still allowed
 *          (a per-module play in the song layer runs the arrangement), but no
 *          card is auditioning and no card button is disabled.
 *   song — Play All owns the transport. Every loop-card button is disabled.
 *   loop — one loop is auditioned alone (a SOLO LOOP). Song advance is
 *          suppressed; that card shows Stop and every other card button is
 *          disabled. Unrelated to the per-track solo Phase 4 adds, which
 *          lives in the ui slice and never touches this union.
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
 * It does NOT yet hold across two call sites, both of which hard-stop and
 * restart through play(module) — which sets no scope:
 *
 *   - loadLoop.ts's non-boundary path (the branch below the
 *     padHoldsAcrossLoop early return, currently lines 115-117) calls
 *     hardStopAll() — resetting the scope to `none` — then restarts whatever
 *     was active with play(module). Switching the active loop from the loop
 *     selector while the loop layer plays therefore leaves players 'playing'
 *     under a `none` scope.
 *   - vibes.ts's applyVibeToStore (currently lines 102-196) captures
 *     `wasActive`, calls `store.hardStopAll()` (:107), and restarts with
 *     `store.play('sequencer' | 'chords' | 'lead')` (:194-196). Reachable in
 *     two clicks from the loop layer: press the transport Play (scope
 *     loop{loopId}, players playing), then click any vibe in the
 *     always-mounted InstantVibesBar.
 *
 * Phase 3 must close both holes before it treats the scope as ground truth.
 * The lock below covers playAll/soloLoop/hardStopAll/softStopAll only, and
 * deliberately does not pin loadLoop's or vibes.ts's current behaviour as
 * correct. A source-scan guard in playbackScope.test.ts keeps this comment's
 * "exactly these two callers" claim from drifting silently as new callers of
 * play(module) are added — see its describe block.
 */
export type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  /** One loop auditioned alone — a SOLO LOOP. Phase 4's per-track solo is a
   *  different feature in a different slice and never appears here. */
  | { kind: 'loop'; loopId: string };

export type PlaybackScopeAction =
  /** Master transport Play — starts the song, and TAKES OVER from a solo loop. */
  | { type: 'play-all' }
  /** Master transport soft or hard stop. */
  | { type: 'stop-all' }
  /** A loop card's own play/stop button. */
  | { type: 'toggle-loop'; loopId: string }
  /** Crossing the loop/song layer boundary (either direction). */
  | { type: 'layer-change' };

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
    case 'layer-change':
      return scope.kind === 'none' ? scope : SCOPE_NONE;
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
 * need. Named for the SCOPE, not for "solo", because Phase 4 introduces a
 * per-track solo that has nothing to do with this value.
 */
export function scopedLoopId(scope: PlaybackScope): string | null {
  return scope.kind === 'loop' ? scope.loopId : null;
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
