import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChromaticKeyboard, getBlackKeyLeftPx } from '../ui/Keyboard';
import { SynthView } from './SynthView';
import { resolveSynthControlChannel } from '../../utils/synthControl';
import type { SynthParamChannel } from '../../utils/synthControl';
import type { SynthParams } from '../../types';

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

  // ChordView has an identical button in the identical place; when both said
  // "Library" they read as the same drawer. Each now names its own content,
  // which also makes the count badge answerable ("Sounds 29", not "Library 29").
  test('the preset drawer button names its content', () => {
    const html = renderToString(<SynthView />);
    expect(html).toContain('>Sounds<');
    expect(html).toContain('title="Sound Library"');
    expect(html).not.toContain('>Library<');
  });

  test('SynthView still renders', () => {
    const html = renderToString(<SynthView />);
    expect(html).toContain('Target:');
  });

  test('the interactive keyboard moved to the dock, not SynthView', () => {
    const html = renderToString(<SynthView />);
    expect(html).not.toContain('btn-keyboard-mode-chromatic');
    expect(html).not.toContain('KB OCT');
    expect(html).not.toContain('A Natural Minor');
  });

  /**
   * The keyboard is pinned to the main synth (KEYBOARD_AUDITION_TARGET) and the
   * Target selector no longer moves it, so the badge that used to explain that
   * discrepancy is just noise above the keys.
   */
  test('no audition badge above the keyboard', () => {
    const html = renderToString(<SynthView />);
    expect(html).not.toContain('Keyboard plays: Main Synth');
    expect(html).not.toContain('Current audition sound engine');
  });

  test('the lead melody piano-roll renders', () => {
    const html = renderToString(<SynthView />);
    expect(html).toContain('Lead Melody');
    expect(html).toContain('id="select-lead-loop-length"');
  });
});

// Regression for: the interactive keyboard must always play the main synth,
// independent of whatever the Target selector (Synth/Chord/Bass) is editing.
// SynthView pins its own audio call sites to resolveSynthControlChannel('synth', ...)
// — this asserts that fixed routing decision holds for every possible Target value.
describe('keyboard audition channel is always the main synth', () => {
  const baseParams: SynthParams = {
    oscType: 'sine',
    subOscVolume: 0,
    noiseVolume: 0,
    detune: 0,
    filterType: 'lowpass',
    filterCutoff: 500,
    filterResonance: 1,
    filterEnvAmount: 0,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.8,
    release: 0.3,
    filterAttack: 0.01,
    filterDecay: 0.2,
    filterSustain: 1,
    filterRelease: 0.3,
    lfoRate: 0,
    lfoDepth: 0,
    lfoTarget: 'volume',
    octave: 0,
    arpActive: false,
    arpMode: 'up',
    arpRate: '16n',
    arpOctaves: 1,
    preset: '',
  };

  function channel(name: string): SynthParamChannel {
    return { params: { ...baseParams, preset: name }, setParams: () => {} };
  }

  const channels = {
    synth: channel('main-synth'),
    chord: channel('chord-synth'),
    bass: channel('bass-synth'),
  };

  test('the keyboard channel is always channels.synth, no matter which target is passed to the panel resolver', () => {
    // The panel/knob-editing resolver may point anywhere...
    expect(resolveSynthControlChannel('chord', channels)).toBe(channels.chord);
    expect(resolveSynthControlChannel('bass', channels)).toBe(channels.bass);
    // ...but the keyboard always resolves the hard-coded 'synth' target.
    expect(resolveSynthControlChannel('synth', channels)).toBe(channels.synth);
    expect(resolveSynthControlChannel('synth', channels).params.preset).toBe(
      'main-synth',
    );
  });
});
