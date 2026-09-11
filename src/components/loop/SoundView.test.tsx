import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { ChromaticKeyboard, getBlackKeyLeft, whiteKeysBefore } from '../ui/Keyboard';
import { shouldCloseSynthOverlays, SoundView, SYNTH_SOUND_GROUP } from './SoundView';
import { MIX_GROUP_IDS, MIX_GROUP_LABELS, MIX_LAYERS } from '../mixLayers';
import { MIX_LAYER_IDS, melodyTrackForFocus } from '@/store/focusTrack';
import type { MixLayerId } from '@/store/focusTrack';
import { synthTargetForFocus } from '@/store/focusTrack';
import { LOOP_COPY_GROUPS } from '@/store/loopCopy';
import { FIELD_LABEL, FIELD_LANE, HEADER_GROUP, SECTION_HEADER } from '../ui/fieldClasses';
import { PANEL_CARD } from '../ui/PanelCard';
import { resolveSynthControlChannel, SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import type { SynthControlTarget, SynthParamChannel } from '@/utils/synthControl';
import type { SynthParams } from '@/types';

/** The full opening tag of the element whose markup contains `needle` — pins the tag name, not text position. */
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

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

  /**
   * Both act on the synth patch and nothing else on this tab, so they belong
   * to the Synth section rather than to the tab. Asserted by position: the
   * Synth band opens before them and the tab header's title does not sit
   * between, which a move back into `ViewHeader`'s actions would break.
   */
  test('Save and Sounds ride the Synth band, not the tab header', () => {
    const html = renderToString(<SoundView />);
    const synthBand = html.indexOf('>Synth<');
    const save = html.indexOf('id="btn-quick-save-preset"');
    const library = html.indexOf('id="btn-open-presets-library"');
    // Drum Sound does not render on a melodic focus (default here), so the
    // Mixer band — always present — is the next fixed point after the Synth
    // section's own controls.
    const mixerBand = html.indexOf('>Mixer<');
    expect(synthBand).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(synthBand);
    expect(library).toBeGreaterThan(synthBand);
    expect(save).toBeLessThan(mixerBand);
    expect(library).toBeLessThan(mixerBand);
  });

  test('SoundView still renders', () => {
    const html = renderToString(<SoundView />);
    expect(html).toContain('Focus:');
  });

  // Guards the Focus chip row against going back to a hand-listed literal:
  // every entry in SYNTH_TARGET_STYLES must show up as a chip, so a target
  // added to the registry and forgotten here fails this test instead of
  // silently not rendering.
  test('every SYNTH_TARGET_STYLES entry renders as a Focus chip', () => {
    const html = renderToString(<SoundView />);
    for (const target of Object.keys(SYNTH_TARGET_STYLES) as SynthControlTarget[]) {
      expect(html).toContain(`>${SYNTH_TARGET_STYLES[target].label}<`);
    }
  });

  /**
   * The tab holds three things and has to say so at one glance. It did not:
   * the synth spread over a tinted target card plus a bare row of module
   * cards with no heading at all, the drum card opened with an icon and a
   * SECTION_HEADER, and the mixer opened with a bare SECTION_HEADER and no
   * icon — three weights for three peers, which is what made the drum and
   * mixer read as leftovers below the synth.
   */
  // Synth and Drum Sound are mutually exclusive now — one focus shows exactly
  // one of the two — so the "three peers" this test used to pin are only ever
  // two bands plus Mixer at a time. Checked on both sides of the gate.
  test('the sections open with the same band, in reading order', () => {
    const band = new RegExp(
      `w-3\\.5 h-3\\.5 text-primary"[^>]*>.*?<span class="${SECTION_HEADER}">([^<]+)</span>`,
      'g',
    );
    const bandsOf = (html: string) => [...html.matchAll(band)].map((m) => m[1]);

    expect(bandsOf(renderToString(<SoundView />))).toEqual(['Synth', 'Mixer']);

    // try/finally, not a bare reset after the assertion: a failed expect
    // above would throw before the reset ran and leak 'drum' into every test
    // that follows in this file.
    useAppStore.setState({ focusTrack: 'drum' });
    try {
      expect(bandsOf(renderToString(<SoundView />))).toEqual(['Drum Sound', 'Mixer']);
    } finally {
      useAppStore.setState({ focusTrack: 'synth' });
    }
  });

  /** One card per section, so the synth's stages cannot float off as siblings. */
  test('the synth stages are recessed compartments, not cards beside the section', () => {
    const html = renderToString(<SoundView />);
    // Synth + Mixer + the view header = three floating panels on the default
    // (melodic) focus, and no more — Drum Sound is absent here, not hidden.
    expect(html.split(PANEL_CARD).length - 1).toBe(3);
    expect(html).toContain('card bg-base-200 border border-base-300');
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
 *
 * Task 7 then moved the LEVEL out of the card and into the one Mixer, which is
 * the only reason two of the three read differently now: the drum bus fader is
 * still rendered by this view (so the dB guard still belongs here) but wears
 * SoundMixer's `drum` id prefix, and the card's field row is one field
 * shorter.
 */
describe('the Drum Sound card, moved from the sequencer (nav restructure Task 6)', () => {
  // Drum Sound only renders on a drum focus now (Task 4) — set before the one
  // render this whole describe block shares, and restore afterward so later
  // describes in this file see the default melodic focus again.
  useAppStore.setState({ focusTrack: 'drum' });
  const html = renderToString(<SoundView />);
  useAppStore.setState({ focusTrack: 'synth' });

  // Step 17: the drum bus fader's dB markup, asserted at view level so a
  // regression back to a %/linear readout on this call site is caught here
  // and not only inside ChannelStrip's own unit tests.
  test('the drum bus fader renders its dB tooltip and position step', () => {
    // DEV-383: masterSequencerVolume's factory default is DEFAULT_BUS_TRIM_DB
    // (-6 dB), not unity — this view renders the store's creation-time
    // snapshot with no explicit setState, so the tooltip reflects that.
    // `Drum`, not `Drums`: the fader is SoundMixer's row now (idPrefix 'drum',
    // which tracks the store field `drumMuted`), no longer the card's own
    // "Drum Level" strip. Same view, same bus, same dB contract.
    expect(html).toContain('title="Drum Layer Gain: -6.0 dB"');
    expect(html).toContain('step="0.005"');
  });

  // The regression this row was rebuilt for: fields whose controls were 24, 32
  // and 48px tall bottom-aligned into different label heights.
  //
  // The slice is bounded at BOTH ends on purpose. It used to run to the end of
  // the string, which was only correct while nothing rendered after this card
  // (the preset drawer's Suspense/lazy content is null while closed). SoundMixer
  // now renders below it and contributes five ChannelStrip FIELD_LABELs, so an
  // open-ended slice would count the mixer's fields as the card's and the
  // numbers below would stop meaning "this row". `>Mixer<` is the mixer's
  // SECTION_HEADER span, i.e. the first byte after the card.
  test('every field in a control row shares one label line and one control lane', () => {
    const start = html.indexOf('Drum Sound');
    const end = html.indexOf('>Mixer<');
    expect(end).toBeGreaterThan(start);
    const soundRow = html.slice(start, end);
    const labels = soundRow.split(FIELD_LABEL).length - 1;
    const lanes = soundRow.split(FIELD_LANE).length - 1;
    // Kit, Filter, Cutoff, Res each own a label + lane. The fifth label was
    // "Drum Level"'s, from the ChannelStrip that is now a Mixer row.
    expect(labels).toBe(4);
    expect(lanes).toBe(4);
  });

  test('the drum filter type switch is a daisyUI join on the 32px control lane', () => {
    // `sm`, not `xs`: it is one field in a control row, and a 24px join next to
    // a 32px select is what pushed the row's labels onto different baselines.
    // Unique to this row — the mode switcher above is `btn-xs` — so this alone
    // carries the assertion's weight.
    expect(html).toContain('btn btn-sm join-item');
  });
});

// The interactive keyboard is no longer pinned to the main synth: it plays
// whichever track `focusTrack` names (spec 2026-09-10-focus-track-design.md,
// symptom (a); useInputDeck.ts, synthTargetForFocus).
//
// `resolveSynthControlChannel` itself is UNCHANGED — it still maps a target to
// that target's channel — so what this block pins is the pair: focus picks the
// target, and the target picks the channel. The drum focus is the case with no
// channel at all, and it must resolve to nothing rather than falling back to
// Lead: the resolver's trailing `?? channels.synth` would absorb a stray
// 'drum' silently, which is why the fallback is never reached with one.
describe('the keyboard auditions the focused track', () => {
  // The `const baseParams: SynthParams = { … }` literal, the `channel(name)`
  // factory and the `channels` object below the describe header are UNCHANGED
  // — do not retype them, do not touch them. Only the header, the comment
  // above it and the tests inside it change.

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
    fx: channel('fx-synth'),
  };

  test('the panel resolver still maps every target to its own channel', () => {
    expect(resolveSynthControlChannel('chord', channels)).toBe(channels.chord);
    expect(resolveSynthControlChannel('bass', channels)).toBe(channels.bass);
    expect(resolveSynthControlChannel('synth', channels)).toBe(channels.synth);
  });

  test('focus picks the target, and the target picks the channel', () => {
    const cases: ReadonlyArray<[MixLayerId, string]> = [
      ['synth', 'main-synth'],
      ['fx', 'fx-synth'],
      ['chord', 'chord-synth'],
      ['bass', 'bass-synth'],
      ['pad', 'pad-synth'],
    ];
    for (const [focus, preset] of cases) {
      const target = synthTargetForFocus(focus);
      if (target === null) throw new Error(`expected a melodic target for ${focus}`);
      expect(resolveSynthControlChannel(target, channels).params.preset).toBe(preset);
    }
  });

  test('a drum focus has no channel to audition', () => {
    expect(synthTargetForFocus('drum')).toBeNull();
  });
});

describe('SoundView track solo', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('one solo button, following the active target (default: synth = Lead)', () => {
    const html = renderToString(<SoundView />);
    expect(html).toContain('aria-label="Solo Lead"');
    expect(html).not.toContain('aria-label="Solo Chord"');
    expect(html).not.toContain('aria-label="Solo Bass"');
    expect(html).not.toContain('aria-label="Solo Pad"');
    expect(html).not.toContain('aria-label="Solo Drums"');
  });

  // SoundView reads focusTrack through useLiveStore, which serves
  // getState() for both the client and server useSyncExternalStore
  // snapshots (see useLiveStore.ts and .claude/rules/testing.md) — so a
  // setState() before renderToString is observable here, unlike a plain
  // useAppStore read. This actually renders the component with a
  // non-default focus and checks which button comes out, which a
  // hardcoded `track="lead"` in the component would fail: the Chord
  // button would never appear and the Lead one would never disappear.
  test('the button switches to the active target when focusTrack changes', () => {
    useAppStore.setState({ focusTrack: 'chord' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('aria-label="Solo Chord"');
    expect(html).not.toContain('aria-label="Solo Lead"');
  });

  /**
   * Every view stays mounted (App.tsx and PatternView both gate with
   * block/hidden), so this button shares the document with the per-surface
   * solo for whichever track the target names. It therefore carries its own
   * id rather than `btn-solo-<track>`, which would be a duplicate id in the
   * live page for every possible target.
   */
  test('carries the target-row id, never the per-surface one', () => {
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-solo-target"');
    expect(html).not.toContain('id="btn-solo-lead"');
  });
});

describe('the Sound focus row', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('renders one chip per mix layer, drum included', () => {
    const html = renderToString(<SoundView />);
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-focus-${id}"`);
  });

  // A tag-scoped check, so the active classes are proven to sit on the SAME
  // element as the id rather than somewhere else in the row.
  test('the focused chip carries the active class list', () => {
    useAppStore.setState({ focusTrack: 'bass' });
    const html = renderToString(<SoundView />);
    expect(openTagContaining(html, 'id="btn-focus-bass"')).toContain(
      'class="btn btn-xs text-[11px] font-semibold rounded-sm [--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]"',
    );
  });

  test('the solo button follows focus, and drum focus gives it the Drums track', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('aria-label="Solo Drums"');
    expect(html).not.toContain('aria-label="Solo Lead"');
  });

  // The six focus chips are a "current item in a set", the same vocabulary the
  // mixer row's focus button uses — a screen-reader user must be able to tell
  // which one is focused from the markup, not just from a CSS class. Scoped to
  // the `btn-focus-*` chips (not `btn-mix-focus-*`, the mixer's own row, which
  // marks the same layer independently and would otherwise double the count).
  test('exactly one chip carries aria-current, and it is the focused one', () => {
    try {
      useAppStore.setState({ focusTrack: 'pad' });
      const html = renderToString(<SoundView />);
      const marked = MIX_LAYER_IDS.filter((id) =>
        openTagContaining(html, `id="btn-focus-${id}"`).includes('aria-current="true"'),
      );
      expect(marked).toEqual(['pad']);
    } finally {
      useAppStore.setState({ focusTrack: 'synth' });
    }
  });
});

describe('the Sound page on a drum focus', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  /**
   * The Synth section must be ABSENT from the markup, not merely hidden. This
   * is the gate useSynthChannel's drum branch relies on: with the section
   * unmounted no panel calls that hook, so its Lead fallback can never edit
   * anything. Hiding it with `block`/`hidden` instead would leave the panels
   * mounted and pointed at the Lead patch.
   */
  test('shows Drum Sound and no Synth section', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('Drum Sound');
    expect(html).not.toContain('>Synth<');
    expect(html).not.toContain('id="btn-quick-save-preset"');
  });

  test('a melodic focus shows the Synth section and no Drum Sound', () => {
    useAppStore.setState({ focusTrack: 'pad' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-quick-save-preset"');
    expect(html).not.toContain('Drum Sound');
  });

  // The focus row is outside the Synth section on purpose: inside it, a drum
  // focus would hide the only control that can get back to a melodic one.
  test('the focus row is still on screen with the Synth section gone', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-focus-synth"');
    expect(html).toContain('id="btn-focus-drum"');
  });
});

