import { getScaleNotes, rootSemitone, ROOTS } from '../../utils/musicTheory';
import { shortcutLabel } from '../../utils/keyboard';

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

const KEYBOARD_NOTES = [
  { note: "C3", label: "C3", key: "KeyA", isBlack: false },
  { note: "C#3", label: "C#", key: "KeyW", isBlack: true },
  { note: "D3", label: "D3", key: "KeyS", isBlack: false },
  { note: "D#3", label: "D#", key: "KeyE", isBlack: true },
  { note: "E3", label: "E3", key: "KeyD", isBlack: false },
  { note: "F3", label: "F3", key: "KeyF", isBlack: false },
  { note: "F#3", label: "F#", key: "KeyT", isBlack: true },
  { note: "G3", label: "G3", key: "KeyG", isBlack: false },
  { note: "G#3", label: "G#", key: "KeyY", isBlack: true },
  { note: "A3", label: "A3", key: "KeyH", isBlack: false },
  { note: "A#3", label: "A#", key: "KeyU", isBlack: true },
  { note: "B3", label: "B3", key: "KeyJ", isBlack: false },
  { note: "C4", label: "C4", key: "KeyK", isBlack: false },
  { note: "C#4", label: "C#", key: "KeyO", isBlack: true },
  { note: "D4", label: "D4", key: "KeyL", isBlack: false },
  { note: "D#4", label: "D#", key: "KeyP", isBlack: true },
  { note: "E4", label: "E4", key: "Semicolon", isBlack: false },
  { note: "F4", label: "F4", key: "Quote", isBlack: false },
];

export function ScaleLockedKey({
  k,
  isActive,
  onNoteOn,
  onNoteOff,
}: {
  k: ScaleKeyboardNote;
  isActive: boolean;
  onNoteOn: (note: string) => void;
  onNoteOff: (note: string) => void;
}) {
  return (
    <div
      id={`key-${k.note}`}
      onMouseDown={() => onNoteOn(k.note)}
      onMouseUp={() => onNoteOff(k.note)}
      onMouseLeave={() => isActive && onNoteOff(k.note)}
      onTouchStart={(e) => {
        e.preventDefault();
        onNoteOn(k.note);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onNoteOff(k.note);
      }}
      className={`w-12 h-full rounded-b-md border border-slate-700 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
        isActive
          ? "bg-gradient-to-b from-indigo-200 to-indigo-400 text-slate-950 shadow-inner scale-[0.99]"
          : "bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 hover:from-white hover:to-slate-100"
      }`}
    >
      <span className="text-[10px] font-mono font-bold">{k.label}</span>
      <span className="text-[9px] font-mono text-indigo-600 uppercase font-semibold">
        {shortcutLabel(k.key)}
      </span>
    </div>
  );
}

// Two QWERTY rows for scale-locked mode: top row (Q..]) above the home row
// (A..'), staggered like a physical keyboard.
export function ScaleLockedKeyboard({
  rows,
  activeNotes,
  onNoteOn,
  onNoteOff,
}: {
  rows: { homeRow: ScaleKeyboardNote[]; topRow: ScaleKeyboardNote[] };
  activeNotes: Set<string>;
  onNoteOn: (note: string) => void;
  onNoteOff: (note: string) => void;
}) {
  return (
    <>
      <div className="flex flex-1 w-full gap-0.5 [justify-content:safe_center]">
        {rows.topRow.map((k) => (
          <ScaleLockedKey
            key={k.note}
            k={k}
            isActive={activeNotes.has(k.note)}
            onNoteOn={onNoteOn}
            onNoteOff={onNoteOff}
          />
        ))}
      </div>
      <div className="flex flex-1 w-full gap-0.5 [justify-content:safe_center]">
        {rows.homeRow.map((k) => (
          <ScaleLockedKey
            key={k.note}
            k={k}
            isActive={activeNotes.has(k.note)}
            onNoteOn={onNoteOn}
            onNoteOff={onNoteOff}
          />
        ))}
      </div>
    </>
  );
}

