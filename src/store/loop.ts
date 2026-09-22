import {
  isVisiblePatternColumn,
  normalizePatternSpans,
  resizePatternBars,
  writePatternSpan,
  type PatternSpans,
  type PatternSpansResult,
} from '@/utils/customPattern';
import { getMeter } from '@/utils/meter';
import {
  clampLoopLength,
  foldPatternBoundaries,
  patternStoredIndexAt,
} from '@/utils/patternTimeline';
import type { BassStepChoice } from '../data/bassPatterns';
import type { ChordItem } from '../types';
import type { Loop } from './types';

/** Every per-loop persisted field, in one source of truth. */
export const LOOP_FLAT_KEYS = [
  'scaleRoot',
  'scaleType',
  'synthParams',
  'chordSynthParams',
  'bassSynthParams',
  'synthArpSettings',
  'chordArpSettings',
  'bassArpSettings',
  'chords',
  'chordRhythmId',
  'chordRhythmMode',
  'customChordRhythm',
  'customChordLoopLength',
  'customChordHoldSteps',
  'chordFeel',
  'chordOctave',
  'bassPatternId',
  'bassPatternMode',
  'customBassPattern',
  'customBassLoopLength',
  'customBassHoldSteps',
  'bassFeel',
  'bassOctave',
  'padSynthParams',
  'padArpSettings',
  'fxSynthParams',
  'fxArpSettings',
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
  'beatParams',
  'beatPattern',
  'beatMix',
  'synthVolume',
  'synthMuted',
  'chordVolume',
  'chordMuted',
  'bassVolume',
  'bassMuted',
  'fxVolume',
  'fxMuted',
] as const satisfies readonly (keyof Loop)[];

type LoopFlatKey = (typeof LOOP_FLAT_KEYS)[number];

/**
 * A loop's musical content: every field except its slot identity (`id`,
 * `name`, `tempName`, `repeatCount`). What `loadLoop` writes to the flat
 * slices, what the mirror writes back, and what `changeKey` transforms.
 * loop.test.ts pins at compile time that no `Loop` field is left out.
 */
export type LoopContent = Pick<Loop, LoopFlatKey>;