/**
 * `isLibraryOpen` / `isQuickSaving` are SoundView's own state and SoundView
 * never unmounts, so a naive gate on the drum focus alone leaves them true
 * underneath and re-opens the drawer the moment focus returns to a melodic
 * track. `renderToString` runs no effect (see .claude/rules/testing.md), so
 * a fresh render can never carry a stale "library flag set" into view — the
 * closing decision itself is what is tested, per the same file's
 * pure-logic-first convention.
 */
describe('the preset overlays close when focus leaves a melodic track', () => {
  test('shouldCloseSynthOverlays is true only for the drum focus', () => {
    expect(shouldCloseSynthOverlays('drum')).toBe(true);
    expect(shouldCloseSynthOverlays('synth')).toBe(false);
    expect(shouldCloseSynthOverlays('fx')).toBe(false);
    expect(shouldCloseSynthOverlays('chord')).toBe(false);
    expect(shouldCloseSynthOverlays('bass')).toBe(false);
    expect(shouldCloseSynthOverlays('pad')).toBe(false);
  });

  // Regression pin for the surface itself: whatever the library flag holds,
  // a drum focus must never render the drawer or its Suspense fallback.
  test('a drum focus renders neither the drawer nor its loading fallback', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    try {
      const html = renderToString(<SoundView />);
      expect(html).not.toContain('id="btn-open-presets-library"');
      expect(html).not.toContain('loading loading-spinner');
    } finally {
      useAppStore.setState({ focusTrack: 'synth' });
    }
  });
});

