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
