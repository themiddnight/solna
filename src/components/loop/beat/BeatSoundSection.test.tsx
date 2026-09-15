import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BEAT_PRESETS, BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import { useAppStore } from '@/store/store';
import { PANEL_CARD_INSET } from '@/components/ui/PanelCard';
import { BEAT_VOICE_META } from './beatVoices';
import { BEAT_CONTROL_SCHEMA } from './beatControlSchema';
import { BeatSoundSection } from './BeatSoundSection';
import { isBeatPatchEdited, stepBeatPreset } from './BeatPresetToolbar';
import type { SoundDepth } from '../useSoundDepth';

/**
 * The Beat editor renders through `renderToString`, so every assertion here is
 * a substring of one HTML string (.claude/rules/testing.md). Two consequences
 * run through the file: state a test sets must be read through `useLiveStore`
 * by the component to be visible at all, and NO assertion can exercise a
 * pointer gesture, a viewport width or a click — the responsive contract is
 * therefore asserted as the RESPONSIVE CLASSES the markup carries, which is
 * what actually implements it in a CSS-first, always-mounted app.
 */
// `activeTab: 'sound'` — the tab this section is only ever shown on, so the
// scope's rAF gate renders the way it does in the app rather than paused.
const render = (depth: SoundDepth = 'simple') =>
  renderToString(<BeatSoundSection depth={depth} activeTab="sound" />);

const baseParams = () => useAppStore.getState().beatParams;

afterEach(() => {
  useAppStore.setState({
    beatParams: { basePresetId: DEFAULT_BEAT_PRESET_ID, ...structuredClone(BEAT_PRESETS[0].patch) },
    customBeatPresets: [],
  });
});

describe('the Beat Sound section', () => {
  test('is one section, and there is no Simple/Pro depth toggle', () => {
    const html = render();
    expect(html.split('>Beat Sound<').length - 1).toBe(1);
    expect(html).not.toContain('btn-beat-mode-simple');
    expect(html).not.toContain('btn-beat-mode-pro');
  });

  test('the bus-level row comes first, and wears no card of its own', () => {
    const html = render();
    const filter = html.indexOf('id="knob-beat-filter-cutoff"');
    const picker = html.indexOf('id="select-beat-preset"');
    const firstVoice = html.indexOf('id="beat-voice-card-kick"');

    // Filter and picker are the one bus-level row, above every voice.
    expect(filter).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(filter);
    expect(firstVoice).toBeGreaterThan(picker);

    // A card in this editor means ONE VOICE, so there are exactly as many
    // inset cards as there are voices. Counting them is what catches the bus
    // filter being given a card again: an ordering assertion would not, since
    // a carded filter sits in the same place.
    const insetCards = html.split(PANEL_CARD_INSET).length - 1;
    expect(insetCards).toBe(BEAT_VOICE_IDS.length);
  });

  test('renders one row per voice, in canonical order, named from the registry', () => {
    const html = render();
    const positions = BEAT_VOICE_IDS.map((id) => html.indexOf(`id="beat-voice-card-${id}"`));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const id of BEAT_VOICE_IDS) {
      expect(html).toContain(BEAT_VOICE_META[id].label);
      expect(html).toContain(BEAT_VOICE_META[id].color);
    }
  });

  test('carries the Beat Sound paste button', () => {
    expect(render()).toContain('id="btn-paste-beat-sound"');
  });

  // The card has no focused voice to tint by (eleven voices, one instrument),
  // so it borrows the ACCENT role instead — the same role the drum-focus chip
  // group already falls back to in SoundFocusChips.
  test('is tinted with the accent role, not a module colour', () => {
    expect(render()).toContain('ring-1 ring-accent/40 tint-accent');
  });
});

/**
 * The eleven voices are an instrument's compartments, in a grid. There is no
 * accordion and no per-card disclosure: a card is never collapsed, so it needs
 * no stand-in for knobs that are off screen and no control to open it.
 *
 * The layout contract is in the CLASSES, not in JS — there is no viewport here
 * and no `matchMedia` in the component — so these assert the class strings
 * that carry it.
 */