export function ChromaticKeyboard({
  octaveOffset,
  activeNotes,
  onNoteOn,
  onNoteOff,
}: {
  octaveOffset: number;
  activeNotes: Set<string>;
  onNoteOn: (note: string) => void;
  onNoteOff: (note: string) => void;
}) {
  return (
    <div className="relative flex">
      {getChromaticKeyboardNotes(octaveOffset).map((k, noteIndex) => {
        const isActive = activeNotes.has(k.note);
        if (k.isBlack) {
          return (
            <div
              key={k.note}
              id={`key-${k.note}`}
              onMouseDown={() => onNoteOn(k.note)}
              onMouseUp={() => onNoteOff(k.note)}
              onMouseLeave={() => isActive && onNoteOff(k.note)}
              onTouchStart={(e) => {
                e.preventDefault();
                onNoteOn(k.note);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                onNoteOff(k.note);
              }}
              className={`absolute z-10 w-9 h-[100px] rounded-b-md border border-slate-900 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
                isActive
                  ? "bg-gradient-to-b from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/50 scale-[0.98]"
                  : "bg-gradient-to-b from-slate-800 to-slate-950 hover:bg-slate-800"
              }`}
              style={{
                left: `${getBlackKeyLeftPx(noteIndex)}px`,
              }}
            >
              <span className="text-[9px] font-mono font-bold text-slate-300">
                {k.label}
              </span>
              <span className="text-[8px] font-mono text-indigo-400 uppercase">
                {shortcutLabel(k.key)}
              </span>
            </div>
          );
        }

        return (
          <div
            key={k.note}
            id={`key-${k.note}`}
            onMouseDown={() => onNoteOn(k.note)}
            onMouseUp={() => onNoteOff(k.note)}
            onMouseLeave={() => isActive && onNoteOff(k.note)}
            onTouchStart={(e) => {
              e.preventDefault();
              onNoteOn(k.note);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              onNoteOff(k.note);
            }}
            className={`w-16 h-full rounded-b-md border border-slate-700 mx-0.5 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
              isActive
                ? "bg-gradient-to-b from-indigo-200 to-indigo-400 text-slate-950 shadow-inner scale-[0.99]"
                : "bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 hover:from-white hover:to-slate-100"
            }`}
          >
            <span className="text-[10px] font-mono font-bold">
              {k.label}
            </span>
            <span className="text-[9px] font-mono text-indigo-600 uppercase font-semibold">
              {shortcutLabel(k.key)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// White key: w-16 (64px) + mx-0.5 (4px total) = 68px stride; black key: w-9 = 36px.
// Positions are derived from white-key boundaries, so they hold at any octave
// offset and container width.
const WHITE_KEY_STRIDE_PX = 68;
const BLACK_KEY_WIDTH_PX = 36;

export function getBlackKeyLeftPx(noteIndex: number): number {
  const whiteKeysBefore = KEYBOARD_NOTES.slice(0, noteIndex).filter(
    (k) => !k.isBlack,
  ).length;
  return whiteKeysBefore * WHITE_KEY_STRIDE_PX - BLACK_KEY_WIDTH_PX / 2;
}

// Chromatic keyboard always starts from C — octaveOffset shifts the range up/down
// Not affected by master key/scale; regex supports any octave number
export function getChromaticKeyboardNotes(octaveOffset: number) {
  return KEYBOARD_NOTES.map((k) => {
    const match = k.note.match(/^([A-G][#b]?)(-?\d+)/);
    if (match) {
      const noteName = match[1];
      const origOct = parseInt(match[2], 10);
      const targetOct = origOct + octaveOffset;
      return {
        ...k,
        note: `${noteName}${targetOct}`,
        label: k.isBlack ? noteName : `${noteName}${targetOct}`,
      };
    }
    return k;
  });
}
