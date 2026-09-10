import { describe, expect, test } from 'bun:test';
import { VOICE_OWNERS, type VoiceOwner } from './voiceOwner';

/**
 * The compile-time half. `Assert<T extends true>` is what makes it real: a
 * condition resolving to `false` fails the `extends true` constraint and is a
 * genuine build error, unlike a bare `X extends Y ? true : never` alias, which
 * quietly resolves to `never` with nothing consuming it. Same pattern as
 * `store/melodyTracks.ts`.
 *
 * `Equal` compares by MUTUAL assignability, so it pins the roster and the union
 * in BOTH directions: adding a member to the tuple widens `VoiceOwner` and
 * fails, and re-declaring `VoiceOwner` as anything other than the tuple's
 * members also fails.
 */
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The roster, written out by hand. Editing voiceOwner.ts must break this. */
type ExpectedOwner = 'live' | 'arp' | 'sequencer' | 'preview';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertUnionMatchesRoster = Assert<Equal<VoiceOwner, ExpectedOwner>>;

/**
 * The runtime half, made exhaustive by the type annotation: a member added to
 * `VoiceOwner` and not to this literal is a compile error, and a member in this
 * literal that is not in `VOICE_OWNERS` fails the comparison below.
 */
const OWNER_KEYS: Record<VoiceOwner, true> = {
  live: true,
  arp: true,
  sequencer: true,
  preview: true,
};

describe('VOICE_OWNERS', () => {
  // NOT a length check. `expect(VOICE_OWNERS.length).toBe(4)` is vacuous: it
  // passes for any four strings, so renaming 'sequencer' to 'seq' — which
  // would silently stop matching every call site's literal — leaves it green.
  // Comparing the whole tuple names the contents and the order.
  test('is exactly the four owners, in the documented order', () => {
    expect(VOICE_OWNERS).toEqual(['live', 'arp', 'sequencer', 'preview']);
  });

  test('the roster and the exhaustive VoiceOwner record hold the same members', () => {
    expect(Object.keys(OWNER_KEYS).sort()).toEqual([...VOICE_OWNERS].sort());
  });

  test('every member is a distinct non-empty string', () => {
    expect(new Set(VOICE_OWNERS).size).toBe(VOICE_OWNERS.length);
    for (const owner of VOICE_OWNERS) expect(owner.length).toBeGreaterThan(0);
  });
});
