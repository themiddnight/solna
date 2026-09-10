import type { Loop, LoopStatePatch } from './types';

/** Every per-loop persisted field, in one source of truth. */
export const LOOP_FLAT_KEYS = [
  'scaleRoot',
  'scaleType',
  'synthParams',
  'chordSynthParams',
  'bassSynthParams',
  'chords',
  'chordRhythmId',
  'chordRhythmMode',
  'customChordRhythm',
  'chordFeel',
  'chordOctave',
  'bassPatternId',
  'bassPatternMode',
  'customBassPattern',
  'bassFeel',
  'bassOctave',
  'padSynthParams',
  'fxSynthParams',
  'padMode',
  'padOctave',
  'padVoicing',
  'padDroneDegree',
  'padDroneIntervals',
  'padVolume',
  'padMuted',
  'leadMelodySteps',
  'leadLoopLength',
  'leadStepResolution',
  'leadMelodyView',
  'leadMelodyOctave',
  'leadGate',
  'fxMelodySteps',
  'fxLoopLength',
  'fxStepResolution',
  'fxMelodyView',
  'fxMelodyOctave',
  'fxGate',
  'sequencerTracks',
  'soundKit',
  'drumFilterCutoff',
  'drumFilterResonance',
  'drumFilterType',
  'synthVolume',
  'synthMuted',
  'chordVolume',
  'chordMuted',
  'bassVolume',
  'bassMuted',
  'fxVolume',
  'fxMuted',
  'masterSequencerVolume',
  'drumMuted',
] as const;

/**
 * A loop's length in bars — the same total the chord player already
 * advances through (`chord.bars × stepsPerBar` per chord), so the loop
 * boundary is exactly where the progression wraps.
 */
export function loopBars(chords: readonly { bars?: number }[]): number {
  return chords.reduce((sum, c) => sum + (c.bars || 1), 0);
}

