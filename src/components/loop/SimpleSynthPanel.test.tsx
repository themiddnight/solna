import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SimpleSynthPanel, SIMPLE_CONTROL_SPECS } from './SimpleSynthPanel';
import { SubtractiveProPanel } from './synth/SubtractiveProPanel';
import { synthChannelForFocus } from './synth/useSynthChannel';
import type { SynthChannel, SynthChannels } from './synth/useSynthChannel';
import { SIMPLE_CONTROL_IDS } from '@/utils/subtractiveSimple';
import { defaultTrackArp, defaultTrackSynth } from '@/store/initialState';
import type { ActiveSynth, ArpSettings } from '@/types/synth';

// Five distinct, otherwise-meaningless channel stand-ins, one per target. Two
// tracks can legitimately hold the SAME patch — every track starts on a factory
// preset and nothing has been edited yet — so asserting against the store's
// defaults would pass even for a wrong channel. These are distinguishable by
// reference on their own.
function fakeChannels(): SynthChannels {
  const make = (): SynthChannel => ({
    activeSynth: {} as ActiveSynth,
    arpSettings: {} as ArpSettings,
    setActiveSynth: () => {},
    setArpSettings: () => {},
  });
  return {
    synth: make(),
    chord: make(),
    bass: make(),
    pad: make(),
    fx: make(),
  };
}

/** A channel plus the writes it recorded, so "no write" is a fact, not a hope. */
interface RecordingChannel extends SynthChannel {
  patches: ActiveSynth[];
  arps: ArpSettings[];
}

function makeChannel(): RecordingChannel {
  const patches: ActiveSynth[] = [];
  const arps: ArpSettings[] = [];
  const synth = defaultTrackSynth('synth');
  // Pulled off the resting Init values so a descriptor that was hard-coded
  // rather than derived would read the same either way.
  synth.patch.common.stereoWidth = 0.82;
  synth.patch.synth.filter.cutoffHz = 3200;
  synth.patch.synth.filter.resonance = 0.38;
  return {
    activeSynth: synth,
    arpSettings: { ...defaultTrackArp('synth'), active: true, rate: '16n', mode: 'up' },
    setActiveSynth: (next) => void patches.push(next),
    setArpSettings: (next) => void arps.push(next),
    patches,
    arps,
  };
}

const channel = makeChannel();
const html = renderToString(<SimpleSynthPanel channel={channel} onSwitchToPro={() => {}} />);

