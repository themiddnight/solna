import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SimpleSynthPanel } from './SimpleSynthPanel';
import type { SynthParams } from '../types';

const params = {
  filterCutoff: 4000,
  release: 0.3,
  detune: 10,
  subOscVolume: 0.2,
  attack: 0.02,
  sustain: 0.5,
  arpActive: true,
  arpRate: '16n',
  arpMode: 'up',
} as unknown as SynthParams;

describe('SimpleSynthPanel theming', () => {
  const html = renderToString(<SimpleSynthPanel params={params} onChangeParams={() => {}} />);

  test('macro cards use card/card-body and semantic accents', () => {
    expect(html).toContain('card bg-base-100');
    expect(html).toContain('card-body');
    expect(html).toContain('text-primary');
    expect(html).toContain('text-accent');
    expect(html).toContain('text-secondary');
    expect(html).toContain('text-success');
    expect(html).toContain('badge badge-sm');
  });

  test('arp controls are daisyUI join groups on the accent token', () => {
    expect(html).toContain('join');
    expect(html).toContain('btn join-item');
    expect(html).toContain('btn-accent');
    expect(html).toContain('text-accent-content');
  });

  test('no dark: variants survive — they key off the OS, not data-theme', () => {
    expect(html).not.toContain('dark:');
  });

  test('no raw palette colours or absolute white survive', () => {
    for (const legacy of ['amber-', 'cyan-', 'pink-', 'emerald-', 'purple-', 'text-white']) {
      expect(html).not.toContain(legacy);
    }
  });
});
