import { useRef } from 'react';
import {
  getScaleNotes,
  rootSemitone,
  ROOTS,
  SCALES,
  getDiatonicChordForDegree,
  formatChordLabel,
  generateBlockChordNotes,
} from '../../utils/musicTheory';
import { shortcutLabel } from '../../utils/keyboard';

const KEYBOARD_OCTAVE_MIN = -2;
const KEYBOARD_OCTAVE_MAX = 2;

export function clampKeyboardOctave(octave: number): number {
  return Math.min(KEYBOARD_OCTAVE_MAX, Math.max(KEYBOARD_OCTAVE_MIN, octave));
}

export const TOP_ROW_KEYS = [
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

export const HOME_ROW_KEYS = [
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

export interface ScaleKeyboardNote {
  note: string;
  label: string;
  key: string;
  isBlack: boolean;
}

// Absolute pitch (C-1 = 0) of a scale step relative to a given tonic pitch,
// wrapping octaves at C rather than at the tonic — this is what keeps scale
// steps ascending correctly for non-C roots. Shared by every scale-locked
// note/step computation so there is exactly one place this math lives.
function scaleStepNote(
  tonicPitch: number,
  scaleSemitones: number[],
  scaleLength: number,
  step: number,
): string {
  const degree = ((step % scaleLength) + scaleLength) % scaleLength;
  const pitch =
    tonicPitch + 12 * Math.floor(step / scaleLength) + scaleSemitones[degree];
  return `${ROOTS[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function scaleSemitonesFor(root: string, scaleNotes: string[]): number[] {
  const rootChroma = rootSemitone(root);
  return scaleNotes.map(
    (n) => ((ROOTS as readonly string[]).indexOf(n) - rootChroma + 12) % 12,
  );
}

// Scale-locked computer-keyboard mapping, laid out like the two QWERTY rows:
// the top row plays the tonic and the scale notes above it, the home row plays
// the 4th scale note two octaves below the tonic and up
// (C major: q = C4 … ] = G5, a = F2 … ' = B3). For scales with fewer than
// 7 notes the rows overlap.
export function getScaleLockedKeyboardNotes(
  root: string,
  scaleType: string,
  octaveOffset: number,
): { homeRow: ScaleKeyboardNote[]; topRow: ScaleKeyboardNote[] } {
  const scaleNotes = getScaleNotes(root, scaleType);
  const scaleLength = scaleNotes.length;
  const tonicOctave = 4 + octaveOffset;
  // Absolute pitch of the tonic (C-1 = 0): scale steps must wrap octaves at C,
  // not at the tonic, so notes keep ascending for non-C roots.
  const rootChroma = rootSemitone(root);
  const tonicPitch = rootChroma + 12 * (tonicOctave + 1);
  const scaleSemitones = scaleSemitonesFor(root, scaleNotes);
  const homeRowStart = -(2 * scaleLength - 3);

  const noteAt = (step: number): ScaleKeyboardNote => {
    const note = scaleStepNote(tonicPitch, scaleSemitones, scaleLength, step);
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

export const KEYBOARD_NOTES = [
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

// Shared key-button shape for the scale-locked and chord-mode keyboards, so
// their buttons are the same size by construction rather than by coincidence
// of whatever parent they land in. Sizing is intrinsic (h-19.5 = 4.875rem =
// 78px), not inherited via h-full: derived from the scale keyboard's own
// container (h-45 = 180px, p-2 = 16px vertical padding, border = 2px vertical,
// flex-col gap-1.5 = 6px between the two rows) — (180 - 16 - 2 - 6) / 2 = 78px
// per row. That is the established scale-mode look; chord mode is what
// changes to match it.
export function KeyCap({
  id,
  ariaLabel,
  isActive,
  label,
  shortcutKey,
  onPress,
  onRelease,
}: {
  id: string;
  ariaLabel: string;
  isActive: boolean;
  label: string;
  shortcutKey: string;
  onPress: () => void;
  onRelease: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      onMouseDown={onPress}
      onMouseUp={onRelease}
      onMouseLeave={() => isActive && onRelease()}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onPress();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onRelease();
        }
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onRelease();
      }}
      className={`w-12 h-19.5 rounded-b-field border border-base-300 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all select-none ${
        isActive
          ? "bg-primary text-primary-content shadow-inner scale-[0.99]"
          : "bg-key-white text-key-white-content hover:brightness-105"
      }`}
    >
      <span className="text-[10px] font-mono font-bold">{label}</span>
      <kbd className="kbd-key">{shortcutLabel(shortcutKey)}</kbd>
    </button>
  );
}

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
    <KeyCap
      id={`key-${k.note}`}
      ariaLabel={k.note}
      isActive={isActive}
      label={k.label}
      shortcutKey={k.key}
      onPress={() => onNoteOn(k.note)}
      onRelease={() => onNoteOff(k.note)}
    />
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
      <div className="flex flex-1 w-full gap-0.5 justify-center-safe">
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
      <div className="flex flex-1 w-full gap-0.5 justify-center-safe">
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

// Chord-mode keyboard: one button row of diatonic triads, plus a melody zone,
// no chromatic/scale-locked note-by-note input at all. The triad row plays
// each scale degree's diatonic triad (no modifiers — sus/7th/inversions are
// out of scope), bound to HOME_ROW_KEYS. Degree count follows the active
// scale's own length (5 for pentatonics/Hirajoshi, 6 for Blues, 7 otherwise)
// — never hardcode 7.
export interface ChordKeyboardButton {
  key: string;
  label: string;
  notes: string[];
}

// Melody zone inside chord mode: nine keys playing single scale notes
// ascending from the tonic, in physical-keyboard order (home-row overflow
// first, then top-row overflow). Indices 0-3 sit to the right of the triad
// row (on the home row), 4-8 render on the top row, which otherwise has
// nothing on the left since the root row was removed. These key codes are
// indices 7-10 of HOME_ROW_KEYS and 7-11 of TOP_ROW_KEYS, so they never
// collide with the chord zone's degree buttons (at most indices 0-6).
export const MELODY_KEYS = [
  'KeyK',
  'KeyL',
  'Semicolon',
  'Quote',
  'KeyI',
  'KeyO',
  'KeyP',
  'BracketLeft',
  'BracketRight',
];

export function getChordKeyboardRows(
  root: string,
  scaleType: string,
  octaveOffset: number,
): {
  triadRow: ChordKeyboardButton[];
  melodyRow: ChordKeyboardButton[];
} {
  const scale = SCALES[scaleType] || SCALES['Major'];
  const degreeCount = scale.intervals.length;
  const triadOctave = 3 + octaveOffset;

  const triadRow: ChordKeyboardButton[] = [];

  for (let degree = 0; degree < degreeCount; degree++) {
    const { root: chordRoot, quality } = getDiatonicChordForDegree(
      degree,
      root,
      scaleType,
      false,
    );
    triadRow.push({
      key: HOME_ROW_KEYS[degree],
      label: formatChordLabel(chordRoot, quality),
      notes: generateBlockChordNotes(quality, chordRoot, triadOctave),
    });
  }

  // Melody notes ascend from the tonic starting at octave 4 + octaveOffset —
  // independent of triadOctave (which sits an octave lower, at 3 + octaveOffset)
  // — wrapping octaves at C (via scaleStepNote) so non-C roots keep ascending.
  const scaleNotes = getScaleNotes(root, scaleType);
  const scaleLength = scaleNotes.length;
  const rootChroma = rootSemitone(root);
  const scaleSemitones = scaleSemitonesFor(root, scaleNotes);
  const melodyTonicOctave = 4 + octaveOffset;
  const melodyTonicPitch = rootChroma + 12 * (melodyTonicOctave + 1);
  const melodyRow: ChordKeyboardButton[] = MELODY_KEYS.map((key, i) => {
    const note = scaleStepNote(melodyTonicPitch, scaleSemitones, scaleLength, i);
    return { key, label: note, notes: [note] };
  });

  return { triadRow, melodyRow };
}

// A single chord-row button presses/releases a fixed set of notes. The exact
// notes played are snapshotted in a ref at press time and released from that
// snapshot, never recomputed at release time — otherwise a key/scale/octave
// change while the button is held would release the wrong notes and leave
// voices hanging.
function ChordRowButton({
  btn,
  isActive,
  onNoteOn,
  onNoteOff,
}: {
  btn: ChordKeyboardButton;
  isActive: boolean;
  onNoteOn: (note: string) => void;
  onNoteOff: (note: string) => void;
}) {
  const heldNotesRef = useRef<string[] | null>(null);

  const press = () => {
    heldNotesRef.current = btn.notes;
    btn.notes.forEach(onNoteOn);
  };
  const release = () => {
    const held = heldNotesRef.current;
    if (!held) return;
    heldNotesRef.current = null;
    held.forEach(onNoteOff);
  };

  return (
    <KeyCap
      id={`chord-key-${btn.key}`}
      ariaLabel={btn.label}
      isActive={isActive}
      label={btn.label}
      shortcutKey={btn.key}
      onPress={press}
      onRelease={release}
    />
  );
}

// Two side-by-side groups: a labeled Chords group holding the diatonic triad
// row (bound to HOME_ROW_KEYS), and a Melody group holding all nine
// single-note buttons (bound to MELODY_KEYS) as two internal rows — the lower
// four (k l ; ') and the upper five (i o p [ ]) — preserving ascending pitch
// order left-to-right then upward, mirroring the physical keyboard.
export function ChordKeyboard({
  rows,
  activeNotes,
  onNoteOn,
  onNoteOff,
}: {
  rows: {
    triadRow: ChordKeyboardButton[];
    melodyRow: ChordKeyboardButton[];
  };
  activeNotes: Set<string>;
  onNoteOn: (note: string) => void;
  onNoteOff: (note: string) => void;
}) {
  const isRowActive = (btn: ChordKeyboardButton) =>
    btn.notes.every((n) => activeNotes.has(n));
  const topMelody = rows.melodyRow.slice(4);
  const homeMelody = rows.melodyRow.slice(0, 4);

  return (
    <div className="flex items-center justify-center gap-14">
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-base-content/50 font-semibold">
          Chords
        </span>
        <div className="flex gap-0.5 justify-center-safe">
          {rows.triadRow.map((btn) => (
            <ChordRowButton
              key={btn.key}
              btn={btn}
              isActive={isRowActive(btn)}
              onNoteOn={onNoteOn}
              onNoteOff={onNoteOff}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-0.5 justify-center-safe">
          {topMelody.map((btn) => (
            <ChordRowButton
              key={btn.key}
              btn={btn}
              isActive={isRowActive(btn)}
              onNoteOn={onNoteOn}
              onNoteOff={onNoteOff}
            />
          ))}
        </div>
        <div className="flex gap-0.5 justify-center-safe">
          {homeMelody.map((btn) => (
            <ChordRowButton
              key={btn.key}
              btn={btn}
              isActive={isRowActive(btn)}
              onNoteOn={onNoteOn}
              onNoteOff={onNoteOff}
            />
          ))}
        </div>
      </div>
    </div>
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
            <button
              type="button"
              key={k.note}
              id={`key-${k.note}`}
              aria-label={k.note}
              aria-pressed={isActive}
              onMouseDown={() => onNoteOn(k.note)}
              onMouseUp={() => onNoteOff(k.note)}
              onMouseLeave={() => isActive && onNoteOff(k.note)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onNoteOn(k.note);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onNoteOff(k.note);
                }
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                onNoteOn(k.note);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                onNoteOff(k.note);
              }}
              className={`absolute z-10 w-9 h-25 rounded-b-field border border-base-300 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all select-none ${
                isActive
                  ? "bg-primary text-primary-content shadow-lg shadow-primary/50 scale-[0.98]"
                  : "bg-key-black text-key-black-content hover:brightness-125"
              }`}
              style={{
                left: `${getBlackKeyLeftPx(noteIndex)}px`,
              }}
            >
              <span className="text-[9px] font-mono font-bold text-key-black-content">
                {k.label}
              </span>
              <kbd className="kbd-key">
                {shortcutLabel(k.key)}
              </kbd>
            </button>
          );
        }

        return (
          <button
            type="button"
            key={k.note}
            id={`key-${k.note}`}
            aria-label={k.note}
            aria-pressed={isActive}
            onMouseDown={() => onNoteOn(k.note)}
            onMouseUp={() => onNoteOff(k.note)}
            onMouseLeave={() => isActive && onNoteOff(k.note)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onNoteOn(k.note);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onNoteOff(k.note);
              }
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              onNoteOn(k.note);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              onNoteOff(k.note);
            }}
            className={`w-16 h-full rounded-b-field border border-base-300 mx-0.5 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all select-none ${
              isActive
                ? "bg-primary text-primary-content shadow-inner scale-[0.99]"
                : "bg-key-white text-key-white-content hover:brightness-105"
            }`}
          >
            <span className="text-[10px] font-mono font-bold">
              {k.label}
            </span>
            <kbd className="kbd-key">
              {shortcutLabel(k.key)}
            </kbd>
          </button>
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
