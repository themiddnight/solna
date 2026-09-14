import { BASS_PATTERNS } from '@/data/bassPatterns';
import { DRUM_KITS } from '@/data/drumKits';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import type { MasterEffects } from '../types';
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { createDefaultLoop } from './loopSlice';
import { PROJECT_FORMAT_VERSION, pickLoopContent, type ProjectBody, type ProjectContent } from './projectFormat';
import { clampFinite, sanitizeEffectsValue, sanitizeLoops } from './sanitize';
import { validateActiveSynth } from './sanitizeSynth';
import { SYNTH_PARAM_FIELD } from './sourceBuses';
import type { SynthControlTarget } from '@/utils/synthControl';
import { asFaderDb } from './levelUnits';

export const PROJECT_FILE_MIME = 'application/json';
export const PROJECT_FILE_EXTENSION = '.solna';
/** `.json` too: some mobile file providers rewrite an unknown extension. */
export const PROJECT_FILE_ACCEPT = '.solna,.json';

const NEWER_VERSION_MESSAGE = 'This project was saved by a newer version of Solna.';
export const MALFORMED_MESSAGE = 'This file is not a Solna project.';

export type ProjectParseResult =
  | { ok: true; body: ProjectBody; warnings: string[] }
  | { ok: false; error: 'malformed' | 'newer-version'; message: string };

/** Plain JSON, pretty-printed so the file stays readable in a text editor. */
export function serializeProject(body: ProjectBody): string {
  return JSON.stringify(body, null, 2);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const malformed = (): ProjectParseResult => ({ ok: false, error: 'malformed', message: MALFORMED_MESSAGE });

/**
 * Content goes through the SAME guards persist hydration uses (sanitize.ts):
 * a wrong-typed field falls back, an empty or invalid loops array becomes one
 * default loop, and unknown library ids are kept verbatim.
 *
 * `sanitizeLoops` returns full `Loop[]` — the same shape persist hydration
 * reads, tempName included — so it is piped through `pickLoopContent` here
 * too, not just at `buildProjectContent`'s write site: this function is the
 * OTHER producer of a `ProjectContent`, and a `ProjectLoop` must never carry
 * `tempName` regardless of which producer built it.
 */
function sanitizeContent(raw: unknown): ProjectContent {
  const c = isPlainObject(raw) ? raw : {};
  const meterId = isMeterId(c.meterId) ? c.meterId : DEFAULT_METER_ID;
  const loops = sanitizeLoops(c.loops, meterId) ?? [createDefaultLoop()];
  return {
    bpm: clampFinite(c.bpm, 20, 300, 120),
    meterId,
    masterVolume: asFaderDb(c.masterVolume),
    effects: sanitizeEffectsValue(c.effects) as MasterEffects,
    loops: loops.map(pickLoopContent),
  };
}

/**
 * The user-facing name of each synth track, for an import notice.
 *
 * Spelled here rather than imported from `SYNTH_TARGET_STYLES`: that table is
 * the UI's per-target STYLING and carries Tailwind class strings, and pulling
 * it into the store to borrow five words would make a class-name edit a
 * store-layer change.
 */
const TRACK_LABELS: Record<SynthControlTarget, string> = {
  synth: 'Lead',
  chord: 'Chords',
  bass: 'Bass',
  pad: 'Pad',
  fx: 'FX',
};

/**
 * Every synth patch in the RAW body that cannot be read, named by its track.
 *
 * Run against the raw content rather than the sanitised result, because
 * sanitisation is lossy by design: an unreadable patch has already become the
 * track's complete default by the time `ProjectContent` exists, and a user
 * whose file silently lost the sound they saved deserves to be told which
 * track it was. Re-validating is cheap here — this runs once per import, not
 * per frame.
 *
 * ONE track's failure never touches its siblings: each is validated on its
 * own, so a body with a corrupt Bass patch still imports the Lead, Chords,
 * Pad and FX sounds the author saved.
 */
function unreadableSynthPatches(raw: unknown): string[] {
  const content = isPlainObject(raw) ? raw : {};
  const loops = Array.isArray(content.loops) ? content.loops : [];
  const found = new Set<string>();
  for (const loop of loops) {
    if (!isPlainObject(loop)) continue;
    for (const [target, field] of Object.entries(SYNTH_PARAM_FIELD) as [SynthControlTarget, string][]) {
      // An ABSENT patch is not an unreadable one: a body written before this
      // field existed is simply old, and reporting every missing key would
      // make the notice noise rather than a signal.
      if (loop[field] === undefined) continue;
      // Did validation fail WHOLE, not "were there issues". A patch carrying one
      // out-of-range number is clamped and KEPT, and that pushes an issue as
      // well — reading the issue list here told a user whose stored cutoff was
      // merely too high that their Lead sound had been replaced, on every boot,
      // since `projectStore.load` runs this on each IndexedDB read. A notice
      // that cries loss over a value that survived is one people learn to
      // ignore, which costs them the one time it is true.
      //
      // `validateActiveSynth` rather than `sanitizeActiveSynth`: this is a
      // PROBE, and the sanitizing wrapper would `structuredClone` a default
      // patch for every unreadable one just to have it thrown away here.
      if (validateActiveSynth(loop[field]).value === null) {
        found.add(`${TRACK_LABELS[target]} sound (reset to the default)`);
      }
    }
  }
  return [...found];
}

/**
 * Soft references a loop carries by id or name. The file is still valid when
 * one is unknown — the resolution paths already degrade (CHORD_RHYTHMS[0],
 * BASS_PATTERNS[0], the default kit) — so this only names them for a notice.
 * A patch's `sourcePresetId` is display provenance nobody resolves and is not
 * checked.
 */
export function unknownLibraryReferences(content: ProjectContent): string[] {
  const rhythmIds = new Set(CHORD_RHYTHMS.map((p) => p.id));
  const bassIds = new Set(BASS_PATTERNS.map((p) => p.id));
  const found = new Set<string>();
  for (const loop of content.loops) {
    if (!rhythmIds.has(loop.chordRhythmId)) found.add(`chord rhythm "${loop.chordRhythmId}"`);
    if (!bassIds.has(loop.bassPatternId)) found.add(`bass pattern "${loop.bassPatternId}"`);
    if (!(loop.soundKit in DRUM_KITS)) found.add(`drum kit "${loop.soundKit}"`);
  }
  return [...found];
}

/**
 * Whole-file validation. Envelope problems refuse the import outright; a
 * newer formatVersion is refused without a best-effort read; an older
 * formatVersion is accepted (nothing above sanitizeContent reads it), and
 * content is sanitised, never refused — see PROJECT_FORMAT_VERSION's own
 * docblock in projectFormat.ts for what "sanitised" resets and why.
 */
export function parseProjectFile(text: string): ProjectParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed();
  }
  if (!isPlainObject(parsed)) return malformed();
  if (!isFiniteNumber(parsed.formatVersion) || !Number.isInteger(parsed.formatVersion) || parsed.formatVersion < 1) {
    return malformed();
  }
  if (parsed.formatVersion > PROJECT_FORMAT_VERSION) {
    return { ok: false, error: 'newer-version', message: NEWER_VERSION_MESSAGE };
  }
  const raw = parsed;

  if (typeof raw.id !== 'string' || raw.id.length === 0) return malformed();
  if (typeof raw.name !== 'string') return malformed();
  if (!isFiniteNumber(raw.createdAt) || !isFiniteNumber(raw.updatedAt)) return malformed();
  if (!isPlainObject(raw.content)) return malformed();

  const content = sanitizeContent(raw.content);
  return {
    ok: true,
    body: {
      formatVersion: PROJECT_FORMAT_VERSION,
      id: raw.id,
      name: raw.name,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      content,
    },
    warnings: [...unknownLibraryReferences(content), ...unreadableSynthPatches(raw.content)],
  };
}

