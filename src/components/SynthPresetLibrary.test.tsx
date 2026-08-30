import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SynthPresetLibrary } from './SynthPresetLibrary';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';

const noop = () => {};

const html = renderToString(
  <SynthPresetLibrary
    isOpen
    onClose={noop}
    currentParams={INITIAL_SYNTH_PARAMS}
    target="synth"
    onSelectPreset={noop}
  />
);

describe('SynthPresetLibrary theming', () => {
  test('preset cards sit on base tokens', () => {
    expect(html).toContain('bg-base-200');
    expect(html).toContain('border-base-300');
    expect(html).toContain('hover:border-primary/50');
  });

  test('category badges come through as complete daisyUI badges', () => {
    expect(html).toContain('badge badge-primary');
    expect(html).toContain('badge badge-accent');
  });

  test('sound attribute chips are ghost mono badges', () => {
    expect(html).toContain('badge badge-sm badge-ghost font-mono');
    expect(html).not.toContain('py-0.2');
  });

  test('card actions and footer use daisyUI buttons', () => {
    expect(html).toContain('btn btn-xs btn-ghost');
    expect(html).toContain('btn btn-sm btn-ghost');
    expect(html).toContain('border-t border-base-300 bg-base-200');
  });

  test('the preset card exposes a real button, not a clickable div', () => {
    expect(html).toContain('<button');
    expect(html).toContain('card');
  });

  test('no legacy hex or palette utilities survive', () => {
    for (const s of [
      '#0B0D19',
      '#252B48',
      '#12152A',
      '#161B36',
      '#1E2344',
      '#1A1F3A',
      '#0E1022',
      '#151933',
      'indigo-',
      'pink-',
      'slate-',
      'red-',
      'text-white',
    ]) {
      expect(html).not.toContain(s);
    }
  });
});

/**
 * Selecting a preset rewrites whichever destination the Target selector points
 * at, and that selector sits behind this overlay — so the drawer has to name the
 * target itself, in the same module colour the panel cards are tinted with.
 */
describe('SynthPresetLibrary edit target', () => {
  const renderFor = (target: 'synth' | 'chord' | 'bass') =>
    renderToString(
      <SynthPresetLibrary
        isOpen
        onClose={noop}
        currentParams={INITIAL_SYNTH_PARAMS}
        target={target}
        onSelectPreset={noop}
      />
    );

  test('the header names the destination being edited', () => {
    expect(renderFor('synth')).toContain('Editing: Lead');
    expect(renderFor('chord')).toContain('Editing: Chord');
    expect(renderFor('bass')).toContain('Editing: Bass');
  });

  test('the chord and bass targets carry their module colour', () => {
    expect(renderFor('chord')).toContain('--badge-color:var(--color-module-chord)');
    expect(renderFor('bass')).toContain('--badge-color:var(--color-module-bass)');
  });

  test('the main synth target stays neutral — it is the default, not an accent', () => {
    const synth = renderFor('synth');
    expect(synth).not.toContain('--badge-color:var(--color-module-chord)');
    expect(synth).not.toContain('--badge-color:var(--color-module-bass)');
    expect(synth).not.toContain('tint-chord');
    expect(synth).not.toContain('tint-bass');
  });

  test('the drawer panel itself wears the target tint', () => {
    expect(renderFor('chord')).toContain('tint-chord');
    expect(renderFor('bass')).toContain('tint-bass');
  });
});

/**
 * Simple Mode hides the oscillator and filter stages from the panel entirely, so
 * repeating their values on every drawer entry names controls the user cannot
 * see. Pro Mode still shows them — that is where those stages live.
 */
describe('SynthPresetLibrary sound badges', () => {
  const renderWithBadges = (showSoundBadges: boolean) =>
    renderToString(
      <SynthPresetLibrary
        isOpen
        onClose={noop}
        currentParams={INITIAL_SYNTH_PARAMS}
        target="synth"
        showSoundBadges={showSoundBadges}
        onSelectPreset={noop}
      />
    );

  test('Pro Mode keeps the oscillator and filter readouts', () => {
    const pro = renderWithBadges(true);
    expect(pro).toContain('badge badge-sm badge-ghost font-mono');
    expect(pro).toContain('sawtooth');
    expect(pro).toContain('LPF');
  });

  test('Simple Mode drops them from every entry', () => {
    const simple = renderWithBadges(false);
    expect(simple).not.toContain('badge badge-sm badge-ghost font-mono');
    expect(simple).not.toContain('LPF');
    expect(simple).not.toContain('HPF');
    expect(simple).not.toContain('BPF');
  });

  test('names, categories and the Active badge survive either way', () => {
    for (const html of [renderWithBadges(true), renderWithBadges(false)]) {
      expect(html).toContain('badge badge-xs badge-primary');
      expect(html).toContain('data-entry-id=');
    }
  });
});

describe('SynthPresetLibrary open-scroll anchor', () => {
  test('every entry is addressable by id so the open scroll can find the active one', () => {
    expect(html).toContain('data-entry-id=');
    // The default patch is the one INITIAL_SYNTH_PARAMS names, so its own card
    // must carry an anchor — an Active badge with nothing to scroll to is the
    // exact failure this guards.
    expect(html).toContain('badge badge-xs badge-primary');
  });
});