/**
 * The Synth and Drum Sound bands each carry a paste button for the groups
 * their own controls edit. Photo-pinned against the source, not rendered: the
 * Synth band's paste button names a DIFFERENT group depending on `synthTarget`
 * (Lead vs FX) and both branches cannot be seen in one render, so the source
 * is the only place the pairing is checkable in full.
 */
describe('the Sound sections carry paste buttons', () => {
  test('the Drum Sound and Synth sections carry paste buttons', () => {
    const src = readFileSync(new URL('./SoundView.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<ModulePasteButton');
    expect(src).toContain('groups={[\'drums-sound\']}');
    expect(src).toContain("'fx-sound'");
    expect(src).toContain("'lead-sound'");
  });

  /**
   * The Synth band edits whichever patch `synthTarget` names, and that is
   * EVERY melodic focus — chord, bass and pad included, not just Lead and FX
   * (`isMelodicFocus` is `focus !== 'drum'`). The mapping was a two-way test
   * (`fx` vs everything-else = Lead), which put a Lead paste button on the
   * chord/bass/pad patches' own band; the source pin above could not see it,
   * because the bad wiring satisfied every substring it looked for. Asserted
   * here against the store's own roster rather than a second hand-written
   * list, so a target added later fails here instead of falling through.
   */
  test('the Synth band names the focused track’s own sound group', () => {
    expect(SYNTH_SOUND_GROUP).toEqual({
      synth: 'lead-sound',
      fx: 'fx-sound',
      chord: 'chord-sound',
      bass: 'bass-sound',
      pad: 'pad-sound',
    });

    const targets = Object.keys(SYNTH_SOUND_GROUP) as SynthControlTarget[];
    for (const focus of targets) {
      const group = LOOP_COPY_GROUPS.find((g) => g.id === SYNTH_SOUND_GROUP[focus]);
      expect(group).toBeDefined();
      // The SOUND aspect, not the pattern: this band's Save/Sounds act on the
      // patch alone, and the melody grids carry the pattern groups.
      expect(group?.aspect).toBe('sound');
      expect(group?.track).toBe(melodyTrackForFocus(focus) ?? focus);
    }
  });
});

describe('SoundView mode switch', () => {
  /**
   * Simple/Pro chooses how deep the SAME patch is shown, so it belongs beside
   * the title with Pattern's segment row rather than in `actions` — and it
   * wears the same `HEADER_GROUP` shell, which is what makes the two the same
   * height. It used to sit at the far right in a `JOIN_LANE` of `btn-xs`.
   */
  test('rides the title cluster in the shared header shell', () => {
    const html = renderToString(<SoundView />);
    const title = html.indexOf('>Sound</h2>');
    const simple = html.indexOf('id="btn-mode-simple"');
    const synthBand = html.indexOf('>Synth<');
    expect(title).toBeGreaterThan(-1);
    expect(simple).toBeGreaterThan(title);
    expect(simple).toBeLessThan(synthBand);
    expect(html.slice(title, simple)).toContain(HEADER_GROUP);
  });
});

/**
 * Every mixer row carries its own level meter, under its fader.
 *
 * The count is what this asserts, not the markup: a sixth mix layer added to
 * MIX_LAYERS must arrive with a meter, and a meter that quietly stopped
 * rendering for one layer would leave that row the only one you cannot see.
 * The bar's own appearance belongs to ui/MeterBar and is tested there.
 */
describe('the Mixer rows each carry a level meter', () => {
  const html = renderToString(<SoundView />);
  // Silent at render: there is no DOM here, so no effect runs and no analyser
  // is ever read — the title is the SILENT_LEVEL reading, which is the same
  // property VuMeter.test.tsx asserts for the master meter.
  const titles = [...html.matchAll(/title="([^"]+) peak: [^"]*"/g)].map((m) => m[1]);

  test('one per layer, in the table order MIX_LAYERS declares', () => {
    expect(titles).toEqual(['Lead', 'FX', 'Chord', 'Bass', 'Pad', 'Beat']);
  });

  test('names the layer the way the screen does, not the way the engine does', () => {
    // The drum bus is 'sequencer' to the engine and 'drum' in the store; a
    // meter titled either of those would be naming an internal id at the user.
    expect(html).not.toContain('sequencer peak:');
  });
});