/** Loop ids are new and unique per project (same style as presetsSlice). */
export function newLoopId(): string {
  return `loop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * The most bars a custom pattern's cycle may span — and, because a lane's width
 * is `loopLength * MAX_STEPS_PER_BAR`, the most stored slots either lane may
 * hold. Set at four times the longest factory progression (16 bars).
 *
 * It guards the READ path, and it is one choke point rather than a check per
 * arithmetic site. Both inputs it bounds arrive from an untrusted `.solna`
 * body: `customChordLoopLength` is only checked to be a positive integer, and a
 * chord's `bars` only to be finite and positive — so a crafted body claiming
 * 1e9 bars makes the divisor clamp return 1e9 and asks the sanitizer to
 * allocate 2.4e10 slots. `progressionBars` caps the bar count, and every width
 * in this file is that number times `MAX_STEPS_PER_BAR`, so capping it there
 * bounds all of them at once. The live setters read the same function, so the
 * two paths cannot disagree about what a legal cycle is.
 */
export const MAX_CUSTOM_PATTERN_BARS = 64;

/**
 * The bar count a custom pattern's cycle is measured against: the sum of the
 * progression's chord durations, floored at one and ceilinged at
 * `MAX_CUSTOM_PATTERN_BARS`. Floored rather than trusted because a zero-bar
 * total would make every divisor test degenerate and hand back a zero-length
 * cycle; a chord whose `bars` is not finite contributes nothing, so a corrupt
 * row cannot poison the sum with NaN.
 */
export function progressionBars(chords: readonly ChordItem[]): number {
  let bars = 0;
  for (const chord of chords) {
    if (Number.isFinite(chord.bars)) bars += chord.bars;
  }
  return Math.min(MAX_CUSTOM_PATTERN_BARS, Math.max(1, bars));
}

/**
 * The inputs a custom chord or bass span edit reads, in one object rather than
 * six positional arguments: two of the six are `number`s and two more are
 * arrays, so a positional call is one transposition away from a silent bug.
 */
export interface CustomPatternState<TValue> {
  /** The onset/value array and its parallel holds, both `loopLength * MAX_STEPS_PER_BAR` long. */
  readonly values: readonly TValue[];
  readonly holds: readonly number[];
  /** The progression the cycle folds its boundaries onto. */
  readonly chords: readonly ChordItem[];
  /** The lane's own cycle in bars. */
  readonly loopLength: number;
  /** The ACTIVE meter's bar length in 16th steps (`METERS[id].stepsPerBar`). */
  readonly stepsPerBar: number;
  /** The value a rest slot carries — the lane's own "nothing here". */
  readonly empty: TValue;
}

/**
 * The `PatternSpans` every custom chord and bass edit reads, derived in one
 * place so the store's live setters and the read-time sanitizer can never
 * disagree about where a chord boundary falls — the sanitizer passes the
 * storage bar length, the setters the active meter's, and everything else
 * about the map is shared.
 *
 * The boundary map is the whole substance: a pattern shorter than the
 * progression repeats, so a chord end is folded onto the cycle with `%` by
 * `foldPatternBoundaries` — a two-bar pattern under a one-plus-three-bar
 * progression sees a boundary in the MIDDLE of every repetition, and that is
 * the only stored length that is legal on every repetition.
 *
 * Durations are absolute 16th steps, never `ChordItem.bars` directly, so a
 * later fractional-duration chord supplies its own step length without
 * changing this contract (see the phase-1 spec's timeline model).
 */
function customPatternSpans<TValue>(state: CustomPatternState<TValue>): PatternSpans<TValue> {
  const cycleSteps = state.loopLength * state.stepsPerBar;
  return {
    values: state.values,
    holds: state.holds,
    stepsPerBar: state.stepsPerBar,
    cycleSteps,
    boundaries: foldPatternBoundaries(
      state.chords.map((chord) => chord.bars * state.stepsPerBar),
      cycleSteps,
    ),
    empty: state.empty,
  };
}

/**
 * Set the length of the span that STARTS at `column`, or null when no onset
 * starts there. A drag handle only ever belongs to a block's head, but a
 * column arriving from a stale pointer stream must not CREATE an onset — that
 * is `setCustomChordEvent`'s job, and a length gesture that quietly wrote one
 * would make a drag on empty space compose music.
 *
 * The requested length clamps at the next folded chord boundary and at the
 * cycle end inside `writePatternSpan`, which also deletes every onset the span
 * covers — the same one-lane non-overlap rule every custom edit goes through.
 */
export function resizePatternSpanAt<TValue>(
  spans: PatternSpans<TValue>,
  column: number,
  holdSteps: number,
): PatternSpansResult<TValue> | null {
  if (!isVisiblePatternColumn(column, spans.cycleSteps)) return null;
  const head = patternStoredIndexAt(column, spans.stepsPerBar);
  if (!Number.isInteger(head) || head < 0 || head >= spans.values.length) return null;
  if (spans.values[head] === spans.empty) return null;
  return changedPatternResult(
    spans,
    writePatternSpan({ ...spans, column, value: spans.values[head], holdSteps }),
  );
}

/** Drop a freshly allocated edit when it changed no stored slot. */
function changedPatternResult<TValue>(
  before: PatternSpans<TValue>,
  after: PatternSpansResult<TValue>,
): PatternSpansResult<TValue> | null {
  if (before.values.length !== after.values.length || before.holds.length !== after.holds.length) {
    return after;
  }
  for (let i = 0; i < after.values.length; i += 1) {
    if (before.values[i] !== after.values[i] || before.holds[i] !== after.holds[i]) return after;
  }
  return null;
}

/**
 * Write one explicit event at `column`: a new onset holding a single step, or —
 * when the caller writes the lane's own empty value — the whole span starting
 * there cleared back to empty. Erasing a span is a WRITE, not a deletion: the
 * head keeps its slot with a one-step hold and the slots the span covered
 * become empty, which is the same result a per-lane non-overlap model gives
 * and the reason `replaceDrumPattern`-style clearing is not needed here.
 *
 * **A click on a slot that already holds an onset edits the token, never the
 * length.** Re-clicking a note tool inside a span re-voices it and keeps the
 * span's own hold, and writing the value it already holds changes nothing at
 * all. A one-step hold is what an onset NEWLY created on an empty slot gets;
 * asking for it on a slot that already sounds made every bass note-tool click
 * collapse a held note to a stab, which is an edit the user did not ask for.
 * The rule is value-relative rather than lane-specific, so it holds for both
 * callers: the bass lane's tokens differ from its `rest`, and the chord lane's
 * single non-empty value is `true`, where a same-value write is the no-op the
 * panels' own edit-fire discipline already relies on.
 *
 * The clearing branch reuses the span's OWN hold as the write length, so the
 * covered slots are the ones the span was actually drawing on — a `holdSteps`
 * of 1 would erase the head and leave the rest of the block behind.
 */
export function writePatternEvent<TValue>(input: {
  spans: PatternSpans<TValue>;
  column: number;
  value: TValue;
}): PatternSpansResult<TValue> | null {
  const { spans, column, value } = input;
  if (!isVisiblePatternColumn(column, spans.cycleSteps)) return null;
  const head = patternStoredIndexAt(column, spans.stepsPerBar);
  const existing = spans.values[head];
  if (existing === value) return null;
  if (value !== spans.empty && existing !== spans.empty) {
    return writePatternSpan({ ...spans, column, value, holdSteps: spans.holds[head] });
  }
  const holdSteps = value === spans.empty ? spans.holds[head] : 1;
  return writePatternSpan({ ...spans, column, value, holdSteps });
}

/**
 * A lane's arrays re-cut to `requestedBars` whole bars, with the request
 * clamped down to a divisor of the progression so the pattern still repeats
 * evenly against the chords above it. Growing pads with `empty`/one-step
 * holds; trimming drops the trailing bars outright, because an explicit length
 * change is the one edit allowed to discard them.
 */
export function resizedCustomPattern<TValue>(input: {
  chords: readonly ChordItem[];
  values: readonly TValue[];
  holds: readonly number[];
  requestedBars: number;
  empty: TValue;
}): { loopLength: number; values: TValue[]; holds: number[] } {
  const loopLength = clampLoopLength(
    Math.floor(input.requestedBars),
    progressionBars(input.chords),
  );
  return { loopLength, ...resizePatternBars(input.values, input.holds, loopLength, input.empty) };
}

/**
 * A lane's arrays normalized against the boundaries its cycle folds the
 * progression onto: every hold re-clamped to the next boundary or the cycle
 * end, every onset a stretched hold covers deleted, rest slots reset to a
 * one-step hold. The bar length is a parameter, not a meter lookup, because
 * the read path has no meter to look up — see `sanitizeCustomPatternSpans`.
 */
export function normalizeCustomPattern<TValue>(
  input: CustomPatternState<TValue>,
): PatternSpansResult<TValue> {
  return normalizePatternSpans(customPatternSpans(input));
}

/**
 * A lane re-clamped after the PROGRESSION changed — not after the user asked
 * for a shorter pattern, which is why nothing is trimmed here.
 *
 * Two things move and only two: the cycle drops to the largest divisor of the
 * new bar count that the old one still fits inside, and every hold is
 * re-clamped against the boundaries that progression now folds onto the cycle.
 * The arrays keep their full stored width, so a bar the new cycle cannot reach
 * is DORMANT rather than deleted and raising the length again brings its
 * onsets back — the same non-destructive rule the meter and the lead
 * resolution follow.
 */
export function reclampCustomPattern<TValue>(input: {
  chords: readonly ChordItem[];
  values: readonly TValue[];
  holds: readonly number[];
  loopLength: number;
  /** The ACTIVE meter's bar length in 16th steps. */
  stepsPerBar: number;
  empty: TValue;
}): { loopLength: number; values: TValue[]; holds: number[] } {
  const loopLength = clampLoopLength(input.loopLength, progressionBars(input.chords));
  return { loopLength, ...normalizeCustomPattern({ ...input, loopLength }) };
}

/** The live state (or any Loop-plus-meter view of it) a custom chord edit reads. */
export interface CustomChordLaneState {
  chords: readonly ChordItem[];
  meterId: string;
  customChordRhythm: readonly boolean[];
  customChordHoldSteps: readonly number[];
  customChordLoopLength: number;
}

/** The chord lane's spans. Named rather than inlined so the field pairing lives in one place. */
export function customChordSpans(state: CustomChordLaneState): PatternSpans<boolean> {
  return customPatternSpans({
    values: state.customChordRhythm,
    holds: state.customChordHoldSteps,
    chords: state.chords,
    loopLength: state.customChordLoopLength,
    stepsPerBar: getMeter(state.meterId).stepsPerBar,
    empty: false,
  });
}

/** The live state (or any Loop-plus-meter view of it) a custom bass edit reads. */
export interface CustomBassLaneState {
  chords: readonly ChordItem[];
  meterId: string;
  customBassPattern: readonly BassStepChoice[];
  customBassHoldSteps: readonly number[];
  customBassLoopLength: number;
}

/** The bass lane's spans — the same boundary map, over its own arrays and its own cycle. */
export function customBassSpans(state: CustomBassLaneState): PatternSpans<BassStepChoice> {
  return customPatternSpans({
    values: state.customBassPattern,
    holds: state.customBassHoldSteps,
    chords: state.chords,
    loopLength: state.customBassLoopLength,
    stepsPerBar: getMeter(state.meterId).stepsPerBar,
    empty: 'rest',
  });
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
export function loopStatePatch(source: object): LoopContent {
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const key of LOOP_FLAT_KEYS) {
    out[key] = src[key];
  }
  return out as LoopContent;
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