describe('the Beat voice grid', () => {
  test('is a one/two/three column grid whose cards keep their own height', () => {
    const html = render();
    // `items-start`: the whole point of a wrapping knob lane is that a short
    // voice is short, and a stretching grid item hands the saved height back
    // as whitespace.
    expect(html).toContain(
      '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 items-start">',
    );
  });

  test('a card lays its knobs out as one wrapping lane', () => {
    const html = render();
    for (const id of BEAT_VOICE_IDS) {
      expect(html).toContain(
        `<div id="beat-voice-card-${id}" class="card-body p-3 gap-2.5">`,
      );
    }
    // The lane carries no breakpoint on purpose: the knobs have a fixed
    // footprint and wrap at whatever width they are given, so a column count
    // that has to track the schema does not exist.
    expect(html).toContain('<div class="flex flex-wrap justify-center gap-1">');
  });

  test('no accordion survives the move to cards', () => {
    const html = render();
    for (const id of BEAT_VOICE_IDS) {
      expect(html).not.toContain(`id="btn-beat-toggle-${id}"`);
      expect(html).not.toContain(`id="beat-voice-body-${id}"`);
      expect(html).not.toContain(`id="btn-beat-more-${id}"`);
    }
    expect(html).not.toContain('aria-expanded');
  });

  /* The header is ONE LINE, the way the synth rack's is: a numbered title run
     on the left, chip and actions on the right. Pinned on the button SIZE
     rather than on the row's markup, because the row's height is set by the
     tallest thing in it and the actions are the only thing in it that can
     grow — a `min-h-11` reintroduced on either button is the regression, and
     it would not move a single ordering or count assertion. The class string
     is matched WHOLE rather than by parts, so a size restored by adding a
     utility fails here too. It cannot be a blanket `min-h-11` sweep over the
     section: the kit row's own picker legitimately carries one. */
  test('Preview and Reset wear the rack-sized action button, not a 44px square', () => {
    const html = render();
    const action = 'class="btn btn-xs btn-square btn-ghost border border-base-300 text-base-content/60"';
    for (const id of BEAT_VOICE_IDS) {
      expect(html).toContain(`id="btn-beat-preview-${id}" type="button" ${action}`);
      expect(html).toContain(`id="btn-beat-reset-${id}" type="button" ${action}`);
    }
  });

  /* The first depth rung is the only one that changes WHAT is on screen: the
     eleven voice cards go, the kit row stays. Asserted in BOTH directions and
     on the kit row's survival, because a gate that hid everything would pass a
     one-sided "no voice cards" check while having removed the one control this
     depth exists to leave behind. */
  test('the bus-only depth drops every voice card and keeps the kit row', () => {
    const html = render('minimal');
    for (const id of BEAT_VOICE_IDS) {
      expect(html).not.toContain(`id="beat-voice-card-${id}"`);
      expect(html).not.toContain(`id="btn-beat-preview-${id}"`);
    }
    expect(html).toContain('id="knob-beat-filter-cutoff"');
    expect(html).toContain('id="select-beat-preset"');
    // The band's own patch-wide gestures are not per-voice and stay put.
    expect(html).toContain('id="btn-beat-quick-save"');
    expect(html).toContain('id="btn-beat-reset-all"');
    // And the deeper rungs still draw them, so the assertions above are not
    // passing on markup that never renders.
    expect(render('simple')).toContain('id="beat-voice-card-kick"');
  });

  /* The roster is a fixed order and the badge is how a reader sees it. Pinned
     against `BEAT_VOICE_IDS`' own index, so a re-ordered roster moves both the
     cards and the numbers together or fails here. */
  test('each card carries its canonical roster number', () => {
    const html = render();
    for (const [index, id] of BEAT_VOICE_IDS.entries()) {
      const card = html.slice(html.indexOf(`id="beat-voice-card-${id}"`));
      expect(card.slice(0, 400)).toContain(`>${index + 1}</span>`);
    }
  });
});

/**
 * The `+N` chip: a section-level depth switch that visibly changes only a
 * minority of the cards reads as broken — the user presses All, some cards
 * change and the rest look like they failed. The chip makes the affected cards
 * legible BEFORE the switch is pressed, so a card WITH a chip has more to show
 * and a card WITHOUT one is complete rather than silent.
 */
