import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SimpleSynthPanel } from './SimpleSynthPanel';
import type { SynthParams } from '@/types';

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

  test('macro cards use card/card-body and badge components', () => {
    expect(html).toContain('card bg-base-200');
    expect(html).toContain('card-body');
    expect(html).toContain('badge badge-sm');
  });

  /**
   * Each macro is coloured by the Pro-Mode stage it actually writes to, so a
   * knob keeps its identity when the user switches modes. Tone→filterCutoff,
   * Space→release/sustain, Vibe→detune+lfoDepth, Punch→subOscVolume+attack.
   */
  test('every macro wears its Pro-Mode stage colour', () => {
    expect(html).toContain('text-module-filter');
    expect(html).toContain('text-module-env-vca');
    expect(html).toContain('text-module-lfo');
    expect(html).toContain('text-module-osc');
  });

  test('no macro borrows a daisyUI semantic role', () => {
    for (const semantic of [
      'text-primary',
      'text-secondary',
      'text-accent',
      'text-success',
      'badge-primary',
      'badge-secondary',
      'badge-accent',
      'badge-success',
    ]) {
      expect(html).not.toContain(semantic);
    }
  });

  test('arp controls are daisyUI join groups on the arp module token', () => {
    expect(html).toContain('join');
    expect(html).toContain('btn join-item');
    expect(html).toContain('--btn-color:var(--color-module-arp)');
    expect(html).toContain('--btn-fg:var(--color-module-arp-content)');
    expect(html).toContain('text-module-arp');
  });

  /**
   * Simple Mode edits the same four destinations as Pro Mode, and the panel
   * still has to say which — but it no longer says it five times. The macro
   * cards are compartments of SoundView's Synth section, which carries the
   * target tint for all of them (docs/design.md §6.5); repeating it per card
   * painted one fact five times inside one card.
   */
  test('the macro cards are recessed compartments, and none of them tints itself', () => {
    const cards = html.match(/class="[^"]*card bg-base-200[^"]*"/g) ?? [];
    expect(cards).toHaveLength(5);
    expect(html).not.toContain('bg-panel');
    expect(html).not.toContain('shadow-md');
    expect(html).not.toContain('tint-chord');
    expect(html).not.toContain('tint-bass');
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