/**
 * The OTHER reader of a stored project body: one read back out of the
 * IndexedDB library (projectStore.ts). CLAUDE.md calls IndexedDB the saved
 * project library and `.solna` the secondary path, so this is the reader that
 * sees an old body FIRST — every project saved before a format bump sits in
 * there at its original version.
 *
 * Same single step as parseProjectFile: sanitizeContent, unconditionally,
 * regardless of what formatVersion the stored body carries — DEV-388 deleted
 * the per-version migration chain this docblock used to describe running
 * first. The envelope is NOT re-validated — a body that got into the library
 * came through parse or through this build's own writer — and the version is
 * restamped to PROJECT_FORMAT_VERSION unconditionally on every read, not
 * only once content has been "upgraded" (there is no upgrade step left to
 * wait for).
 *
 * A body from a NEWER build is returned verbatim: `get` has no way to report
 * "newer-version", and sanitising it would strip the fields that build added
 * and then persist the loss on the next save. Leaving it alone keeps it
 * readable by the build that wrote it.
 *
 * `warnings` is the same set `parseProjectFile` returns and is computed the
 * same way — against the RAW content, before `sanitizeContent` erases what it
 * describes. It is here because this is the path a user hits FIRST and most
 * often: the project sitting in the slot was written by whatever build last
 * saved it, so if a synth patch in it no longer reads, all five tracks come
 * back at factory defaults on the next boot. Opening a `.solna` says so
 * already; a boot that silently replaced the user's sounds and said nothing is
 * the same loss with the notice taken away.
 *
 * A newer body warns about nothing, because nothing was sanitised out of it.
 */
export function normalizeStoredBody(body: ProjectBody): { body: ProjectBody; warnings: string[] } {
  const raw = body as unknown as Record<string, unknown>;
  const version = isFiniteNumber(raw.formatVersion) ? raw.formatVersion : 1;
  if (version > PROJECT_FORMAT_VERSION) return { body, warnings: [] };
  const warnings = unreadableSynthPatches(raw.content);
  return {
    body: {
      ...(raw as unknown as ProjectBody),
      formatVersion: PROJECT_FORMAT_VERSION,
      content: sanitizeContent(raw.content),
    },
    warnings,
  };
}
