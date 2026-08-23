import { getScaleNotes, rootSemitone, ROOTS } from './musicTheory';

export function isTypingTarget(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

const CODE_LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
};

// Display label for a KeyboardEvent.code value (physical key, layout-independent)
export function shortcutLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return CODE_LABELS[code] ?? code;
}

const KEYBOARD_OCTAVE_MIN = -2;
const KEYBOARD_OCTAVE_MAX = 2;

export function clampKeyboardOctave(octave: number): number {
  return Math.min(KEYBOARD_OCTAVE_MAX, Math.max(KEYBOARD_OCTAVE_MIN, octave));
}

const TOP_ROW_KEYS = [
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyY',
  'KeyU',
  'KeyI',
  'KeyO',
  'KeyP',
  'BracketLeft',
  'BracketRight',
];

const HOME_ROW_KEYS = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Semicolon',
  'Quote',
];

// Scale-locked computer-keyboard mapping: the top row plays the tonic and the
// scale notes above it, the home row plays the 4th scale note two octaves below
// the tonic and up (C major: q = C3 … ] = G4, a = F1 … ' = B2).
export interface ScaleKeyboardNote {
  note: string;
  label: string;
  key: string;
  isBlack: boolean;
}

// Scale-locked computer-keyboard mapping, laid out like the two QWERTY rows:
// the top row plays the tonic and the scale notes above it, the home row plays
// the 4th scale note two octaves below the tonic and up
// (C major: q = C3 … ] = G4, a = F1 … ' = B2). For scales with fewer than
// 7 notes the rows overlap.
export function getScaleLockedKeyboardNotes(
  root: string,
  scaleType: string,
  octaveOffset: number,
): { homeRow: ScaleKeyboardNote[]; topRow: ScaleKeyboardNote[] } {
  const scaleNotes = getScaleNotes(root, scaleType);
  const scaleLength = scaleNotes.length;
  const tonicOctave = 3 + octaveOffset;
  // Absolute pitch of the tonic (C-1 = 0): scale steps must wrap octaves at C,
  // not at the tonic, so notes keep ascending for non-C roots.
  const rootChroma = rootSemitone(root);
  const tonicPitch = rootChroma + 12 * (tonicOctave + 1);
  const scaleSemitones = scaleNotes.map(
    (n) => ((ROOTS as readonly string[]).indexOf(n) - rootChroma + 12) % 12,
  );
  const homeRowStart = -(2 * scaleLength - 3);

  const noteAt = (step: number): ScaleKeyboardNote => {
    const degree = ((step % scaleLength) + scaleLength) % scaleLength;
    const pitch =
      tonicPitch + 12 * Math.floor(step / scaleLength) + scaleSemitones[degree];
    const note = `${ROOTS[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
    return { note, label: note, key: "", isBlack: false };
  };

  const homeRow = HOME_ROW_KEYS.map((key, i) => ({
    ...noteAt(homeRowStart + i),
    key,
  }));
  const topRow = TOP_ROW_KEYS.map((key, i) => ({ ...noteAt(i), key }));
  return { homeRow, topRow };
}

export function getScaleLockedKeyboardNotesFlat(
  root: string,
  scaleType: string,
  octaveOffset: number,
): ScaleKeyboardNote[] {
  const { homeRow, topRow } = getScaleLockedKeyboardNotes(
    root,
    scaleType,
    octaveOffset,
  );
  return [...homeRow, ...topRow];
}
