import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import type { BassStepChoice } from '@/data/bassPatterns';
import { useAppStore } from '@/store/store';
import { LOOP_COPY_GROUPS } from '@/store/loopCopy';
import type { LoopCopyGroupId } from '@/store/loopCopy';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import { BassModulePanel } from './BassModulePanel';
import { ChordModulePanel } from './ChordModulePanel';
import { customPatternFoldedStep } from './customPatternGrid';
import { PadModulePanel } from './PadModulePanel';
import { BASS_TOOLS, bassToolValue } from './bassStepChoice';
import { chordActivationValue } from './ChordModulePanel';

const noop = () => {};

const chordPanel = () =>
  renderToString(
    <ChordModulePanel
      onPatternPreviewDown={noop}
      onPatternPreviewUp={noop}
      isPlaying={false}
    />,
  );

const bassPanel = () =>
  renderToString(
    <BassModulePanel onPatternPreviewDown={noop} onPatternPreviewUp={noop} isPlaying={false} />,
  );

/**
 * The two panels' custom lanes are gated on a store MODE, and zustand wires
 * `getServerSnapshot` to the object captured at store creation — so
 * `setState` cannot put a `renderToString` render into custom mode and the
 * creation-time object has to be patched for the duration of the render,
 * exactly as ChordView.test.tsx does. The patch is restored in a `finally`:
 * every later render in this file would otherwise see a custom-mode panel.
 */
type InitialState = ReturnType<typeof useAppStore.getInitialState>;

function renderPatched(patch: Partial<InitialState>, render: () => string): string {
  const initial = useAppStore.getInitialState();
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    saved[key] = initial[key as keyof InitialState];
  }
  Object.assign(initial, patch);
  try {
    return render();
  } finally {
    Object.assign(initial, saved);
  }
}

/** One active chord onset at column 0, the rest of the row empty. */
const CUSTOM_CHORDS = {
  chordRhythmMode: 'custom' as const,
  customChordRhythm: [true, ...new Array(MAX_STEPS_PER_BAR - 1).fill(false)],
};

const CUSTOM_BASS: Partial<InitialState> = {
  bassPatternMode: 'custom',
  customBassPattern: [
    'root',
    ...new Array<BassStepChoice>(MAX_STEPS_PER_BAR - 1).fill('rest'),
  ],
};

/** The exact option markup a `PatternBarsField` renders for one bar count. */
function barsOption(bars: number, selected = false): string {
  return `<option value="${bars}"${selected ? ' selected=""' : ''}>${bars}</option>`;
}

const chordPanelHtml = chordPanel();
const bassPanelHtml = bassPanel();

