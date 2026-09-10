import type { PatternSegment, ViewMode } from '@/types';
import type { SynthControlTarget } from '@/utils/synthControl';
import type { Assert, MelodyTrackId } from './melodyTracks';

/**
 * DOM id prefix, mixer lookup key, and — since the focus-track change — the id
 * of the ONE thing the user is working on. These track the STORE fields
 * (`drumMuted`, `synthVolume`), not the labels, which is why the drum bus is
 * `drum` here and "Beat" on screen, and why `'synth'` means Lead.
 *
 * WHY THIS DECLARATION IS HERE AND NOT IN components/mixLayers.ts, where it
 * used to live: `focusTrack` is store state, so the ui slice, `partialize`,
 * `sanitizePersistedState` and the projections below all name this type — and
 * `src/store/` may not import `src/components/`, not even a type (the
 * `no-restricted-imports` ban is not relaxed for type imports; only test files
 * are exempt). So the roster moved down to the store and `mixLayers.ts`
 * re-exports it. That is the melodyTracks.ts / sourceBuses.ts shape exactly: a
 * store table with no runtime import, which `src/components/` may read.
 *
 * Do NOT rename `'synth'` to `'lead'`. It is a dozen persisted store fields
 * wearing a focus-track change as cover, and the spec puts it out of scope.
 */
export const MIX_LAYER_IDS = ['synth', 'fx', 'chord', 'bass', 'pad', 'drum'] as const;

export type MixLayerId = (typeof MIX_LAYER_IDS)[number];

/**
 * The five focuses that have a synth channel. `Exclude`, not a second literal
 * list, so a layer added to the roster is melodic by default and has to be
 * excluded deliberately.
 */
export type MelodicFocus = Exclude<MixLayerId, 'drum'>;

/**
 * Membership test for the roster, living beside the roster rather than in
 * sanitize.ts: `focusTrack` is persisted and `sanitizePersistedState` needs
 * this, but the roster and the question "is this one of them" are one fact and
 * are written once. sanitize.ts holds the guards for values the `.solna`
 * import path shares; `focusTrack` is a user preference and is not project
 * content, so it has no second reader to keep in step.
 */
export function isMixLayerId(value: unknown): value is MixLayerId {
  return typeof value === 'string' && (MIX_LAYER_IDS as readonly string[]).includes(value);
}

/** Narrows a focus to the five that have a synth channel. */
export function isMelodicFocus(focus: MixLayerId): focus is MelodicFocus {
  return focus !== 'drum';
}

/**
 * A `Record`, not a `switch`: adding a layer to MIX_LAYER_IDS without giving
 * it a segment is then a compile error rather than a Pattern tab that renders
 * four `hidden` divs and nothing else.
 */
const SEGMENT_FOR_FOCUS: Record<MixLayerId, PatternSegment> = {
  synth: 'lead',
  fx: 'fx',
  // Chord, bass and pad project to the one Accompaniment segment; nothing in
  // ChordView reads focusTrack yet, so the segment does not distinguish which
  // of the three is focused (spec: no change made there).
  chord: 'accompaniment',
  bass: 'accompaniment',
  pad: 'accompaniment',
  drum: 'beat',
};

/** Which Pattern segment a focus shows. Total — every focus has a segment. */
export function segmentForFocus(focus: MixLayerId): PatternSegment {
  return SEGMENT_FOR_FOCUS[focus];
}

/**
 * The inverse Pattern's segment ROW needs: which focus a segment button sets.
 *
 * It is not a true inverse and cannot be — `accompaniment` covers three
 * focuses — so it is written as its own table rather than derived by searching
 * SEGMENT_FOR_FOCUS, which would return whichever of the three came first and
 * make the choice an artefact of key order.
 *
 * `accompaniment` sends `chord`, UNCONDITIONALLY. There is no memory of which
 * of the three was last used, and adding one is explicitly rejected (spec,
 * Open risks 3): it would only ever fire when focus leaves the accompaniment
 * group and returns through this button, and it would cost a second invisible
 * navigation state in a change whose whole purpose is deleting invisible
 * navigation state.
 */
const FOCUS_FOR_SEGMENT: Record<PatternSegment, MixLayerId> = {
  lead: 'synth',
  fx: 'fx',
  accompaniment: 'chord',
  beat: 'drum',
};

/** Which focus a Pattern segment button sets. */
export function focusForSegment(segment: PatternSegment): MixLayerId {
  return FOCUS_FOR_SEGMENT[segment];
}

