import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChordPresetLibrary } from './ChordPresetLibrary';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';

const noop = () => {};

const html = renderToString(
  <ChordPresetLibrary
    isOpen
    onClose={noop}
    currentChords={[
      { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
    ]}
    scaleRoot="C"
    scaleType="major"
    autoReharmonize
    synthParams={INITIAL_SYNTH_PARAMS}
    onApplyChords={noop}
  />
);

describe('ChordPresetLibrary theming', () => {
  test('template and custom cards are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-base-200 border border-base-300');
    expect(html).toContain('hover:border-primary/50');
    // The custom card's hover:border-secondary/50 cannot be asserted here:
    // under renderToString, zustand's useStore takes getInitialState() as the
    // React server snapshot, which is frozen at store creation, and the custom
    // card renders only from customChordProgressions, which starts empty in
    // tests. The guard's source-level scan still enforces its tokens.
  });

  test('tags are daisyUI badges with a valid padding step', () => {
    expect(html).toContain('badge badge-sm');
    expect(html).not.toContain('py-0.2');
  });

  test('card actions are daisyUI buttons', () => {
    expect(html).toContain('btn btn-xs btn-ghost');
    expect(html).toContain('btn btn-xs btn-primary');
    // hover:btn-error (the custom-card delete button) is unreachable under
    // renderToString for the same frozen-server-snapshot reason as above.
  });

  test('the footer sits on base tokens', () => {
    expect(html).toContain('border-t border-base-300 bg-base-200');
    expect(html).toContain('btn btn-sm btn-ghost');
  });

  test('no legacy hex or palette utilities survive', () => {
    for (const s of [
      '#0B0D19',
      '#252B48',
      '#2D355A',
      '#171B36',
      '#20264A',
      '#1C213E',
      '#0E1022',
      '#1A1F3B',
      'indigo-',
      'purple-',
      'red-',
      'slate-',
      'text-white',
    ]) {
      expect(html).not.toContain(s);
    }
  });
});
