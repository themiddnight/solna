import { layerForTab } from '../types';
import { restartAfterStop } from './playbackScope';
import type { PlaybackScope } from './playbackScope';
import { useAppStore } from './store';
import { anyPlayerActive, NO_PLAYERS_ACTIVE, restartPlayersPatch } from './transportSlice';
import type { WasActivePlayers } from './transportSlice';

/**
 * The tail of an INTERNAL stop-and-restart: decide whether the players a
 * caller captured come back, and commit them together with the scope they
 * belong under, in one set().
 *
 * `loadLoop` (switching the loop being edited, or picking a different one
 * from Arrange) is the only caller of this protocol — a vibe preview never
 * restarts what was playing (R337), so `previewVibe` has no tail to share
 * here. The middle of the protocol (`restartAfterStop`, `restartPlayersPatch`)
 * and the head (`captureActivePlayers`) live alongside this tail, so the rule
 * has one home rather than being spelled out at each call site.
 *
 * ONE set(), not three `play(module)` calls: `play(module)` sets no scope, so
 * the old form left players 'playing' under the `none` scope `hardStopAll`
 * had just written — the hole Phase 1 documented at PlaybackScope. Declining
 * to restart needs no extra work either: the caller's `hardStopAll` already
 * silenced everything, so the patch just carries the decided scope.
 *
 * Skipped entirely when it would write nothing new: with no players to bring
 * back the patch is `{ playbackScope }` alone, and `hardStopAll` has already
 * put the scope exactly there — so the set() would notify every subscriber and
 * re-serialise the persisted slice (`loops[]` included) to store a value that
 * is already stored. The guard COMPARES the scope rather than assuming it, so
 * a future `restartAfterStop` row that declines to restart under some other
 * scope still gets written.
 *
 * `activeTab` is read live, here, rather than passed in: neither caller
 * touches it, so this reads the same value either one would have captured,
 * and reading it at commit time keeps the layer and the scope it is compared
 * against from coming out of two different snapshots.
 *
 * @param scopeBefore  the scope captured BEFORE the caller's hardStopAll.
 * @param focusedLoopId  the loop the transport should own afterwards —
 *   loadLoop's incoming id.
 * @param wasActive  the capture from `captureActivePlayers`, taken before the
 *   same hardStopAll.
 */
export function commitRestartAfterStop(
  scopeBefore: PlaybackScope,
  focusedLoopId: string,
  wasActive: WasActivePlayers,
): void {
  const current = useAppStore.getState();
  const decision = restartAfterStop(
    scopeBefore,
    focusedLoopId,
    layerForTab(current.activeTab),
    anyPlayerActive(wasActive),
  );
  if (decision.restart || decision.scope !== current.playbackScope) {
    useAppStore.setState(
      restartPlayersPatch(decision.restart ? wasActive : NO_PLAYERS_ACTIVE, decision.scope),
    );
  }
}
