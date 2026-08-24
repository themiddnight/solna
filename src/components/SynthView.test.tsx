import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChromaticKeyboard, getBlackKeyLeftPx } from './ui/Keyboard';
import { SynthView } from './SynthView';

// White key: w-16 (64px) + mx-0.5 (4px total) = 68px stride.
// Black key: w-9 = 36px wide, centered on the boundary between white keys.
const BLACK_KEY_STYLES = [
  'left:50px', // C#3
  'left:118px', // D#3
  'left:254px', // F#3
  'left:322px', // G#3
  'left:390px', // A#3
  'left:526px', // C#4
  'left:594px', // D#4
];

function blackKeyStyles(html: string): string[] {
  return [
    ...html.matchAll(/id="key-[A-G]#?[0-9]+"[^>]*style="([^"]*)"/g),
  ].map((m) => m[1]);
}

describe('chromatic keyboard black key geometry', () => {
  test('getBlackKeyLeftPx centers each black key on a white-key boundary', () => {
    expect(getBlackKeyLeftPx(1)).toBe(50); // C#3
    expect(getBlackKeyLeftPx(3)).toBe(118); // D#3
    expect(getBlackKeyLeftPx(6)).toBe(254); // F#3
    expect(getBlackKeyLeftPx(8)).toBe(322); // G#3
    expect(getBlackKeyLeftPx(10)).toBe(390); // A#3
    expect(getBlackKeyLeftPx(13)).toBe(526); // C#4
    expect(getBlackKeyLeftPx(15)).toBe(594); // D#4
  });

  test('black keys render at geometric positions over the white keys', () => {
    const html = renderToString(
      <ChromaticKeyboard
        octaveOffset={0}
        activeNotes={new Set()}
        onNoteOn={() => {}}
        onNoteOff={() => {}}
      />,
    );
    expect(blackKeyStyles(html)).toEqual(BLACK_KEY_STYLES);
  });

  test('black key positions are identical at any octave offset', () => {
    const at = (octaveOffset: number) =>
      blackKeyStyles(
        renderToString(
          <ChromaticKeyboard
            octaveOffset={octaveOffset}
            activeNotes={new Set()}
            onNoteOn={() => {}}
            onNoteOff={() => {}}
          />,
        ),
      );
    expect(at(-2)).toEqual(BLACK_KEY_STYLES);
    expect(at(2)).toEqual(BLACK_KEY_STYLES);
  });

  test('SynthView still renders', () => {
    const html = renderToString(<SynthView />);
    expect(html).toContain('Scale Locked');
  });
});
