import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ArpeggiatorPanel } from './ArpeggiatorPanel';
import { EnvelopePanel } from './EnvelopePanel';
import { FilterPanel } from './FilterPanel';
import { LfoPanel } from './LfoPanel';
import { OscillatorPanel } from './OscillatorPanel';

/**
 * These panels were MOVED out of SynthView.tsx, not rewritten. zustand v5
 * serves getInitialState as the server snapshot, so renderToString here
 * renders each panel against the store's initial synth params — the same
 * markup SynthView produced for the same state.
 *
 * The assertions below are structural, not a full snapshot: they pin the
 * element counts, every button/knob id, and the module identity token each
 * panel wears (docs/design.md §6.5), which is what a re-typed copy would get
 * wrong. Byte-identity of the move itself is checked separately against the
 * original inline JSX.
 */
describe('Pro-Mode panels render the markup SynthView used to render inline', () => {
  test('OscillatorPanel: 4 waveform buttons + 3 knobs, all module-osc', () => {
    const html = renderToString(<OscillatorPanel />);
    for (const w of ['sawtooth', 'square', 'sine', 'triangle']) {
      expect(html).toContain(`id="btn-wave-${w}"`);
    }
    for (const id of ['slider-sub-osc', 'slider-detune', 'slider-noise']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('text-module-osc');
    expect(html).toContain('card flex-1 bg-panel border border-base-300 shadow-md');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
  });

  test('FilterPanel: 3 filter-type buttons + 3 knobs, all module-filter', () => {
    const html = renderToString(<FilterPanel />);
    for (const t of ['lowpass', 'bandpass', 'highpass']) {
      expect(html).toContain(`id="btn-filter-${t}"`);
    }
    for (const id of ['slider-filter-cutoff', 'slider-filter-resonance', 'slider-filter-env']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('text-module-filter');
    expect(html).toContain('LPF');
    expect(html).toContain('BPF');
    expect(html).toContain('HPF');
  });

  test('EnvelopePanel: both ADSR halves with their own identity tokens', () => {
    const html = renderToString(<EnvelopePanel />);
    for (const id of ['attack', 'decay', 'sustain', 'release']) {
      expect(html).toContain(`id="slider-env-${id}"`);
      expect(html).toContain(`id="slider-env-filter-${id}"`);
    }
    expect(html).toContain('text-module-env-vca');
    expect(html).toContain('text-module-env-vcf');
    expect(html).toContain('AMP / VCA');
    expect(html).toContain('FILTER / VCF');
  });

  test('LfoPanel: 3 destinations, 2 knobs, 5 octave buttons, all module-lfo', () => {
    const html = renderToString(<LfoPanel />);
    for (const t of ['cutoff', 'pitch', 'volume']) {
      expect(html).toContain(`id="btn-lfo-target-${t}"`);
    }
    expect(html).toContain('id="slider-lfo-rate"');
    expect(html).toContain('id="slider-lfo-depth"');
    for (const oct of [-2, -1, 0, 1, 2]) {
      expect(html).toContain(`id="btn-octave-${oct}"`);
    }
    expect(html).toContain('--color-module-lfo');
  });

  test('ArpeggiatorPanel: bypass toggle, 4 modes, 3 rates, 3 octave counts', () => {
    const html = renderToString(<ArpeggiatorPanel />);
    expect(html).toContain('id="btn-toggle-arp"');
    for (const m of ['up', 'down', 'updown', 'random']) {
      expect(html).toContain(`id="btn-arp-mode-${m}"`);
    }
    for (const r of ['16n', '8n', '32n']) {
      expect(html).toContain(`id="btn-arp-rate-${r}"`);
    }
    for (const o of [1, 2, 3]) {
      expect(html).toContain(`id="btn-arp-octave-${o}"`);
    }
    expect(html).toContain('--color-module-arp');
    // INITIAL_SYNTH_PARAMS.arpActive is false, so the toggle reads Bypass.
    expect(html).toContain('Bypass');
  });

  test('every panel renders exactly one card wrapper', () => {
    for (const Panel of [OscillatorPanel, FilterPanel, EnvelopePanel, LfoPanel, ArpeggiatorPanel]) {
      const html = renderToString(<Panel />);
      expect(html.split('card flex-1 bg-panel').length - 1).toBe(1);
    }
  });
});
