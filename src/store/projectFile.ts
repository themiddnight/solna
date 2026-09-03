import { BASS_PATTERNS } from '../audio/bassPatterns';
import { DRUM_KITS } from '../audio/drumKits';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import type { MasterEffects } from '../types';
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { createDefaultLoop } from './loopSlice';
import { PROJECT_FORMAT_VERSION, type ProjectBody, type ProjectContent } from './projectFormat';
import { migrateProjectBody } from './projectFormatMigrate';
import { clampFinite, sanitizeEffectsValue, sanitizeLoops } from './sanitize';

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
function sanitizeContent(raw: unknown): ProjectContent {
  const c = isPlainObject(raw) ? raw : {};
  return {
    bpm: clampFinite(c.bpm, 20, 300, 120),
    meterId: isMeterId(c.meterId) ? c.meterId : DEFAULT_METER_ID,
    masterVolume: clampFinite(c.masterVolume, 0, 1, 0.85),
    effects: sanitizeEffectsValue(c.effects) as MasterEffects,
    loops: sanitizeLoops(c.loops) ?? [createDefaultLoop()],
  };
}

/**
 * Soft references a loop carries by id or name. The file is still valid when
 * one is unknown — the resolution paths already degrade (RHYTHM_PATTERNS[0],
 * BASS_PATTERNS[0], the default kit) — so this only names them for a notice.
 * SynthParams.preset is a label nobody resolves and is not checked.
 */
export function unknownLibraryReferences(content: ProjectContent): string[] {
  const rhythmIds = new Set(RHYTHM_PATTERNS.map((p) => p.id));
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
 * newer formatVersion is refused without a best-effort read; an older one runs
 * the format migration chain; content is sanitised, never refused.
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
  const raw = parsed.formatVersion < PROJECT_FORMAT_VERSION
    ? migrateProjectBody(parsed, parsed.formatVersion)
    : parsed;

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