/**
 * Which synth channel a focus edits. PARTIAL BY TYPE, not by fallback: its
 * parameter is `MelodicFocus`, so "what is the synth channel for the drum
 * focus" is a question the compiler refuses to let a caller ask.
 *
 * A total version returning `'synth'` for `'drum'` is the trap.
 * `resolveSynthControlChannel` (utils/synthControl.ts) ends in
 * `channels[target] ?? channels.synth`, so a `'drum'` that reached it would
 * not throw, would not warn and would not render wrong — it would silently
 * point every knob on the Sound page at the Lead patch. Do not remove that
 * `??` either: it still guards that function's other callers, and removing it
 * converts a swallowed mistake into a crash without making the mistake less
 * possible. Sanitizing `focusTrack` at the persistence boundary removes the
 * out-of-roster case; this signature removes the legal-but-wrong `'drum'` one.
 *
 * The body is the identity because `MelodicFocus` and `SynthControlTarget` are
 * the same five literals — asserted below, so a drift between the two unions
 * is a build error rather than a channel lookup that quietly falls back.
 */
export function controlTargetForFocus(focus: MelodicFocus): SynthControlTarget {
  return focus;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- these two aliases ARE the
   assertion; consuming them at runtime would defeat the point. */
type _AssertMelodicIsControlTarget = Assert<
  MelodicFocus extends SynthControlTarget ? true : false
>;
type _AssertControlTargetIsMelodic = Assert<
  SynthControlTarget extends MelodicFocus ? true : false
>;
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * The synth bus a focus plays on, or `null` when there is nothing melodic to
 * play. The total form of `controlTargetForFocus`, and the one place the drum
 * case is answered: it lives beside its siblings (`melodyTrackForFocus`,
 * `controlTargetForFocus`) rather than in a view, because "what does this
 * focus route to" is store knowledge that `src/components/` reads, never
 * decides. It used to be answered twice in two component files — a nullable
 * copy in `useInputDeck.ts` and a Lead-defaulting copy in `useSynthChannel.ts`
 * — which had a root hook and a leaf panel importing routing logic from each
 * other. A caller that needs a total answer writes `?? 'synth'` at its own
 * call site, where the fallback is visible.
 *
 * `null` for `drum` rather than a built-in fallback: a fallback would make the
 * drum focus play the Lead patch off the melodic keyboard, silently and with
 * nothing on screen to explain it. The QWERTY drum-PAD shortcuts are
 * unaffected — they are a disjoint key set on their own listener, so a drum
 * focus silences the melodic keyboard and leaves the pads playing.
 */
export function synthTargetForFocus(focus: MixLayerId): SynthControlTarget | null {
  return isMelodicFocus(focus) ? controlTargetForFocus(focus) : null;
}

/**
 * The bridge into MELODY_TRACKS. `null` for the four focuses that are not a
 * melody track, so a caller has to handle "there is no track here" rather than
 * being handed Lead by default — Rec (plan 3) and the melody grids read this.
 */
const MELODY_TRACK_FOR_FOCUS: Record<MixLayerId, MelodyTrackId | null> = {
  synth: 'lead',
  fx: 'fx',
  chord: null,
  bass: null,
  pad: null,
  drum: null,
};

/** Which melody track a focus names, or `null` if it names none. */
export function melodyTrackForFocus(focus: MixLayerId): MelodyTrackId | null {
  return MELODY_TRACK_FOR_FOCUS[focus];
}

/**
 * The two setters "take me to this track's synth" needs. An injected pair, not
 * a `useAppStore` read, so the ordering rule below is testable as pure logic.
 */
export interface SynthTargetNavigation {
  setFocusTrack: (focus: MixLayerId) => void;
  setActiveTab: (tab: ViewMode) => void;
}

/**
 * Focus a track AND show its synth — the Adjust-Synth button's whole job.
 *
 * It lives here rather than in `utils/synthControl.ts`, where it used to sit:
 * `utils/` is outside the layering chain and above `data/`, so reaching into
 * `store/` for `MixLayerId` put a type cycle between the two files (utils read
 * the focus roster; the store read `SynthControlTarget` back). The styles
 * table and the target union stay in utils, which now imports no store type;
 * this is store navigation and belongs with the other `focusTrack`
 * projections.
 */
export function focusSynthTarget(focus: MixLayerId, nav: SynthTargetNavigation): void {
  // Focus first: the Sound view is always mounted, so switching the tab last
  // means it never renders a frame pointed at the previous track.
  nav.setFocusTrack(focus);
  nav.setActiveTab('sound');
}
