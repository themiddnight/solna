import { describe, expect, test } from 'bun:test';
import { isValidElement } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Knob } from '@/components/ui/Knob';
import { SubtractiveProPanel } from './SubtractiveProPanel';
import { VoicePanel } from './VoicePanel';
import { ArpeggiatorPanel } from './ArpeggiatorPanel';
import { defaultTrackArp, defaultTrackSynth } from '@/store/initialState';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { SYNTH_GAIN_FLOOR_DB } from '@/utils/synthPatch';
import { DEFAULT_PARKED_RATE, switchLfoRateMode } from './LfoPanel';
import type { SynthChannel } from '@/utils/synthControl';
import type { ActiveSynth, ArpSettings } from '@/types/synth';

/**
 * The approved Pro surface (prototype Variant A,
 * docs/superpowers/prototypes/2026-09-14-synth-lab-approved-ui.html) rendered
 * over the engine-discriminated patch.
 *
 * Two kinds of assertion live here and they are deliberately different tools:
 *
 * - MARKUP: `renderToString(<SubtractiveProPanel channel={…} />)`, which pins
 *   what a reader sees — every module, every control id, the icon buttons'
 *   accessible names and their pressed state.
 * - WRITES: the panels are pure `props -> JSX` functions with no hooks, so a
 *   test can CALL one and walk the element tree it returns, then invoke the
 *   real handler. That is what makes "Spread writes unisonDetuneCents" and
 *   "Arp writes the Arp object and never the patch" testable at all — this
 *   repo has no DOM in tests, and asserting on a mock instead of the handler
 *   would pin the mock.
 */

/** A channel plus the writes it recorded, so a handler's effect is inspectable. */
interface RecordingChannel extends SynthChannel {
  patches: ActiveSynth[];
  arps: ArpSettings[];
}

function makeChannel(overrides: Partial<SynthChannel> = {}): RecordingChannel {
  const patches: ActiveSynth[] = [];
  const arps: ArpSettings[] = [];
  return {
    activeSynth: defaultTrackSynth('synth'),
    arpSettings: defaultTrackArp('synth'),
    setActiveSynth: (next) => void patches.push(next),
    setArpSettings: (next) => void arps.push(next),
    patches,
    arps,
    ...overrides,
  };
}

/**
 * Every element in a tree, including ones passed through props rather than
 * `children` (`ModuleHeader`'s `right` slot is a prop).
 *
 * Function components are EXPANDED by calling them, which is what lets a test
 * reach the real `<button onClick>` a `ToggleRow` builds. `Knob` is the one
 * stop: it holds a `useRef`, and calling a hook outside a renderer throws. Its
 * own element carries `id` and `onChange`, so there is nothing inside it a
 * write test needs.
 */
function* elementsIn(node: unknown): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elementsIn(child);
    return;
  }
  if (!isValidElement(node)) return;
  yield node;
  if (typeof node.type === 'function' && node.type !== Knob) {
    const render = node.type as (props: unknown) => unknown;
    yield* elementsIn(render(node.props));
    return;
  }
  for (const value of Object.values(node.props as Record<string, unknown>)) {
    yield* elementsIn(value);
  }
}

/**
 * The element carrying `id`. A component and the host element it renders share
 * one id (`ToggleButton` passes its own through), so the HOST wins — that is
 * the one carrying the handler a user would actually fire.
 */
function byId(tree: unknown, id: string): ReactElement {
  const found = [...elementsIn(tree)].filter(
    (el) => (el.props as { id?: string }).id === id,
  );
  const hosts = found.filter((el) => typeof el.type === 'string');
  const chosen = hosts.length > 0 ? hosts : found;
  if (chosen.length !== 1) {
    throw new Error(`expected exactly one element with id "${id}", found ${chosen.length}`);
  }
  return chosen[0];
}

/**
 * The opening tag carrying `id`. React emits attributes in source order, so an
 * assertion that two of them are adjacent pins the JSX's property order rather
 * than the markup's meaning — this reads the whole tag instead.
 */
