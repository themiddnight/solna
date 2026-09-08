import { BASS_PATTERNS } from '@/data/bassPatterns';
import { DRUM_KITS } from '@/data/drumKits';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import type { MasterEffects } from '../types';
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { createDefaultLoop } from './loopSlice';
import { PROJECT_FORMAT_VERSION, type ProjectBody, type ProjectContent } from './projectFormat';
import { clampFinite, sanitizeEffectsValue, sanitizeLoops } from './sanitize';
import { asFaderDb } from './levelUnits';

export const PROJECT_FILE_MIME = 'application/json';
export const PROJECT_FILE_EXTENSION = '.solna';
/** `.json` too: some mobile file providers rewrite an unknown extension. */
export const PROJECT_FILE_ACCEPT = '.solna,.json';

export const NEWER_VERSION_MESSAGE = 'This project was saved by a newer version of Solna.';
export const MALFORMED_MESSAGE = 'This file is not a Solna project.';

export type ProjectParseResult =
  | { ok: true; body: ProjectBody; warnings: string[] }
  | { ok: false; error: 'malformed' | 'newer-version'; message: string };

/** Plain JSON, pretty-printed so the file stays readable in a text editor. */
export function serializeProject(body: ProjectBody): string {
  return JSON.stringify(body, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
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
 */
export function sanitizeContent(raw: unknown): ProjectContent {
  const c = isPlainObject(raw) ? raw : {};
  return {
    bpm: clampFinite(c.bpm, 20, 300, 120),
    meterId: isMeterId(c.meterId) ? c.meterId : DEFAULT_METER_ID,
    masterVolume: asFaderDb(c.masterVolume),
    effects: sanitizeEffectsValue(c.effects) as MasterEffects,
    loops: sanitizeLoops(c.loops) ?? [createDefaultLoop()],
  };
}

/**
 * Soft references a loop carries by id or name. The file is still valid when
 * one is unknown — the resolution paths already degrade (CHORD_RHYTHMS[0],
 * BASS_PATTERNS[0], the default kit) — so this only names them for a notice.
 * SynthParams.preset is a label nobody resolves and is not checked.
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
    warnings: unknownLibraryReferences(content),
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
 */
export function normalizeStoredBody(body: ProjectBody): ProjectBody {
  const raw = body as unknown as Record<string, unknown>;
  const version = isFiniteNumber(raw.formatVersion) ? raw.formatVersion : 1;
  if (version > PROJECT_FORMAT_VERSION) return body;
  return {
    ...(raw as unknown as ProjectBody),
    formatVersion: PROJECT_FORMAT_VERSION,
    content: sanitizeContent(raw.content),
  };
}
