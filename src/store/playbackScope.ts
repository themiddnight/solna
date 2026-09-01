/**
 * The single source of truth for playback MODE.
 *
 *   none — unscoped. Nothing owns the transport; song advance is still allowed
 *          (a per-module play in the song layer runs the arrangement), but no
 *          card is soloing and no card button is disabled.
 *   song — Play All owns the transport. Every loop-card button is disabled.
 *   solo — one loop is auditioned in isolation. Song advance is suppressed;
 *          that card shows Stop and every other card button is disabled.
 *
 * The three are mutually exclusive by construction, which is the whole point:
 * the old `auditionLoopId: string | null` could sit non-null underneath a
 * running Play All, and nothing but a page refresh cleared it.
 *
 * `songLoopIndex` is NOT part of this union — it is a pure cursor into loops[].
 * Never read its null-ness as a mode.
 */
export type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  | { kind: 'solo'; loopId: string };

export type PlaybackScopeAction =
  /** Master transport Play — starts the song, and TAKES OVER from a solo. */
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
 * so `toggle-loop` is a no-op; while `kind === 'solo'` every other card is
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
      // Takeover: from a solo this is one click, not two. Disabling the
      // transport instead would leave audio sounding with no visible global
      // stop once the soloing card scrolls out of view.
      return scope.kind === 'song' ? scope : SCOPE_SONG;
    case 'stop-all':
    case 'layer-change':
      return scope.kind === 'none' ? scope : SCOPE_NONE;
    case 'toggle-loop':
      if (scope.kind === 'solo') {
        // Same card again = stop. A different card is unreachable (disabled).
        return scope.loopId === action.loopId ? SCOPE_NONE : scope;
      }
      // Unreachable while the song owns the transport: cards stay disabled
      // for the arrangement's whole run, including across the internal
      // restarts song advance drives through loadLoop (see the reducer's
      // own doc comment above).
      if (scope.kind === 'song') return scope;
      return { kind: 'solo', loopId: action.loopId };
  }
}

/** The soloing loop's id, or null. The one accessor views should need. */
export function soloLoopId(scope: PlaybackScope): string | null {
  return scope.kind === 'solo' ? scope.loopId : null;
}

/**
 * Whether a loop card's own play/stop button is disabled, derived from the
 * scope alone. Pure so it can be tested without a DOM. The button's Play/Stop
 * FACE is derived separately in ArrangeView from isPlaying + soloLoopId(),
 * which also accounts for a soloing player mid-release ('stopping') — a
 * distinction this function's scope-only view cannot make.
 */
export function loopPlayButton(scope: PlaybackScope, loopId: string): { disabled: boolean } {
  if (scope.kind === 'song') return { disabled: true };
  if (scope.kind === 'solo') return { disabled: scope.loopId !== loopId };
  return { disabled: false };
}
