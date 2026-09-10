import type { SoloTrack } from './trackAudibility';

/**
 * The two melody tracks — Lead and FX — as `[store field names, player, engine
 * source, vocabulary]`. `leadSlice`, the `lead/` hooks and `LeadMelodyGrid` read
 * their fields through this table under a required `trackId`, so the two tracks
 * are one implementation with two rows rather than two copies of one file.
 *
 * The store field names are TABLE DATA, spelled out, not derived from a
 * `${id}MelodySteps` convention. That is the SOURCE_BUSES precedent
 * (store/sourceBuses.ts) and it holds for the same reason: the LEAD row is
 * irregular in four columns — its patch is `synthParams`, its fader pair is
 * `synthVolume`/`synthMuted` and its engine source is `'synth'`, none of which
 * carry the word "lead" — so a template would need a per-column exception for
 * one of the two rows, which costs more than writing the regular cases longhand.
 * It also holds PRE-EMPTIVELY: a convention is only worth its brittleness if
 * nothing will ever break it, and this codebase's naming history says otherwise.
 *
 * WHY THIS IS NOT IN src/data/: it names store fields, which is a fact about the
 * store, and `melodyTrack()` is a function — src/data/ declares none. It sits
 * beside sourceBuses.ts instead, which is the same shape (a store table with no
 * runtime import) and is likewise safe for src/components/ to read: nothing here
 * imports audio/engine, so layering rule 4 is not in play.
 *
 * `cursor` and `clipboard` are SESSION state — they are deliberately absent from
 * LOOP_FLAT_KEYS, like `leadCursor`/`leadBarClipboard` already are — and they are
 * in the table anyway because the grid reads them through it like everything
 * else. `melodyTracks.test.ts` asserts the nine per-loop columns against
 * LOOP_FLAT_KEYS and leaves these two out of that check.
 *
 * There is still no `recording` column, and now for a stronger reason than
 * "lead-only": the ARMED TRACK is one scalar in the ui slice
 * (`recordingTrack`), precisely so two tracks cannot be armed at once. A
 * per-track `recording` field would make that state representable, and one
 * live-capture clock would then write two grids from a single keypress. Both
 * tracks' gates ask `recordingTrack === id` instead — see store/leadRecord.ts.
 */
export const MELODY_TRACKS = [
  {
    id: 'lead',
    cardTitle: 'Melody',
    steps: 'leadMelodySteps',
    loopLength: 'leadLoopLength',
    stepResolution: 'leadStepResolution',
    view: 'leadMelodyView',
    octave: 'leadMelodyOctave',
    gate: 'leadGate',
    synthParams: 'synthParams',
    volume: 'synthVolume',
    muted: 'synthMuted',
    cursor: 'leadCursor',
    clipboard: 'leadBarClipboard',
    player: 'leadPlayer',
    module: 'lead',
    stepPlayer: 'lead',
    engineSource: 'synth',
    solo: 'lead',
  },
  {
    id: 'fx',
    cardTitle: 'FX',
    steps: 'fxMelodySteps',
    loopLength: 'fxLoopLength',
    stepResolution: 'fxStepResolution',
    view: 'fxMelodyView',
    octave: 'fxMelodyOctave',
    gate: 'fxGate',
    synthParams: 'fxSynthParams',
    volume: 'fxVolume',
    muted: 'fxMuted',
    cursor: 'fxCursor',
    clipboard: 'fxBarClipboard',
    player: 'fxPlayer',
    module: 'fx',
    stepPlayer: 'fx',
    engineSource: 'fx',
    solo: 'fx',
  },
] as const;

/** One row of the table, for callers that take a track rather than an id. */
export type MelodyTrack = (typeof MELODY_TRACKS)[number];

/** `'lead' | 'fx'` — the required `trackId` prop's type. */
export type MelodyTrackId = MelodyTrack['id'];

/**
 * Compile-time cross-check against the solo vocabulary this table translates
 * into. `Assert<T extends true>` is what makes this real: instantiating it
 * with a condition that resolves to `false` fails to satisfy the `extends
 * true` constraint and is a genuine compile error, unlike a bare
 * `X extends Y ? true : never` alias, which just quietly resolves to `never`
 * with nothing to consume it and no error at all. A typo in `solo` is then a
 * build error rather than a track that silently never solos.
 *
 * There is no equivalent assertion for `controlTarget`: that column doesn't
 * exist on this table any more. It always named the SAME literal the row's
 * own `id`/`module`/`stepPlayer` already carry, and grepping
 * `\.controlTarget\b` across the codebase turns up no reader of
 * `melodyTrack(id).controlTarget` — every actual control-target read now goes
 * through `controlTargetForFocus(focusTrack)` (store/focusTrack.ts), a
 * different value entirely. Dead data got a real assertion once and then got
 * deleted instead of kept.
 */
/**
 * `Assert<T extends true>` — instantiating it with a condition that resolves
 * to `false` fails the `extends true` constraint and is a real compile error,
 * unlike a bare conditional alias which resolves to `never` with nothing
 * consuming it and no error at all. Exported because `focusTrack.ts` runs the
 * same cross-vocabulary checks and had declared its own copy.
 */
export type Assert<T extends true> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertSoloTracks = Assert<MelodyTrack['solo'] extends SoloTrack ? true : false>;

/**
 * Row lookup, resolved once at module scope. `melodyTrack` is called from four
 * render bodies AND from `leadMarkerFollowsClock`, which is the selector of
 * four live subscriptions (the marker and the step publisher, each mounted
 * twice) — so a `.find` scan there ran per subscription per store `set()`.
 */
const TRACK_BY_ID = Object.fromEntries(
  MELODY_TRACKS.map((track) => [track.id, track]),
) as Record<MelodyTrackId, MelodyTrack>;

/** Narrow a track id to its row. Undefined is impossible for a `MelodyTrackId`. */
export function melodyTrack(id: MelodyTrackId): MelodyTrack {
  return TRACK_BY_ID[id];
}
