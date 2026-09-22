/**
 * Task 7 (react-perf-fixes plan): the visual step-marker gate must never
 * become a scheduling gate.
 *
 * `useSegmentGatedStep` (src/components/playbackStep.ts) suppresses a
 * PLAYHEAD's re-render when its owning Pattern segment isn't focused — it
 * does this by making the `stepPublisher` SUBSCRIPTION itself a no-op, never
 * by touching whether the clock actually walks a step. The four hooks that
 * ACTUALLY schedule audio — `useSequencerPlayback`, `useLeadStepPublisher`
 * (the lead/fx step producer), `useLeadPlayback` (the lead/fx note
 * scheduler) and `useChordClockPlayback` (chord and bass) — must therefore never
 * read `focusTrack`/`segmentForFocus` and must never call
 * `useSegmentGatedStep`/`shouldSubscribeToStep`: any of those would make a
 * segment's audio audible only while that segment happens to be the one on
 * screen, which is exactly the "every Pattern segment plays simultaneously"
 * invariant this app is built on (see docs/decisions/0001-always-mounted-views.md and
 * 0016-focus-routed-note-input.md).
 *
 * A source scan, not a runtime test, for the same reason as
 * `src/store/beatLegacyBoundary.test.ts` and
 * `src/architecture/frequencyBoundary.test.ts`: this repo has no DOM (see
 * `.claude/rules/testing.md`), so there is no way to mount these hooks and
 * directly observe whether they keep scheduling regardless of focus. What
 * CAN be proven — and is proven here — is that none of the four files even
 * IMPORTS or NAMES the vocabulary that would make them focus-dependent,
 * which is what any such regression would necessarily require. This
 * converts a one-time manual grep into a permanent, automatically-enforced
 * guard: a future edit that wires a scheduling hook to `focusTrack` (however
 * indirectly, as a literal name or an import) turns this suite red.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The four hooks that own a clock subscription and actually schedule audio. */
const SCHEDULING_HOOKS = [
  'src/components/playback/useSequencerPlayback.ts',
  'src/components/loop/lead/useLeadStepPublisher.ts',
  'src/components/loop/lead/useLeadPlayback.ts',
  'src/components/playback/useChordClockPlayback.ts',
] as const;

/**
 * Any of these appearing in a scheduling hook would make scheduling itself
 * focus-dependent — the one thing this change must never do. Includes both
 * the gated hook/its pure decision function AND the two focus primitives
 * directly, so a hook that reimplemented the gate inline by hand (rather
 * than calling `useSegmentGatedStep`) would still be caught.
 */
const FOCUS_VOCABULARY = [
  'useSegmentGatedStep',
  'shouldSubscribeToStep',
  'focusTrack',
  'segmentForFocus',
] as const;

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

describe('scheduling hooks stay independent of Pattern-segment focus', () => {
  for (const file of SCHEDULING_HOOKS) {
    test(`${file} names none of the visual step-gate vocabulary`, () => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      const found = FOCUS_VOCABULARY.filter((name) => source.includes(name));
      expect(found).toEqual([]);
    });
  }

  /**
   * The allowlist itself: every path must exist and must actually be a
   * clock-subscribing scheduler, so this guard cannot quietly widen to
   * include (or silently drop) a file mid-refactor. `subscribePlaybackClock`
   * is what every one of the four calls to actually receive step ticks
   * (`useLeadStepPublisher` publishes a step off it; `useSequencerPlayback`,
   * `useLeadPlayback` and `useChordClockPlayback` schedule audio off it), so its
   * presence is the check for "this file really is a scheduler" — unlike
   * `publishStepAt`, which `useLeadPlayback` deliberately does NOT call (its
   * step producer is the separate `useLeadStepPublisher`, per DEV-378).
   */
  test('every listed file exists and actually subscribes to the playback clock', () => {
    for (const file of SCHEDULING_HOOKS) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect([file, source.includes('subscribePlaybackClock')]).toEqual([file, true]);
    }
  });
});
