import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChromaticKeyboard, ScaleLockedKey } from './Keyboard';

const noteOn = () => {};
const noteOff = () => {};

describe('Keyboard tokens and semantics', () => {
  const idle = renderToString(
    <ScaleLockedKey
      k={{ note: 'C3', label: 'C3', key: 'KeyQ', isBlack: false }}
      isActive={false}
      onNoteOn={noteOn}
      onNoteOff={noteOff}
    />,
  );
  const active = renderToString(
    <ScaleLockedKey
      k={{ note: 'C3', label: 'C3', key: 'KeyQ', isBlack: false }}
      isActive
      onNoteOn={noteOn}
      onNoteOff={noteOff}
    />,
  );

  test('scale-locked keys render as real buttons', () => {
    expect(idle).toContain('<button');
    expect(idle).toContain('type="button"');
    expect(idle).toContain('id="key-C3"');
  });

  test('an idle white key uses the dedicated piano-white token', () => {
    expect(idle).toContain('bg-key-white');
    expect(idle).toContain('text-key-white-content');
    expect(idle).not.toContain('slate');
    expect(idle).not.toContain('indigo');
  });

  test('an active key is primary amber', () => {
    expect(active).toContain('bg-primary');
    expect(active).toContain('text-primary-content');
    expect(active).not.toContain('indigo');
  });

  test('shortcut hints and borders use tokens', () => {
    expect(idle).toContain('text-primary');
    expect(idle).toContain('border-base-300');
  });

  test('the chromatic keyboard black keys use the piano-black token', () => {
    const html = renderToString(
      <ChromaticKeyboard
        octaveOffset={0}
        activeNotes={new Set<string>()}
        onNoteOn={noteOn}
        onNoteOff={noteOff}
      />,
    );
    expect(html).toContain('bg-key-black');
    expect(html).toContain('text-key-black-content');
    expect(html).toContain('bg-key-white');
    expect(html).toContain('<button');
    expect(html).not.toContain('slate');
    expect(html).not.toContain('indigo');
  });
});