/**
 * The Mixer groups its rows under labelled rules, not inside a box.
 *
 * What this pins is the pairing, not the styling: every group in MIX_GROUP_IDS
 * reaches the screen as a heading, and every row lands after the heading its
 * own `group` column names. A layer added with a group nobody renders would
 * otherwise appear at the bottom of whichever block happened to come last.
 */
describe('the Mixer groups its rows under labelled dividers', () => {
  // Sliced at the mixer's own SECTION_HEADER, not searched across the whole
  // view: the Sound view's Target selector carries its own "Accompaniment"
  // label further up the page, so an unscoped indexOf finds that one and every
  // ordering assertion below reads a position from the wrong component.
  const view = renderToString(<SoundView />);
  const html = view.slice(view.indexOf('>Mixer<'));

  test('one divider per group, in MIX_GROUP_IDS order', () => {
    const headings = [...html.matchAll(/class="divider divider-start[^"]*">([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(headings).toEqual(MIX_GROUP_IDS.map((id) => MIX_GROUP_LABELS[id]));
  });

  test('every row sits after the heading its own group column names', () => {
    for (const layer of MIX_LAYERS) {
      const heading = html.indexOf(`>${MIX_GROUP_LABELS[layer.group]}<`);
      const row = html.indexOf(`id="btn-mix-mute-${layer.idPrefix}"`);
      const nextHeadingId = MIX_GROUP_IDS[MIX_GROUP_IDS.indexOf(layer.group) + 1];
      const nextHeading = nextHeadingId
        ? html.indexOf(`>${MIX_GROUP_LABELS[nextHeadingId]}<`)
        : html.length;

      expect(heading).toBeGreaterThan(-1);
      expect(row).toBeGreaterThan(heading);
      expect(row).toBeLessThan(nextHeading);
    }
  });

  // The box is gone, deliberately — ui/GroupFrame still serves ChordView and the
  // Sound view's Target selector, but a frame around one of three groups was
  // asking the reader to work out whether the rows outside it were a group too.
  // There is deliberately no "draws no group frame" test any more. It asserted
  // `not.toContain('border border-base-300 rounded-2xl')`, which passed only
  // because that raw radius was momentarily unique — GroupFrame's real shell
  // (`border border-base-300 rounded-box`) is a substring of VolumeFader's box,
  // and its caption class is a substring of the mixer's OWN dividers, so no
  // class-substring form of the claim can be both true and non-vacuous. What
  // the section actually promises is pinned positively by the test above:
  // one divider per group, in MIX_GROUP_IDS order.
});

/**
 * The Mixer's five toggles form a column, and the fader beside each starts at
 * the same x.
 *
 * That alignment is why the toggles are icon-only: "Lead On", "Chord On" and
 * "Pad Off" are three different lengths, so a labelled button leaves the column
 * ragged and every fader at a different indent. `btn-square` is one width for
 * every layer, including a sixth nobody has added yet.
 */
describe('the Mixer toggle column', () => {
  const view = renderToString(<SoundView />);
  const html = view.slice(view.indexOf('>Mixer<'));

  test('every toggle is square, so the column is one width by construction', () => {
    for (const layer of MIX_LAYERS) {
      const button = html.slice(html.indexOf(`id="btn-mix-mute-${layer.idPrefix}"`));
      expect(button.slice(0, button.indexOf('>'))).toContain('btn-square');
    }
  });

  // Dropping the visible text must not drop the state: the row's own label says
  // which layer this is, but only the button knows whether it is on.
  test('and still names itself and its state without the visible text', () => {
    for (const layer of MIX_LAYERS) {
      const button = html.slice(html.indexOf(`id="btn-mix-mute-${layer.idPrefix}"`));
      const tag = button.slice(0, button.indexOf('>'));
      expect(tag).toMatch(new RegExp(`aria-label="${layer.label} (On|Off)"`));
      expect(tag).toMatch(/aria-pressed="(true|false)"/);
    }
  });

  // The label belongs to the ROW, not to the fader: while ChannelStrip owned it,
  // the toggle centred against a 48px label-plus-box stack and the fader against
  // its own 32px box, which left every toggle 8px above the control it operates.
  test('the fader carries no label of its own, so the controls share one line', () => {
    // One label per ROW and none from the fader. Counting is what makes this
    // fail if ChannelStrip's own label comes back: it would double the count
    // without changing anything a per-row slice could see.
    const labels = [...html.matchAll(/<label /g)];
    expect(labels).toHaveLength(MIX_LAYERS.length);
    for (const layer of MIX_LAYERS) {
      expect(html).toContain(`for="slider-${layer.idPrefix}-layer-volume"`);
    }
  });
});