/** Loop ids are new and unique per project (same style as presetsSlice). */
export function newLoopId(): string {
  return `loop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * The label every rendered site shows: the user's name when they set one, the
 * app's otherwise. One `||`, no third tier and no `?? 'Loop'` fallback —
 * sanitizeLoops guarantees `tempName` is a non-empty string on every loop that
 * reaches the store, and a fallback here would be admitting that guarantee is
 * not real. It is one function rather than a `||` per site because several of
 * the card's reads are aria-labels, where a missed site is a screen reader
 * announcing "Delete " and nothing visible in review.
 */
export function loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string {
  return loop.name || loop.tempName;
}

/**
 * The next `untitled-{n}`: one above the highest existing untitled number,
 * read off `tempName`. The number is assigned ONCE at creation and is then a
 * stored string like any other — never recomputed from a position, so dragging
 * or deleting a loop never renames the cards below it. The cost is gaps
 * (untitled-2 can sit directly above untitled-7), which read correctly as
 * "that one was made later". The lowercase hyphenated form is deliberate:
 * every label a person chooses is title-cased, so the shape is the signal that
 * the slot is empty.
 */
export function nextUntitledName(loops: readonly Loop[]): string {
  let max = 0;
  for (const loop of loops) {
    const m = /^untitled-(\d+)$/.exec(loop.tempName);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `untitled-${max + 1}`;
}

/**
 * A label's stem and the separator its number hangs off — `Drop 2` -> `Drop`
 * + ' ', `untitled-3` -> `untitled` + '-'. A trailing group of digits only
 * counts when a separator precedes it, so `Synthwave 80s` keeps its whole
 * string as the stem and duplicates to `Synthwave 80s 2`. The separator is
 * carried out so the re-numbered label keeps the shape it arrived in.
 */
function labelStem(label: string): { stem: string; sep: string } {
  const m = /^(.*\S)([ -])(\d+)$/.exec(label);
  return m ? { stem: m[1], sep: m[2] } : { stem: label, sep: ' ' };
}

/**
 * The lowest free integer >= 2 for a stem, checked against the labels already
 * on screen. "Lowest free" rather than "one above the highest" because the
 * numbers belong to a stem, not to the project: a gap in `Drop 2, Drop 4` is a
 * slot a copy should fill. Terminates because `taken` is finite.
 */
function nextFreeLabel(taken: ReadonlySet<string>, stem: string, sep: string): string {
  let n = 2;
  while (taken.has(`${stem}${sep}${n}`)) n += 1;
  return `${stem}${sep}${n}`;
}

/**
 * The clone's two label fields: increment the label the card is DISPLAYING, in
 * the field it came from. A named `Drop` yields `name: 'Drop 2'`; an unnamed
 * loop showing `Synthwave 80s` yields `tempName: 'Synthwave 80s 2'` with
 * `name` still ''. Copying the label verbatim would put two identical cards
 * side by side — the old `Loop 5` problem wearing a nicer word — and
 * promoting it into `name` would make the copy stop tracking vibe
 * applications while its original kept tracking them.
 *
 * `tempName` is ALSO renumbered on the named branch, off its own stem and its
 * own taken set (never copied verbatim from `source`). `name` masks
 * `tempName` today, but nothing stops either name from being cleared to ''
 * later (`setLoopName` has no uniqueness guard), and a clone that shared its
 * source's exact `tempName` would then surface as the same loopLabel on two
 * Arrange cards — the very collision this function exists to prevent.
 *
 * That same masking is why `taken` below is the union of every loop's
 * DISPLAYED label and its raw `tempName`, not the displayed label alone: a
 * name masks its loop's tempName from view but not from existence, and an
 * unrelated later rename-to-blank on some OTHER loop can unmask it. Checking
 * displayed labels only would let a fresh `next` land on a hidden tempName
 * today and collide with it the moment that other loop's name is cleared —
 * this function has no way to know that will happen, so it must avoid the
 * hidden value now.
 *
 * The named branch's `tempName` renumbering reuses this same `taken` set
 * rather than building a narrower one from raw `tempName`s alone — a
 * tempName-only set would miss another loop's DISPLAYED name (that loop's own
 * masked tempName, from the clone's point of view) and could hand out a value
 * that collides with it the moment that other loop's name is later cleared.
 */
export function nextDuplicateLabel(
  loops: readonly Loop[],
  source: Loop,
): { name: string; tempName: string } {
  const taken = new Set([...loops.map(loopLabel), ...loops.map((loop) => loop.tempName)]);
  const { stem, sep } = labelStem(loopLabel(source));
  const next = nextFreeLabel(taken, stem, sep);
  if (!source.name) return { name: '', tempName: next };
  const tempParts = labelStem(source.tempName);
  const nextTempName = nextFreeLabel(taken, tempParts.stem, tempParts.sep);
  return { name: next, tempName: nextTempName };
}

/** The id to make active after deleting `deletedId`: next neighbour, else previous, else first. */
export function fallbackActiveLoopId(loops: readonly Loop[], deletedId: string): string | null {
  const index = loops.findIndex((r) => r.id === deletedId);
  if (index === -1) return null;
  const next = loops[index + 1] ?? loops[index - 1] ?? loops[0];
  return next ? next.id : null;
}

/** Deep clone so a duplicated/added loop can never share mutable substructure with its source. */
export function cloneLoop(loop: Loop): Loop {
  return structuredClone(loop);
}

/**
 * Picks the per-loop fields off any object that carries them — a `Loop`
 * (for `loadLoop`) or the flat `AppStore` (for the sync-back subscription).
 */
export function loopStatePatch(source: object): LoopStatePatch {
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const key of LOOP_FLAT_KEYS) {
    out[key] = src[key];
  }
  return out as LoopStatePatch;
}

/**
 * The loop the flat slices should show: `activeId` when it names a loop, else
 * the first one. This is the resolution persist `merge` uses on rehydrate and
 * the resolution project Open uses — one function so the two can never drift.
 */
export function resolveActiveLoop<T extends { id: string }>(
  loops: readonly T[],
  activeId: string | null | undefined,
): T {
  return loops.find((l) => l.id === activeId) ?? loops[0];
}

/**
 * Stamps a fresh, position-ordered `untitled-N` onto every loop that has
 * none — the shape `ProjectContent.loops` is in, since `tempName` is
 * loop-slot identity and is never part of project content (see
 * `ProjectLoop` in projectFormat.ts). Every project load (New, Open, Import)
 * therefore synthesizes fresh slot labels the same way sanitizeLoops does
 * for a raw row with none, and for the same reason applyProjectContent
 * already resets `selectedVibeId` to null: a label that named "the loop a
 * vibe was applied to" or "the Nth loop added this session" describes a
 * session that just ended, not the one being opened.
 */
export function withFreshTempNames(loops: readonly Omit<Loop, 'tempName'>[]): Loop[] {
  return loops.map((loop, i) => ({ ...loop, tempName: `untitled-${i + 1}` }) as Loop);
}