describe('ChordModulePanel', () => {
  const html = chordPanelHtml;

  test('renders every control the inline block rendered', () => {
    for (const id of [
      'select-chord-sound-preset',
      'select-chord-octave',
      'select-chord-rhythm-pattern',
      'btn-preview-chord-pattern',
      'slider-chord-feel',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('is its own tint-chord card, like its Bass and Pad siblings', () => {
    // It used to return a bare fragment and borrow the progression card's
    // shell — the only one of the three accompaniment layers without a card
    // and a title of its own.
    expect(html).toContain('card bg-panel tint-chord border border-module-chord/30');
    expect(html).toContain('Chord Module');
  });

  test('carries the Adjust Synth button', () => {
    // Moved here from the progression card's header: it adjusts this layer's
    // sound, which is what Bass and Pad put in the same corner.
    expect(html).toContain('Adjust Synth');
  });

  test('does not render the re-harmonize controls', () => {
    // Both call setChords — they rewrite the progression every layer reads,
    // not this layer's voice of it — so they belong to ChordView's
    // progression card, beside the badge that reports their effect.
    expect(html).not.toContain('btn-reharmonize-chord-progression');
    expect(html).not.toContain('btn-toggle-auto-reharmonize');
    expect(html).not.toContain('Auto-Reharmonize');
  });

  test('wears the chord module identity token and no raw colour', () => {
    expect(html).toContain('text-module-chord');
    expect(html).toContain('[--range-thumb:var(--color-module-chord-content)]');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
  });

  test('the custom lane and its bar field are hidden while the mode is preset', () => {
    // INITIAL state has chordRhythmMode 'preset', so neither the lanes' bar
    // selector nor the timeline that reads it may render.
    expect(html).not.toContain('id="select-chord-pattern-bars"');
    expect(html).not.toContain('aria-label="Chord pattern"');
  });
});

describe('BassModulePanel', () => {
  const html = bassPanelHtml;

  test('renders every control the inline block rendered', () => {
    for (const id of [
      'select-bass-sound-preset',
      'select-bass-octave',
      'select-bass-rhythm-pattern',
      'btn-preview-bass-pattern',
      'slider-bass-feel',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('keeps its tint-bass card shell and bass identity token', () => {
    expect(html).toContain('card bg-panel tint-bass border border-module-bass/30');
    expect(html).toContain('text-module-bass');
    expect(html).toContain('Bass Module');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
  });

  test('carries the Adjust Synth button', () => {
    expect(html).toContain('Adjust Synth');
  });

  test('the custom lane, its bar field and its palette are hidden while preset', () => {
    expect(html).not.toContain('id="select-bass-pattern-bars"');
    expect(html).not.toContain('aria-label="Bass pattern"');
    expect(html).not.toContain('id="btn-bass-note-root"');
  });
});

describe('PadModulePanel', () => {
  // getServerSnapshot serves the store's creation-time state (the zustand +
  // renderToString trap), which has padMode 'pad' — so this renders the
  // chord-voicing fields (voicing), never the drone fields. The other
  // branch is exercised by the padPlayback tests; this test stays
  // limited to the structural class-string checks the sibling panels use.
  const html = renderToString(<PadModulePanel />);

  test('renders every control the pad-mode fields expose', () => {
    for (const id of [
      'select-pad-sound-preset',
      'btn-pad-mode-pad',
      'btn-pad-mode-drone',
      'select-pad-octave',
      'btn-pad-voicing-triad',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  // The octave select is the one field OUTSIDE the mode branch, because
  // padOctave feeds resolveDroneNotes as well as the chord-following path.
  // A render can only ever show pad mode here, so what this pins is the
  // control's full range and its select shape, matching chord and bass.
  test('offers the pad octave as a select spanning Oct 1 to Oct 5', () => {
    expect(html).toContain('id="select-pad-octave"');
    // renderToString splits `Oct {o}` into two text nodes, so the marker is
    // part of the output, not noise in the assertion. Value and label are
    // asserted apart because the selected option also carries `selected=""`.
    for (const o of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`<option value="${o}"`);
      expect(html).toContain(`>Oct <!-- -->${o}</option>`);
    }
    expect(html).not.toContain('>Oct <!-- -->6</option>');
    expect(html).not.toContain('>Oct <!-- -->0</option>');
    expect(html).not.toContain('id="btn-pad-octave-3"');
  });

  test('wears its tint-pad card shell and pad identity token, no raw colour', () => {
    expect(html).toContain('card bg-panel tint-pad border border-module-pad/30');
    expect(html).toContain('text-module-pad');
    expect(html).toContain('Pad Module');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
  });
});

/**
 * Each module card's header carries the paste button for its own sound +
 * pattern groups. Photo-pinned against the source rather than rendered: the
 * button's disabled state depends on a clipboard a `renderToString` render
 * cannot set, and what this task wires is a call site — which group ids each
 * card names — not the button's behaviour (ModulePasteButton's own tests).
 */
describe('each module panel header carries its paste button', () => {
  test('every panel renders a ModulePasteButton in its card actions', () => {
    for (const file of ['ChordModulePanel.tsx', 'BassModulePanel.tsx', 'PadModulePanel.tsx']) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(src).toContain('<ModulePasteButton');
    }
  });

  test('each names its own sound and pattern groups', () => {
    const expected: ReadonlyArray<[string, string]> = [
      ['ChordModulePanel.tsx', `groups={['chord-sound', 'chord-pattern']}`],
      ['BassModulePanel.tsx', `groups={['bass-sound', 'bass-pattern']}`],
      ['PadModulePanel.tsx', `groups={['pad-sound', 'pad-pattern']}`],
    ];
    for (const [file, call] of expected) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(src).toContain(call);
    }
  });

  test('the group each card names actually carries its custom pattern lane', () => {
    // The two halves of the paste chain live in different files: the panel
    // names a group id (pinned above), and LOOP_COPY_GROUPS decides what that
    // id carries. Neither alone would notice a re-typed or re-assigned id, and
    // the four custom pattern fields are the ones whose loss is SILENT — a
    // lane that arrives without its length or holds plays a shorter, flatter
    // phrase rather than failing.
    const keysOf = (id: LoopCopyGroupId): readonly string[] => {
      const group = LOOP_COPY_GROUPS.find((entry) => entry.id === id);
      if (!group) throw new Error(`no copy group named ${id}`);
      return group.keys;
    };
    for (const key of ['customChordRhythm', 'customChordLoopLength', 'customChordHoldSteps']) {
      expect(keysOf('chord-pattern')).toContain(key);
    }
    for (const key of ['customBassPattern', 'customBassLoopLength', 'customBassHoldSteps']) {
      expect(keysOf('bass-pattern')).toContain(key);
    }
  });
});

describe('Accompaniment rows carry one solo each', () => {
  test('the chord row solos chord', () => {
    expect(chordPanelHtml).toContain('aria-label="Solo Chord"');
    expect(chordPanelHtml).not.toContain('aria-label="Solo Bass"');
    expect(chordPanelHtml).not.toContain('aria-label="Solo Pad"');
  });

  test('the bass row solos bass', () => {
    expect(bassPanelHtml).toContain('aria-label="Solo Bass"');
    expect(bassPanelHtml).not.toContain('aria-label="Solo Chord"');
    expect(bassPanelHtml).not.toContain('aria-label="Solo Pad"');
  });

  test('the pad row solos pad', () => {
    const html = renderToString(<PadModulePanel />);
    expect(html).toContain('aria-label="Solo Pad"');
    expect(html).not.toContain('aria-label="Solo Chord"');
    expect(html).not.toContain('aria-label="Solo Bass"');
  });
});

/**
 * The bar selector and the span timeline, both gated on the same mode. They
 * moved together out of the pattern field, so a conditional left behind on one
 * of them would leave a bare "Bars" select over a preset — or a timeline with
 * no way to say how long it is.
 */
describe('the custom lanes appear only in custom mode', () => {
  test('custom mode reveals the chord bar field and its timeline', () => {
    const html = renderPatched(CUSTOM_CHORDS, chordPanel);
    expect(html).toContain('id="select-chord-pattern-bars"');
    expect(html).toContain('aria-label="Chord pattern"');
    expect(html).toContain('bg-module-chord text-module-chord-content');
  });

  test('custom mode reveals the bass bar field, its palette and its timeline', () => {
    const html = renderPatched(CUSTOM_BASS, bassPanel);
    expect(html).toContain('id="select-bass-pattern-bars"');
    expect(html).toContain('id="btn-bass-note-root"');
    expect(html).toContain('aria-label="Bass pattern"');
    expect(html).toContain('bg-module-bass text-module-bass-content');
  });

  test('preset mode reveals neither lane', () => {
    expect(chordPanelHtml).not.toContain('id="select-chord-pattern-bars"');
    expect(chordPanelHtml).not.toContain('aria-label="Chord pattern"');
    expect(bassPanelHtml).not.toContain('id="select-bass-pattern-bars"');
    expect(bassPanelHtml).not.toContain('aria-label="Bass pattern"');
  });
});

describe('the bar field offers the progression’s divisors', () => {
  test('the default four-bar progression offers 1, 2 and 4 bars', () => {
    const html = renderPatched(CUSTOM_CHORDS, chordPanel);
    expect(html).toContain('>Bars</label>');
    // The exact option sequence, contiguous: 3 is not a divisor of four bars,
    // and a length the progression cannot divide would leave a gap at the end
    // of every repetition — so nothing may sit between these three options.
    expect(html).toContain(
      [barsOption(1, true), barsOption(2), barsOption(4)].join(''),
    );
  });

  test('each lane shows its own loop length, not its sibling’s', () => {
    const chord = renderPatched({ ...CUSTOM_CHORDS, customChordLoopLength: 2 }, chordPanel);
    expect(chord).toContain(barsOption(2, true));

    const bass = renderPatched({ ...CUSTOM_BASS, customBassLoopLength: 4 }, bassPanel);
    expect(bass).toContain(barsOption(4, true));
  });

});

describe('the chord lane routes its three gestures to the event actions', () => {
  test('an activation toggles the onset at that column', () => {
    const values = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    values[0] = true;

    // An already-active head clears; an empty column starts a one-step onset.
    expect(chordActivationValue(values, 0, 16)).toBe(false);
    expect(chordActivationValue(values, 3, 16)).toBe(true);
  });

  test('it reads the STORED slot, never the column index', () => {
    // 3/4 stores bar-major at MAX_STEPS_PER_BAR, so column 12 (bar two, offset
    // zero) is stored slot 24. `values[column]` would be right in the widest
    // meter and wrong in every other one.
    const values = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
    values[MAX_STEPS_PER_BAR] = true;

    expect(chordActivationValue(values, 12, 12)).toBe(false);
    expect(chordActivationValue(values, 0, 12)).toBe(true);
  });

});

describe('the bass note palette', () => {
  const html = renderPatched(CUSTOM_BASS, bassPanel);

  test('offers R, 3, 5, 7, 8 and Erase, with the full names on the accessible labels', () => {
    expect(BASS_TOOLS).toEqual([
      { tool: 'root', label: 'R', name: 'Root' },
      { tool: 'third', label: '3', name: 'Third' },
      { tool: 'fifth', label: '5', name: 'Fifth' },
      { tool: 'seventh', label: '7', name: 'Seventh' },
      { tool: 'octave', label: '8', name: 'Octave' },
      { tool: 'erase', label: 'Erase', name: 'Erase note' },
    ]);
  });

  test('renders one pressed button per tool, starting on the root', () => {
    for (const choice of BASS_TOOLS) {
      expect(html).toContain(`id="btn-bass-note-${choice.tool}"`);
      expect(html).toContain(`>${choice.label}</button>`);
      expect(html).toContain(`aria-label="${choice.name}"`);
      expect(html).toContain(`title="${choice.name}"`);
    }
    // A single-select toolbar: exactly one tool is armed.
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  test('a tool is a store value, so Erase is the lane’s own rest', () => {
    expect(bassToolValue('root')).toBe('root');
    expect(bassToolValue('fifth')).toBe('fifth');
    expect(bassToolValue('erase')).toBe('rest');
  });

  test('an active span heads with its tone letter', () => {
    // Five tones, four steps apart, in a TWO-bar cycle: bar one's four beats
    // and bar two's first. One column per tone so no span swallows the next.
    const pattern = new Array<BassStepChoice>(2 * MAX_STEPS_PER_BAR).fill('rest');
    const tones: Array<[number, BassStepChoice]> = [
      [0, 'root'],
      [4, 'third'],
      [8, 'fifth'],
      [12, 'seventh'],
      [MAX_STEPS_PER_BAR, 'octave'],
    ];
    for (const [stored, tone] of tones) pattern[stored] = tone;

    const custom = renderPatched(
      { ...CUSTOM_BASS, customBassLoopLength: 2, customBassPattern: pattern },
      bassPanel,
    );

    expect(custom).toContain('aria-label="Bass R at bar 1 beat 1 step 1"');
    expect(custom).toContain('aria-label="Bass 3 at bar 1 beat 2 step 1"');
    expect(custom).toContain('aria-label="Bass 5 at bar 1 beat 3 step 1"');
    expect(custom).toContain('aria-label="Bass 7 at bar 1 beat 4 step 1"');
    expect(custom).toContain('aria-label="Bass 8 at bar 2 beat 1 step 1"');
    // And the visible labels are the same letters the palette offers.
    expect(custom).toContain('>R</span>');
  });
});

/**
 * Two lanes, one published step, two cycles: the 'chords' producer emits a
 * PROGRESSION-relative step and each lane folds it by its own width, so the
 * same tick can sit on column 4 of a one-bar chord lane and column 20 of a
 * two-bar bass lane. This is now a pure-function assertion on
 * `customPatternFoldedStep` rather than a rendered one: the playhead is drawn
 * by `CustomPatternPlayhead`, which subscribes to the shared step itself
 * (mirroring `LeadMarker`) and so cannot be handed one under
 * `renderToString` — see `CustomPatternTimeline.test.tsx` for that boundary.
 */
describe('the two lanes fold the same published step differently', () => {
  test('one absolute step lands on a different column in each lane', () => {
    expect(customPatternFoldedStep(20, 1 * 16)).toBe(4);
    expect(customPatternFoldedStep(20, 2 * 16)).toBe(20);
  });
});

/**
 * The cross-boundary fixture as a rendered lane: a TWO-bar Chord lane and a
 * FOUR-bar Bass lane over the same four one-bar chords, in 3/4.
 *
 * Everything is STORED bar-major at `MAX_STEPS_PER_BAR`, so the onsets sit on
 * stored slots 0/24 (chord) and 0/24/48/72 (bass) while the label each one
 * draws says `bar N beat M` in the ACTIVE meter's twelve-column bars. A lane
 * that labelled its columns by stored slot would put the bass lane's last
 * onset on "bar 2 beat 1" instead of "bar 4 beat 1" — the exact drift a
 * non-4/4 meter makes visible and 4/4 hides.
 */
const THREE_FOUR_STEPS = 12; // `METERS['3/4'].stepsPerBar` — accent groups [4, 4, 4]

const FOUR_BAR_BASS = (() => {
  const tones: BassStepChoice[] = ['root', 'third', 'fifth', 'seventh'];
  const pattern = new Array<BassStepChoice>(4 * MAX_STEPS_PER_BAR).fill('rest');
  const holds = new Array<number>(4 * MAX_STEPS_PER_BAR).fill(1);
  tones.forEach((tone, bar) => {
    pattern[bar * MAX_STEPS_PER_BAR] = tone;
    holds[bar * MAX_STEPS_PER_BAR] = THREE_FOUR_STEPS;
  });
  return { pattern, holds };
})();

const TWO_BAR_CHORD = (() => {
  const pattern = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
  const holds = new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1);
  for (const bar of [0, 1]) {
    pattern[bar * MAX_STEPS_PER_BAR] = true;
    holds[bar * MAX_STEPS_PER_BAR] = THREE_FOUR_STEPS;
  }
  return { pattern, holds };
})();

describe('a two-bar chord / four-bar bass lane in 3/4', () => {
  const chord = renderPatched(
    {
      meterId: '3/4',
      chordRhythmMode: 'custom',
      customChordRhythm: TWO_BAR_CHORD.pattern,
      customChordHoldSteps: TWO_BAR_CHORD.holds,
      customChordLoopLength: 2,
    },
    chordPanel,
  );
  const bass = renderPatched(
    {
      meterId: '3/4',
      bassPatternMode: 'custom',
      customBassPattern: FOUR_BAR_BASS.pattern,
      customBassHoldSteps: FOUR_BAR_BASS.holds,
      customBassLoopLength: 4,
    },
    bassPanel,
  );

  test('the chord lane draws two bars and names its onsets in the active meter', () => {
    // The bar strip is the lane's own loop length; the accessible labels still
    // name the beat, so a 3/4 bar has three of them, never four.
    expect(chord).toContain('>Bar 1</div>');
    expect(chord).toContain('>Bar 2</div>');
    expect(chord).not.toContain('>Bar 3</div>');

    expect(chord).toContain('aria-label="Chord event at bar 1 beat 1 step 1"');
    // Stored slot 24 is bar 2 beat 1 of a twelve-column bar.
    expect(chord).toContain('aria-label="Chord event at bar 2 beat 1 step 1"');
  });

  test('the bass lane draws four bars and names its last onset in the active meter', () => {
    expect(bass).toContain('>Bar 4</div>');

    expect(bass).toContain('aria-label="Bass R at bar 1 beat 1 step 1"');
    expect(bass).toContain('aria-label="Bass 3 at bar 2 beat 1 step 1"');
    expect(bass).toContain('aria-label="Bass 5 at bar 3 beat 1 step 1"');
    expect(bass).toContain('aria-label="Bass 7 at bar 4 beat 1 step 1"');
  });
});
