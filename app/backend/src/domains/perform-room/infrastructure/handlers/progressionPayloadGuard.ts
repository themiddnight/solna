import { isValidChordModifier, type CompanionChordProgression } from '@jam-band/shared';

const VALID_BARS = new Set<number>([0.5, 1, 2, 4]);
const VALID_QUALITIES = new Set<string>(['maj', 'min', 'dim', 'aug']);

function isValidStep(c: unknown): boolean {
  if (c == null || typeof c !== 'object') return false;
  const entry = c as Record<string, unknown>;

  const dur = entry['durationBars'];
  if (!(typeof dur === 'number' && VALID_BARS.has(dur))) return false;

  const mods = entry['modifiers'];
  if (mods !== undefined) {
    if (!Array.isArray(mods)) return false;
    if (!mods.every((m) => typeof m === 'string' && isValidChordModifier(m))) return false;
  }

  const kind = entry['kind'];
  if (kind === 'borrowed') {
    const semi = entry['semitones'];
    const quality = entry['quality'];
    return typeof semi === 'number' && Number.isInteger(semi) && semi >= 0 && semi <= 11
      && typeof quality === 'string' && VALID_QUALITIES.has(quality);
  }
  if (kind !== undefined && kind !== 'diatonic') return false;
  const deg = entry['degree'];
  return typeof deg === 'number' && Number.isInteger(deg) && deg >= 1 && deg <= 7;
}

export function isValidProgressionPayload(p: unknown): p is CompanionChordProgression {
  if (p === null || p === undefined || typeof p !== 'object') return false;
  const prog = p as Partial<CompanionChordProgression>;
  const isModeOk = prog.mode === 'random' || prog.mode === 'manual';
  const isChordsOk = Array.isArray(prog.chords) && prog.chords.length <= 8 && prog.chords.every(isValidStep);
  const isBarsOk = typeof prog.barsPerChord === 'number' && VALID_BARS.has(prog.barsPerChord);
  const isIdxOk = typeof prog.currentChordIndex === 'number' && prog.currentChordIndex >= 0;
  return isModeOk && isChordsOk && isBarsOk && isIdxOk;
}