function tagWithId(html: string, id: string): string {
  const idx = html.indexOf(`id="${id}"`);
  if (idx === -1) throw new Error(`no element with id "${id}"`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

/** Every `id="…"` in a rendered string, in document order. */
function renderedIds(html: string): string[] {
  return [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
}


/** Every `<button>` in a rendered string, as its accessible name + visible text. */
function buttonNames(html: string): { name: string; text: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map((m) => ({
    name: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    text: m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  }));
}

/** Every accessible name in a rendered string, in document order. */
function ariaLabels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
}

const proMarkup = (channel: SynthChannel) =>
  renderToString(<SubtractiveProPanel channel={channel} />);

describe('SubtractiveProPanel renders every approved Variant A module', () => {
  test('the eight module headings', () => {
    const html = proMarkup(makeChannel());
    expect(html).toContain('Oscillators');
    expect(html).toContain('Sub &amp; Noise');
    expect(html).toContain('Filter + drive');
    expect(html).toContain('ENV 1');
    expect(html).toContain('ENV 2');
    expect(html).toContain('LFO');
    expect(html).toContain('Voice');
    expect(html).toContain('Arpeggiator');
  });

  /**
   * The chain is stated by the ORDER the modules sit in and by their own
   * headings. The caption row that named the same four stages a second time is
   * gone, and so is the rack's own ground: each module already draws a recessed
   * card, so a surface around them framed a frame and inset the whole rack from
   * the section card holding it — both cost vertical space on the densest
   * surface in the app and bought nothing.
   *
   * Matched on the caption DETAILS, not on the stage words: 'VOICE' and
   * 'SOURCE' appear inside module headings and aria-labels, so asserting those
   * absent would fail on markup that is not the ribbon.
   */
  test('no flow-ribbon caption and no ground of its own', () => {
    const html = proMarkup(makeChannel());
    for (const caption of [
      'OSC 1 + OSC 2 + SUB + NOISE',
      'DRIVE + FILTER',
      'ENV + LFO',
      'AMP + UNISON',
    ]) {
      expect(html).not.toContain(caption);
    }
    expect(html).not.toContain('bg-base-300/40');
  });

  test('OSC 1 and OSC 2 are distinct inset units with their own four controls', () => {
    const html = proMarkup(makeChannel());
    expect(html).toContain('OSC 1');
    expect(html).toContain('OSC 2');
    for (const osc of ['osc1', 'osc2']) {
      for (const control of ['octave', 'semitone', 'fine', 'level']) {
        expect(html).toContain(`id="slider-${osc}-${control}"`);
      }
      expect(html).toContain(`id="btn-${osc}-enabled"`);
    }
  });

  test('the utility module splits sub and noise, and noise type is a select', () => {
    const html = proMarkup(makeChannel());
    expect(html).toContain('SUB OSC');
    expect(html).toContain('NOISE');
    expect(html).toContain('id="btn-sub-octave-minus1"');
    expect(html).toContain('id="btn-sub-octave-minus2"');
    expect(html).toContain('id="slider-sub-level"');
    expect(html).toContain('id="slider-noise-level"');
    // A four-way segmented row of noise colours overflowed the utility column
    // at the narrow breakpoint; a select never does.
    expect(html).toContain('id="select-noise-color"');
    expect(html).not.toContain('id="btn-noise-color-white"');
  });

  test('the filter module carries all four types and four knobs', () => {
    const html = proMarkup(makeChannel());
    for (const type of ['lowpass', 'bandpass', 'highpass', 'notch']) {
      expect(html).toContain(`id="btn-filter-${type}"`);
    }
    for (const control of ['cutoff', 'resonance', 'drive', 'keytrack']) {
      expect(html).toContain(`id="slider-filter-${control}"`);
    }
  });

});

describe('SubtractiveProPanel renders every approved modulation module', () => {
  test('ENV 1 is the amp envelope and its destination is read-only Amplitude', () => {
    const html = proMarkup(makeChannel());
    for (const stage of ['attack', 'decay', 'sustain', 'release']) {
      expect(html).toContain(`id="slider-env1-${stage}"`);
    }
    const destination = html.slice(html.indexOf('id="env1-destination"'));
    expect(destination).toContain('Amplitude');
    // Read-only means there is nothing to operate: no select, no button, no
    // route row. ENV1's wiring is a fact of the engine, not a choice.
    expect(html).not.toContain('id="select-env1-destination"');
    expect(html).not.toContain('id="btn-env1-destination"');
  });

  test('ENV 2 renders exactly two target/amount rows', () => {
    const html = proMarkup(makeChannel());
    for (const stage of ['attack', 'decay', 'sustain', 'release']) {
      expect(html).toContain(`id="slider-env2-${stage}"`);
    }
    // Two slots, always — `env2Routes` is capped at two by the validator, and
    // an empty slot is an assignable row reading Off rather than a missing one.
    const targets = renderedIds(html).filter((id) => /^select-env2-route-\d+-target$/.test(id));
    expect(targets).toEqual(['select-env2-route-0-target', 'select-env2-route-1-target']);
  });

  test('an assigned ENV 2 slot gains an amount knob in the route\'s own unit', () => {
    const channel = makeChannel();
    const patch = channel.activeSynth.patch;
    const html = proMarkup({
      ...channel,
      activeSynth: {
        ...channel.activeSynth,
        patch: {
          ...patch,
          synth: {
            ...patch.synth,
            env2Routes: [
              { target: 'filter-cutoff', unit: 'semitones', amount: 24 },
              { target: 'osc2-level', unit: 'db', amount: -12 },
            ],
          },
        },
      },
    });
    const amounts = renderedIds(html).filter((id) => /^slider-env2-route-\d+-amount$/.test(id));
    expect(amounts).toEqual(['slider-env2-route-0-amount', 'slider-env2-route-1-amount']);
    expect(tagWithId(html, 'slider-env2-route-0-amount')).toContain('aria-valuetext="+24 st"');
    expect(tagWithId(html, 'slider-env2-route-1-amount')).toContain('aria-valuetext="-12 dB"');
  });

  test('the LFO renders Hz/Sync, Transport/Note, waveform, phase, depth and ONE route', () => {
    const html = proMarkup(makeChannel());
    expect(html).toContain('id="btn-lfo-rate-mode-hz"');
    expect(html).toContain('id="btn-lfo-rate-mode-sync"');
    expect(html).toContain('id="btn-lfo-trigger-transport"');
    expect(html).toContain('id="btn-lfo-trigger-note"');
    for (const wave of ['sine', 'triangle', 'sawtooth', 'square', 'sample-and-hold']) {
      expect(html).toContain(`id="btn-lfo-wave-${wave}"`);
    }
    expect(html).toContain('id="slider-lfo-phase"');
    expect(html).toContain('id="slider-lfo-depth"');
    const targets = renderedIds(html).filter((id) => id.startsWith('select-lfo-route'));
    expect(targets).toEqual(['select-lfo-route-target']);
  });

  test('the Voice module is Mono/Poly, Unison, Spread, Glide and Width — and no Drift', () => {
    const html = proMarkup(makeChannel());
    expect(html).toContain('id="btn-voice-mode-mono"');
    expect(html).toContain('id="btn-voice-mode-poly"');
    for (const control of ['unison', 'spread', 'glide', 'width']) {
      expect(html).toContain(`id="slider-voice-${control}"`);
    }
    // The prototype draws a Drift knob. `CommonVoiceParams` has no analog-drift
    // parameter and this change deliberately does not add one, so nothing may
    // render a control that writes nowhere.
    expect(html).not.toContain('Drift');
    expect(html).not.toContain('drift');
  });

  test('the Arp strip reads the Arp object, not the patch', () => {
    const html = proMarkup(
      makeChannel({ arpSettings: { active: true, mode: 'down', rate: '8n', octaves: 3 } }),
    );
    expect(html).toContain('id="btn-toggle-arp"');
    expect(html).toContain('id="btn-arp-mode-down"');
    expect(html).toContain('id="btn-arp-rate-8n"');
    expect(html).toContain('id="slider-arp-octaves"');
    expect(tagWithId(html, 'btn-arp-mode-down')).toContain('aria-pressed="true"');
    expect(tagWithId(html, 'btn-arp-mode-up')).toContain('aria-pressed="false"');
    expect(tagWithId(html, 'btn-arp-rate-8n')).toContain('aria-pressed="true"');
  });
});

describe('icons carry full accessible names and pressed state', () => {
  test('the four oscillator waveforms are named in full on both units', () => {
    const html = proMarkup(makeChannel());
    // Scoped to module 1: the LFO's row shares the same four names (plus
    // sample-and-hold), so an unscoped count would pass with one unit missing.
    //
    // Both ends are asserted BEFORE the slice. `indexOf` answers -1 for a
    // heading that has been renamed, and `slice(a, -1)` is not an error — it
    // is the rest of the panel minus one character, so the scope silently
    // widens to include the LFO and only the sample-and-hold line below
    // notices. That is how a module rename reached this test as a confusing
    // failure in an unrelated assertion.
    const start = html.indexOf('>Oscillators<');
    const end = html.indexOf('>Sub &amp; Noise<');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const oscillators = html.slice(start, end);
    for (const name of ['Sawtooth', 'Square', 'Triangle', 'Sine']) {
      for (const unit of ['OSC 1', 'OSC 2']) {
        expect(oscillators).toContain(`aria-label="${unit} ${name}"`);
      }
    }
    expect(oscillators).not.toContain('Sample and hold');
  });

  test('the four filter types are named in full, with their short codes visible', () => {
    const html = proMarkup(makeChannel());
    // The code comes FIRST in the name and the words explain it — a name that
    // replaced "LP" with "Low-pass filter" would be unsayable by a speech-input
    // user reading the button (WCAG 2.5.3).
    for (const name of ['LP, low-pass filter', 'BP, band-pass filter', 'HP, high-pass filter', 'Notch filter']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    for (const code of ['LP', 'BP', 'HP', 'Notch']) {
      expect(html).toContain(`>${code}<`);
    }
  });

  test('a selected icon button is the only pressed one in its group', () => {
    const channel = makeChannel();
    const html = proMarkup(channel);
    const filter = channel.activeSynth.patch.synth.filter.type;
    for (const type of ['lowpass', 'bandpass', 'highpass', 'notch']) {
      expect(tagWithId(html, `btn-filter-${type}`)).toContain(
        `aria-pressed="${type === filter}"`,
      );
    }
    // Every waveform/filter button is a toggle, so each one states its state.
    expect(html).toContain('aria-pressed="false"');
  });

  test('every control id in the panel is unique, and every knob is labelled', () => {
    // Read off the MARKUP rather than the element tree: `LfoPanel` holds the
    // parked-rate `useState` now, and calling a component with a hook outside a
    // renderer throws. The markup is also what a browser actually exposes.
    const html = proMarkup(makeChannel());
    const ids = renderedIds(html);
    expect(new Set(ids).size).toBe(ids.length);

    const knobs = [...html.matchAll(/<svg[^>]*id="(slider-[^"]+)"[^>]*>/g)].map((m) => m[0]);
    expect(knobs.length).toBeGreaterThan(20);
    for (const knob of knobs) {
      expect(knob).toContain('role="slider"');
      expect(/aria-label="[^"]+"/.test(knob)).toBe(true);
    }
  });
});

describe('the panels write complete patches, and Arp writes only Arp', () => {
  test('Spread writes unisonDetuneCents and Width writes stereoWidth', () => {
    const channel = makeChannel();
    const patch = channel.activeSynth.patch;
    const written: (typeof patch)[] = [];
    const tree = VoicePanel({ patch, onPatch: (next) => void written.push(next) });

    (byId(tree, 'slider-voice-spread').props as { onChange: (v: number) => void }).onChange(37);
    expect(written[0].common.unisonDetuneCents).toBe(37);
    expect(written[0].common.stereoWidth).toBe(patch.common.stereoWidth);

    (byId(tree, 'slider-voice-width').props as { onChange: (v: number) => void }).onChange(0.75);
    expect(written[1].common.stereoWidth).toBe(0.75);
    expect(written[1].common.unisonDetuneCents).toBe(patch.common.unisonDetuneCents);

    // A complete, immutable patch: the synth half is untouched and the source
    // object is not mutated.
    expect(written[1].synth).toBe(patch.synth);
    expect(patch.common.stereoWidth).not.toBe(0.75);
  });

  test('Mono/Poly writes voiceMode and nothing else', () => {
    const channel = makeChannel();
    const patch = channel.activeSynth.patch;
    const written: (typeof patch)[] = [];
    const tree = VoicePanel({ patch, onPatch: (next) => void written.push(next) });

    (byId(tree, 'btn-voice-mode-mono').props as { onClick: () => void }).onClick();
    expect(written[0].common.voiceMode).toBe('mono');
    expect({ ...written[0].common, voiceMode: patch.common.voiceMode }).toEqual(patch.common);
  });

  test('the Arp panel has no patch writer at all — it writes ArpSettings', () => {
    const arp: ArpSettings = { active: false, mode: 'up', rate: '16n', octaves: 1 };
    const written: ArpSettings[] = [];
    const tree = ArpeggiatorPanel({ arp, onArp: (next) => void written.push(next) });

    (byId(tree, 'btn-toggle-arp').props as { onClick: () => void }).onClick();
    expect(written[0]).toEqual({ ...arp, active: true });

    (byId(tree, 'btn-arp-mode-random').props as { onClick: () => void }).onClick();
    expect(written[1]).toEqual({ ...arp, mode: 'random' });

    (byId(tree, 'slider-arp-octaves').props as { onChange: (v: number) => void }).onChange(3);
    expect(written[2]).toEqual({ ...arp, octaves: 3 });
  });

  test('the whole Pro panel routes patch writes to setActiveSynth only', () => {
    const channel = makeChannel();
    renderToString(<SubtractiveProPanel channel={channel} />);
    expect(channel.patches).toEqual([]);
    expect(channel.arps).toEqual([]);
  });
});

describe('the accessible names hold up on their own', () => {
  test("every button's name contains the text printed on it (WCAG 2.5.3)", () => {
    const buttons = buttonNames(proMarkup(makeChannel()));
    expect(buttons.length).toBeGreaterThan(30);
    for (const { name, text } of buttons) {
      expect(name).not.toBe('');
      // An icon-only button has no visible text to contain, so its name is
      // free to be the full word. Everything else must be sayable: a control
      // reading "1/16" whose name is only "Sixteenth notes" cannot be operated
      // by speech input.
      if (text !== '') {
        expect(name.toLowerCase()).toContain(text.toLowerCase());
      }
    }
  });

  test('no two controls on the panel share an accessible name', () => {
    const labels = ariaLabels(proMarkup(makeChannel()));
    const seen = new Map<string, number>();
    for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  test('the repeated captions are qualified by the module that owns them', () => {
    const html = proMarkup(makeChannel());
    // Four labels are printed twice on this panel and three more three times;
    // the caption stays short and the NAME says which module it belongs to.
    for (const name of ['OSC 1 Oct', 'OSC 2 Oct', 'OSC 1 Level', 'OSC 2 Level']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    for (const name of ['ENV 1 Attack', 'ENV 2 Attack', 'LFO Depth']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).not.toContain('aria-label="Amount"');
  });
});

describe('a level knob reaches the floor its patch can hold', () => {
  // `SUBTRACTIVE_INIT` is the Init Saw factory preset, and like 50 others it
  // parks its silent sources at SYNTH_GAIN_FLOOR_DB. A knob whose `min` was a
  // comfortable -60 reported `aria-valuenow="-96"` under `aria-valuemin="-60"`
  // — an invalid ARIA state — pinned its needle, and jumped the value up on
  // the first drag with no way back down. The store defaults every other test
  // renders are all in range, which is why only a factory patch catches it.
  const channel = { ...makeChannel(), activeSynth: SUBTRACTIVE_INIT };

  test('every level knob declares the patch floor as its minimum', () => {
    const html = proMarkup(channel);
    for (const id of ['slider-osc1-level', 'slider-osc2-level', 'slider-sub-level', 'slider-noise-level']) {
      expect(tagWithId(html, id)).toContain(`aria-valuemin="${SYNTH_GAIN_FLOOR_DB}"`);
    }
  });

  test('a preset parked at the floor renders a valid, reachable value', () => {
    const html = proMarkup(channel);
    expect(SUBTRACTIVE_INIT.patch.synth.utility.subLevelDb).toBe(SYNTH_GAIN_FLOOR_DB);
    for (const id of ['slider-osc2-level', 'slider-sub-level', 'slider-noise-level']) {
      const tag = tagWithId(html, id);
      expect(tag).toContain(`aria-valuenow="${SYNTH_GAIN_FLOOR_DB}"`);
      const min = Number(/aria-valuemin="(-?\d+(?:\.\d+)?)"/.exec(tag)![1]);
      const now = Number(/aria-valuenow="(-?\d+(?:\.\d+)?)"/.exec(tag)![1]);
      expect(now).toBeGreaterThanOrEqual(min);
    }
  });
});

describe('the LFO clock switch is reversible', () => {
  test('flipping to Sync and back returns the Hz rate that was set', () => {
    const start = switchLfoRateMode({ mode: 'hz', hz: 7.5 }, DEFAULT_PARKED_RATE, 'sync');
    expect(start.rate).toEqual({ mode: 'sync', division: DEFAULT_PARKED_RATE.division });
    const back = switchLfoRateMode(start.rate, start.parked, 'hz');
    expect(back.rate).toEqual({ mode: 'hz', hz: 7.5 });
  });

  test('flipping to Hz and back returns the division that was set', () => {
    const division = { value: 16, modifier: 'triplet' } as const;
    const start = switchLfoRateMode({ mode: 'sync', division }, DEFAULT_PARKED_RATE, 'hz');
    expect(start.rate).toEqual({ mode: 'hz', hz: DEFAULT_PARKED_RATE.hz });
    const back = switchLfoRateMode(start.rate, start.parked, 'sync');
    expect(back.rate).toEqual({ mode: 'sync', division });
  });

  test('selecting the mode it is already in writes nothing new', () => {
    const rate = { mode: 'hz', hz: 3 } as const;
    const result = switchLfoRateMode(rate, DEFAULT_PARKED_RATE, 'hz');
    expect(result.rate).toBe(rate);
    expect(result.parked).toBe(DEFAULT_PARKED_RATE);
  });
});