describe('the More count chip', () => {
  test('appears at simple, only on a voice whose More set is non-empty', () => {
    const html = render('simple');
    for (const id of BEAT_VOICE_IDS) {
      const count = BEAT_CONTROL_SCHEMA[id].more.length;
      expect(html.includes(`id="beat-voice-chip-${id}"`)).toBe(count > 0);
    }
  });

  // Read off the schema, never a second hand-written list: a re-partitioned
  // schema can then never leave the chip claiming a number nothing renders.
  test('states the number of controls the deeper depth will add', () => {
    const html = render('simple');
    for (const id of BEAT_VOICE_IDS) {
      const count = BEAT_CONTROL_SCHEMA[id].more.length;
      if (count === 0) continue;
      const chip = html.slice(html.indexOf(`id="beat-voice-chip-${id}"`));
      expect(chip.slice(0, chip.indexOf('</span>'))).toContain(`+${count}`);
    }
  });

  test('never appears at pro, where there is nothing left to reveal', () => {
    const html = render('pro');
    for (const id of BEAT_VOICE_IDS) {
      expect(html).not.toContain(`id="beat-voice-chip-${id}"`);
    }
  });
});

describe('the Beat preset toolbar', () => {
  test('lists the factory library and offers Quick Save and Reset All', () => {
    const html = render();
    for (const preset of BEAT_PRESETS) {
      expect(html).toContain(`value="${preset.id}"`);
    }
    expect(html).toContain('id="btn-beat-quick-save"');
    expect(html).toContain('id="btn-beat-reset-all"');
    expect(html).toContain('id="btn-beat-preset-prev"');
    expect(html).toContain('id="btn-beat-preset-next"');
  });

  test('a saved user preset joins the same selector', () => {
    const saved = useAppStore.getState().saveCustomBeatPreset('My Beat', baseParams());
    try {
      const html = render();
      expect(html).toContain(`value="${saved.id}"`);
      expect(html).toContain('My Beat');
    } finally {
      useAppStore.getState().deleteCustomBeatPreset(saved.id);
    }
  });

  /**
   * The carry-forward from Task 5: `setBeatPreset` throws on an id it cannot
   * resolve, deliberately, and deleting a user preset does NOT clean up loops
   * that named it as a base. A loop holding a dangling base must therefore
   * render — saying so — rather than throw.
   */
  test('a base preset that no longer exists reads as Custom patch, and does not throw', () => {
    const saved = useAppStore.getState().saveCustomBeatPreset('Doomed', baseParams());
    useAppStore.getState().deleteCustomBeatPreset(saved.id);
    expect(useAppStore.getState().beatParams.basePresetId).toBe(saved.id);

    const html = render();
    expect(html).toContain('Custom patch');
    // Reset needs a source, and there is none: both resets are disabled.
    expect(html).toContain('id="btn-beat-reset-all" disabled=""');
    expect(html).toContain('id="btn-beat-reset-kick" disabled=""');
  });

  test('Reset Voice and Reset All are live while the base resolves', () => {
    const html = render();
    expect(html).toContain('id="btn-beat-reset-all"');
    expect(html).not.toContain('id="btn-beat-reset-all" disabled=""');
    for (const id of BEAT_VOICE_IDS) {
      expect(html).toContain(`id="btn-beat-reset-${id}"`);
    }
    expect(html).not.toContain('id="btn-beat-reset-kick" disabled=""');
  });
});

describe('the Beat filter panel', () => {
  test('offers the three filter types plus cutoff and resonance', () => {
    const html = render();
    expect(html).toContain('id="btn-beat-filter-lowpass"');
    expect(html).toContain('id="btn-beat-filter-bandpass"');
    expect(html).toContain('id="btn-beat-filter-highpass"');
    expect(html).toContain('id="knob-beat-filter-cutoff"');
    expect(html).toContain('id="knob-beat-filter-resonance"');
  });

  // T-4: the panel had its own `${Math.round(v)} Hz`, which read `12000 Hz` in
  // the filter while every voice frequency two rows below rolled over to kHz.
  // Asserted on the RENDERED readout, so a second inline formatter fails here.
  test('reads its cutoff in the same units the voice knobs use', () => {
    const html = render();
    expect(html).toContain('12 kHz');
    expect(html).not.toContain('12000 Hz');
  });
});

/**
 * Every Primary knob a row can show is a knob for one stored key. Asserted per
 * voice against the schema itself rather than a second list — the schema's own
 * test is what pins the schema to the stored shape.
 */