describe('the approved Simple surface (prototype Variant B)', () => {
  test('one continuous deck with the four listening-intent groups', () => {
    for (const heading of ['Source', 'Tone', 'Feel', 'Motion']) {
      expect(html).toContain(`>${heading}<`);
    }
    for (const kicker of ['core character', 'colour &amp; impact', 'note response', 'movement &amp; size']) {
      expect(html).toContain(kicker);
    }
    // One deck, not one card per knob: eight controls must not produce eight
    // `card` shells (the four groups sit inside a single panel).
    expect((html.match(/card bg-base-200/g) ?? []).length).toBe(1);
  });

  test('the eight approved controls, each with its own knob', () => {
    for (const id of SIMPLE_CONTROL_IDS) {
      expect(html).toContain(`id="slider-simple-${id}"`);
      expect(html).toContain(`>${SIMPLE_CONTROL_SPECS[id].label}<`);
    }
    expect((html.match(/id="slider-simple-/g) ?? []).length).toBe(8);
  });

  test('the header carries the Current feel summary, derived from the patch', () => {
    expect(html).toContain('Shape the sound');
    expect(html).toContain('Current feel');
    expect(html).toContain('Wide &amp; rounded');
  });

  test('descriptors read out of the patch, not out of a default', () => {
    expect(html).toContain('>Open<');
    expect(html).toContain('>Warm<');
    expect(html).toContain('>Wide<');
  });

  test('play style is a Mono/Poly pair with real pressed state', () => {
    expect(html).toContain('id="btn-simple-voice-mono"');
    expect(html).toContain('id="btn-simple-voice-poly"');
    expect(html).toContain('Play style');
    // The default track patch is poly, so Poly is the pressed one.
    const poly = html.indexOf('id="btn-simple-voice-poly"');
    expect(html.slice(poly, poly + 120)).toContain('aria-pressed="true"');
  });

  test('the compact Arp strip covers every rate and direction the patch can hold', () => {
    expect(html).toContain('id="btn-simple-arp-toggle"');
    for (const rate of ['4n', '8n', '16n', '32n']) {
      expect(html).toContain(`id="btn-simple-arp-rate-${rate}"`);
    }
    for (const mode of ['up', 'down', 'updown', 'random']) {
      expect(html).toContain(`id="btn-simple-arp-mode-${mode}"`);
    }
  });

  test('every knob exposes its canonical value to assistive tech', () => {
    expect((html.match(/role="slider"/g) ?? []).length).toBe(8);
    expect(html).toContain('aria-valuetext');
  });
});

describe('Simple never speaks Pro', () => {
  test('no Pro-only vocabulary appears anywhere in the markup', () => {
    for (const term of [
      'cents',
      ' ct',
      'Key track',
      'ENV 2',
      'ENV2',
      'Unison',
      'Spread',
      'Resonance',
      'Cutoff',
      'LFO',
      'ADSR',
      'Detune',
      'Q factor',
      'Destination',
    ]) {
      expect(html).not.toContain(term);
    }
  });
});

describe('Simple theming', () => {
  test('every group wears the Pro module identity of what it writes', () => {
    for (const token of [
      'text-module-osc',
      'text-module-filter',
      'text-module-env-amp',
      'text-module-lfo',
      // Voice, which Width and Play style write. It shared the envelope's
      // token until the envelopes collapsed onto one hue and freed this one.
      'text-module-voice',
    ]) {
      expect(html).toContain(token);
    }
    // The Arp strip is buttons, not knobs, so its identity arrives as the
    // pressed fill rather than as a text token.
    expect(html).toContain('--btn-color:var(--color-module-arp)');
  });

  /**
   * Width's canonical parameter is `common.stereoWidth`, which Pro draws in its
   * Voice module — so the knob wears VOICE even though Variant B files it
   * under Motion. The identity follows the parameter, not the box.
   *
   * This is the assertion that had been passing for the wrong reason: Voice
   * used to borrow the amplitude envelope's token, so Width wore a colour that
   * was simultaneously its Pro identity and the Feel group's, and nothing here
   * could tell the two apart. Now it can.
   */
  test('Width keeps its Pro identity inside the Motion group', () => {
    const width = html.indexOf('id="slider-simple-width"');
    const before = html.slice(width - 400, width);
    expect(before).toContain('text-module-voice');
    // Not the group it is drawn in, and not the envelope it used to share with.
    expect(before).not.toContain('text-module-lfo');
    expect(before).not.toContain('text-module-env-amp ');
  });

  test('no dark: variants survive — they key off the OS, not data-theme', () => {
    expect(html).not.toContain('dark:');
  });

  test('no raw palette colours or absolute white survive', () => {
    for (const legacy of ['amber-', 'cyan-', 'pink-', 'emerald-', 'purple-', 'text-white', '#']) {
      expect(html).not.toContain(legacy);
    }
  });

  test('no macro borrows a daisyUI semantic role', () => {
    for (const semantic of ['text-secondary', 'badge-primary', 'badge-secondary', 'badge-accent']) {
      expect(html).not.toContain(semantic);
    }
  });
});

describe('switching depth writes nothing', () => {
  /**
   * Simple is a VIEW of the patch Pro edits: it holds no state of its own, so
   * showing either surface — or both, one after the other — must leave the
   * store exactly where it was. A projection that normalised the patch on
   * mount would silently mark every project dirty on a mode toggle.
   */
  test('rendering Simple, then Pro, then Simple again performs no store write', () => {
    const recording = makeChannel();
    renderToString(<SimpleSynthPanel channel={recording} onSwitchToPro={() => {}} />);
    renderToString(<SubtractiveProPanel channel={recording} />);
    renderToString(<SimpleSynthPanel channel={recording} onSwitchToPro={() => {}} />);
    expect(recording.patches).toHaveLength(0);
    expect(recording.arps).toHaveLength(0);
  });
});

describe('the synth panels follow focusTrack', () => {
  // A pure assertion on the hook's own extracted resolution: `useSynthChannel`
  // is a hook, but its whole body is `synthChannelForFocus`, called here
  // directly with a channel map built from distinct references.
  test('the FX focus resolves the FX patch, not the Lead one', () => {
    const channels = fakeChannels();
    expect(synthChannelForFocus('fx', channels).activeSynth).toBe(channels.fx.activeSynth);
    expect(synthChannelForFocus('bass', channels).activeSynth).toBe(channels.bass.activeSynth);
  });

  // Pins the drum branch specifically: `synthTargetForFocus` refuses a drum
  // focus by type, so `synthChannelForFocus` falls back to the Lead patch
  // (safe only because SoundView unmounts the Synth section on a drum focus —
  // see the comment on the function itself). Flipping that fallback to any
  // other channel must turn this red.
  test('the drum focus falls back to the Lead patch', () => {
    const channels = fakeChannels();
    expect(synthChannelForFocus('drum', channels).activeSynth).toBe(channels.synth.activeSynth);
  });
});
