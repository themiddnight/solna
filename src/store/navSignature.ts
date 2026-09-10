import type { AppStore } from './types';

/**
 * A navigation-axis table: one named source function per axis. A source is
 * NOT constrained to a plain store field — `layer` is computed from
 * `activeTab` and is not an `AppStore` key at all, which is why the signature
 * type below is a mapped type over the table rather than a `Pick<AppStore>`.
 */
export type NavSources = Record<string, (state: AppStore) => unknown>;

/** What a table's sources return, derived so the two cannot drift apart. */
export type NavSignature<S extends NavSources> = { [K in keyof S]: ReturnType<S[K]> };

/**
 * Turns a nav-axis table into the pair every nav subscription needs: its key
 * list, and the selector that reads it.
 *
 * ONE implementation, instantiated per table. `soloNav.ts` and
 * `leadRecord.ts` had a line-for-line copy of this each — the same mapped
 * type, the same `Record<string, unknown>` accumulator and cast, and the same
 * allocation reasoning in a comment — so a fix to one left the other running
 * the old shape.
 *
 * The selector is a plain loop rather than
 * `Object.fromEntries(keys.map(...))`, and `keys` is resolved ONCE here rather
 * than inside the selector: these subscriptions are mounted at the app root
 * for the life of the session, so the selector runs on EVERY store `set()` —
 * every knob tick and every clock-driven write. The map form allocated an
 * array plus a two-element tuple per axis on each of those; this allocates the
 * one object the subscription compares.
 */
export function createNavSignature<S extends NavSources>(
  sources: S,
): { keys: (keyof S)[]; signature: (state: AppStore) => NavSignature<S> } {
  const keys = Object.keys(sources) as (keyof S)[];
  return {
    keys,
    // The accumulator is widened and cast once at the end: writing through a
    // union of mapped-type keys narrows the value slot to `never`, and the
    // alternative — an object literal naming each table's fields by hand — is
    // the drift these tables exist to prevent.
    signature: (state: AppStore) => {
      const signature: Record<string, unknown> = {};
      for (const key of keys) signature[key as string] = sources[key](state);
      return signature as NavSignature<S>;
    },
  };
}