describe('the voice rows render the schema', () => {
  test('simple shows each voice its Primary set and nothing else', () => {
    const html = render('simple');
    for (const id of BEAT_VOICE_IDS) {
      const { primary, more } = BEAT_CONTROL_SCHEMA[id];
      for (const control of primary) {
        expect(html).toContain(`id="knob-beat-${id}-${control.key}"`);
      }
      for (const control of more) {
        expect(html).not.toContain(`id="knob-beat-${id}-${control.key}"`);
      }
    }
    // The disclosure this depth replaces is gone: there is no per-voice
    // More/Less button on top of the section-level switch.
    expect(html).not.toContain('id="btn-beat-more-kick"');
  });

  /**
   * At `pro` the two sets are ONE set — `more` follows `primary` in the same
   * wrapping lane, not in a second lane below a divider.
   */
  test('pro shows Primary then More, in that order, in one lane', () => {
    const html = render('pro');
    for (const id of BEAT_VOICE_IDS) {
      const { primary, more } = BEAT_CONTROL_SCHEMA[id];
      if (more.length === 0) continue;
      const lastPrimary = html.indexOf(`id="knob-beat-${id}-${primary[primary.length - 1].key}"`);
      const firstMore = html.indexOf(`id="knob-beat-${id}-${more[0].key}"`);
      expect(lastPrimary).toBeGreaterThan(-1);
      expect(firstMore).toBeGreaterThan(lastPrimary);
    }
    expect(html).not.toContain('id="btn-beat-more-kick"');
  });

  /**
   * The ordering check above would stay green even if `more` moved into a
   * second lane below a divider, as long as that lane came after `primary`'s
   * — ordering alone does not prove "one lane". This counts the lane
   * container itself per card and fails if a second one appears at `pro`.
   */
  test('pro packs every knob into a single lane container per card', () => {
    const html = render('pro');
    const LANE_CLASS = 'class="flex flex-wrap justify-center gap-1"';
    for (let i = 0; i < BEAT_VOICE_IDS.length; i += 1) {
      const id = BEAT_VOICE_IDS[i];
      const nextId = BEAT_VOICE_IDS[i + 1];
      const start = html.indexOf(`id="beat-voice-card-${id}"`);
      const end = nextId ? html.indexOf(`id="beat-voice-card-${nextId}"`) : html.length;
      const cardHtml = html.slice(start, end);
      const laneCount = cardHtml.split(LANE_CLASS).length - 1;
      expect(laneCount).toBe(1);
    }
  });

  test('no knob edits the hidden output trim', () => {
    expect(render()).not.toContain('outputTrimDb');
  });
});

/**
 * The toolbar's and the row's pure halves, tested directly rather than through
 * a render: this repo's first testing rule is that a behaviour which can be a
 * function should be one (.claude/rules/testing.md), and none of these three
 * can be exercised by clicking in a runner with no DOM.
 */
describe('Beat toolbar and row derivations', () => {
  const base = BEAT_PRESETS[0];

  test('Edited compares the patch with its base, and is false with no base', () => {
    const params = { basePresetId: base.id, ...structuredClone(base.patch) };
    expect(isBeatPatchEdited(params, base)).toBe(false);
    expect(isBeatPatchEdited(params, undefined)).toBe(false);

    const tweaked = structuredClone(params);
    tweaked.voices.kick.decay = params.voices.kick.decay + 0.01;
    expect(isBeatPatchEdited(tweaked, base)).toBe(true);

    // Provenance is not sound: the comparison is the PATCH against the base's
    // patch, so a loop pointing somewhere else while holding this sound still
    // reads as unedited against this base.
    expect(isBeatPatchEdited({ ...params, basePresetId: 'somewhere-else' }, base)).toBe(false);
    expect(isBeatPatchEdited({ ...params, basePresetId: null }, base)).toBe(false);
  });

  test('stepping wraps around the library and starts over from a dangling base', () => {
    const library = [...BEAT_PRESETS];
    expect(stepBeatPreset(library, library[0].id, 1)?.id).toBe(library[1].id);
    expect(stepBeatPreset(library, library[0].id, -1)?.id).toBe(library[library.length - 1].id);
    expect(stepBeatPreset(library, library[library.length - 1].id, 1)?.id).toBe(library[0].id);
    // A base nothing resolves has no position, so a step starts at the top
    // rather than guessing where it would have sat.
    expect(stepBeatPreset(library, 'user-beat-deleted', 1)?.id).toBe(library[0].id);
    expect(stepBeatPreset(library, null, -1)?.id).toBe(library[0].id);
    expect(stepBeatPreset([], 'anything', 1)).toBeUndefined();
  });

});
