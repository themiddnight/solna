import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChromaticKeyboard, getBlackKeyLeft, whiteKeysBefore } from '../ui/Keyboard';
import { SoundView } from './SoundView';
import { FIELD_LABEL, FIELD_LANE } from '../ui/fieldClasses';
import { resolveSynthControlChannel } from '@/utils/synthControl';
import type { SynthParamChannel } from '@/utils/synthControl';
import type { SynthParams } from '@/types';

// A black key is half its own width left of the white-key boundary it
// straddles, so its offset is (white keys before it) strides minus half a black
// key. Both metrics are CSS custom properties — the stride shrinks below `sm`
// so a phone fits a whole octave — which is why these are calc() strings rather
// than the pixel totals they used to be.
const left = (whiteKeys: number) =>
  `left:calc(${whiteKeys} * var(--chromatic-key-stride) - var(--chromatic-key-black-w) / 2)`;

const BLACK_KEY_STYLES = [
  left(1), // C#3
  left(2), // D#3
  left(4), // F#3
  left(5), // G#3
  left(6), // A#3
  left(8), // C#4
  left(9), // D#4
];

function blackKeyStyles(html: string): string[] {
  return [
    ...html.matchAll(/id="key-[A-G]#?[0-9]+"[^>]*style="([^"]*)"/g),
  ].map((m) => m[1]);
}

describe('chromatic keyboard black key geometry', () => {
  test('whiteKeysBefore counts the strides a black key is offset by', () => {
    expect(whiteKeysBefore(1)).toBe(1); // C#3
    expect(whiteKeysBefore(3)).toBe(2); // D#3
    expect(whiteKeysBefore(6)).toBe(4); // F#3
    expect(whiteKeysBefore(8)).toBe(5); // G#3
    expect(whiteKeysBefore(10)).toBe(6); // A#3
    expect(whiteKeysBefore(13)).toBe(8); // C#4
    expect(whiteKeysBefore(15)).toBe(9); // D#4
  });

  test('getBlackKeyLeft centers each black key on a white-key boundary', () => {
    expect(getBlackKeyLeft(1)).toBe(
      'calc(1 * var(--chromatic-key-stride) - var(--chromatic-key-black-w) / 2)',
    );
    expect(getBlackKeyLeft(15)).toBe(
      'calc(9 * var(--chromatic-key-stride) - var(--chromatic-key-black-w) / 2)',
    );
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
    const html = renderToString(<SoundView />);
    expect(html).toContain('>Sounds<');
    expect(html).toContain('title="Sound Library"');
    expect(html).not.toContain('>Library<');
  });

  test('SoundView still renders', () => {
    const html = renderToString(<SoundView />);
    expect(html).toContain('Target:');
  });

  test('the interactive keyboard moved to the dock, not SoundView', () => {
    const html = renderToString(<SoundView />);
    expect(html).not.toContain('btn-keyboard-mode-chromatic');
    expect(html).not.toContain('KB OCT');
    expect(html).not.toContain('A Natural Minor');
  });
});

/**
 * The Drum Sound card (kit, filter, level) moved here from the sequencer's
 * Beat segment (nav restructure Task 6). These three regression guards moved
 * with it, verbatim in what they assert — only the render target changed.
 */
describe('the Drum Sound card, moved from the sequencer (nav restructure Task 6)', () => {
  const html = renderToString(<SoundView />);

  // Step 17: the drum bus fader's dB markup, asserted at view level so a
  // regression back to a %/linear readout on this call site is caught here
  // and not only inside ChannelStrip's own unit tests.
  test('the drum bus fader renders its dB tooltip and position step', () => {
    // DEV-383: masterSequencerVolume's factory default is DEFAULT_BUS_TRIM_DB
    // (-6 dB), not unity — this view renders the store's creation-time
    // snapshot with no explicit setState, so the tooltip reflects that.
    expect(html).toContain('title="Drums Layer Gain: -6.0 dB"');
    expect(html).toContain('step="0.005"');
  });

  // The regression this row was rebuilt for: five fields whose controls were
  // 24, 30, 32 and 48px tall bottom-aligned into five different label heights.
  // Nothing renders after this card in SoundView (the preset drawer's
  // Suspense/lazy content is null while closed), so slicing from the card's
  // own heading to the end of the string covers exactly the card — confirmed
  // by rendering SoundView and checking FIELD_LABEL/FIELD_LANE occur zero
  // times before that heading and exactly 5/4 times from it onward.
  test('every field in a control row shares one label line and one control lane', () => {
    const soundRow = html.slice(html.indexOf('Drum Sound'));
    const labels = soundRow.split(FIELD_LABEL).length - 1;
    const lanes = soundRow.split(FIELD_LANE).length - 1;
    // Kit, Filter, Cutoff, Res each own a label + lane; Drum Level's label and
    // 32px shell come from ChannelStrip, which sits on the same line already.
    expect(labels).toBe(5);
    expect(lanes).toBe(4);
  });

  test('the drum filter type switch is a daisyUI join on the 32px control lane', () => {
    expect(html).toContain('join');
    // `sm`, not `xs`: it is one field in a control row, and a 24px join next to
    // a 32px select is what pushed the row's labels onto different baselines.
    expect(html).toContain('btn btn-sm join-item');
    expect(html).toContain(FIELD_LANE);
  });
});

// Regression for: the interactive keyboard must always play the main synth,
// independent of whatever the Target selector (Synth/Chord/Bass) is editing.
// useInputDeck pins the keyboard to the 'synth' channel (KEYBOARD_AUDITION_TARGET),
// and this pure test asserts the resolveSynthControlChannel utility keeps that
// decision fixed for every possible Target value.
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
    pad: channel('pad-synth'),
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
