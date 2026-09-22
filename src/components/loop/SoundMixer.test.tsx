import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { MIX_GROUP_IDS } from '../mixLayers';
import { MIXER_CHANNELS, MIXER_GROUP_PLACEMENT, SoundMixer } from './SoundMixer';

/** The full opening tag of the element whose markup contains `needle` — pins the tag name, not text position. */
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

describe('MIXER_CHANNELS', () => {
  // The same six layers, in the same order, as LOOP_MIX_CHANNELS in
  // song/SortableLoopCard.tsx. The spec's rule is that nothing may introduce a
  // seventh grouping of the same layers, and a table that drifted in order
  // would be exactly that.
  test('lists the six layers in the canonical order', () => {
    expect(MIXER_CHANNELS.map((c) => c.idPrefix)).toEqual([
      'synth', 'fx', 'chord', 'bass', 'pad', 'drum',
    ]);
  });

  /**
   * Each row reads and patches ITS OWN half of the mix. A row is no longer a
   * pair of key names, so this is behavioural: build a mix out of one row's
   * own patches and read it back through that same row's accessors. A row that
   * patched one layer and read another — the transposition the key-name pair
   * used to make visible by eye — comes back with the wrong value here.
   */
  test('every row reads back exactly what its own patch wrote', () => {
    const base = useAppStore.getState();
    for (const channel of MIXER_CHANNELS) {
      const mix = { ...base, ...channel.levelPatch(-13, base) };
      const muted = { ...mix, ...channel.mutePatch(true, mix) };
      expect([channel.idPrefix, channel.readLevelDb(muted), channel.readMuted(muted)])
        .toEqual([channel.idPrefix, -13, true]);
      // And it wrote nothing anyone else reads: every OTHER row still reads
      // the value it started on.
      for (const other of MIXER_CHANNELS) {
        if (other.idPrefix === channel.idPrefix) continue;
        expect([channel.idPrefix, other.idPrefix, other.readLevelDb(muted)])
          .toEqual([channel.idPrefix, other.idPrefix, other.readLevelDb(base)]);
      }
    }
  });

  /**
   * The Beat row's patch must carry the eleven per-voice faders through. They
   * live inside the same object as the bus level, so a patch built as
   * `{ beatMix: { levelDb } }` would silently drop every one of them.
   */
  test('the Beat row keeps the per-voice mix its patch travels inside', () => {
    const base = useAppStore.getState();
    const beat = MIXER_CHANNELS.find((c) => c.idPrefix === 'drum')!;
    const patched = { ...base, ...beat.levelPatch(-9, base) };
    expect(patched.beatMix.voices).toEqual(base.beatMix.voices);
    expect(patched.beatMix.levelDb).toBe(-9);
  });

  test('every channel has both a volume setter and a mute toggle', () => {
    expect(MIXER_CHANNELS.map((c) => c.setVolumeKey)).toEqual([
      'setSynthVolume', 'setFxVolume', 'setChordVolume', 'setBassVolume', 'setPadVolume',
      'setBeatLevel',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.toggleKey)).toEqual([
      'toggleSynthMuted', 'toggleFxMuted', 'toggleChordMuted', 'toggleBassMuted', 'togglePadMuted',
      'toggleBeatMuted',
    ]);
  });

  test('labels are unique and human, and ids are unique', () => {
    expect(new Set(MIXER_CHANNELS.map((c) => c.label)).size).toBe(6);
    expect(new Set(MIXER_CHANNELS.map((c) => c.idPrefix)).size).toBe(6);
  });
});

describe('per-track send knobs', () => {
  const html = renderToString(<SoundMixer />);
  const EFFECTS = [
    ['reverb', 'reverb send'],
    ['delay', 'delay send'],
    ['distortion', 'distortion send'],
  ] as const;
  const valueNow = (id: string) => openTagContaining(html, `id="${id}"`).match(/aria-valuenow="([^"]+)"/)?.[1];

  test('every row carries Rev, Dly and Dist: eighteen knobs, named for their row', () => {
    for (const c of MIXER_CHANNELS) {
      for (const [effect, name] of EFFECTS) {
        expect(openTagContaining(html, `id="knob-send-${c.idPrefix}-${effect}"`))
          .toContain(`aria-label="${c.label} ${name}"`);
      }
    }
    expect(html.match(/id="knob-send-/g)).toHaveLength(18);
  });

  test("each row shows its own committed sends: Beat is dry into delay and distortion", () => {
    expect(valueNow('knob-send-drum-reverb')).toBe('1');
    expect(valueNow('knob-send-drum-delay')).toBe('0');
    expect(valueNow('knob-send-drum-distortion')).toBe('0');
    expect(valueNow('knob-send-chord-delay')).toBe('1');
    expect(openTagContaining(html, 'id="knob-send-drum-delay"')).toContain('aria-valuetext="0%"');
  });
});

describe('SoundMixer', () => {
  const html = renderToString(<SoundMixer />);

  test('renders six faders', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`id="slider-${c.idPrefix}-layer-volume"`);
    }
  });

  test('renders six mutes, including the two that had no UI before', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`id="btn-mix-mute-${c.idPrefix}"`);
    }
    expect(html).toContain('id="btn-mix-mute-synth"');
    expect(html).toContain('id="btn-mix-mute-drum"');
  });

  // All six channels default to unmuted (MixerRow's `muted` selector reads
  // the store's initial state, which starts every *Muted field false). An
  // inverted mute — `on={muted}` instead of `on={!muted}` — leaves every
  // other assertion in this file green, since ids and slider markup don't
  // encode polarity at all. PowerToggle's `actionTitle` does: `on` true means
  // "the layer is currently audible", so the tooltip must offer to Mute it,
  // never Unmute it, while unmuted.
  test('every mute button, unmuted by default, offers to Mute (not Unmute)', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`title="Mute ${c.label}"`);
      expect(html).not.toContain(`title="Unmute ${c.label}"`);
    }
  });
});

describe('the mixer has no solo column', () => {
  test('SoundMixer renders no solo control (spec §4)', () => {
    const html = renderToString(<SoundMixer />);
    expect(html).not.toContain('btn-solo-');
    expect(html).not.toContain('Solo ');
  });

  test('and its source names no solo module', () => {
    const source = readFileSync('src/components/loop/SoundMixer.tsx', 'utf8');
    expect(source).not.toContain('SoloButton');
    expect(source).not.toContain('soloTracks');
  });
});

describe('the wide-screen two-column placement', () => {
  // Every group is placed by hand, so the guard that matters is not "does the
  // record have six keys" — the `Record<MixGroupId, …>` type already refuses a
  // missing one — but "does any two of them name the same cell". Two groups
  // sharing a `col-start`/`row-start` pair stack on top of each other in the
  // grid: no error, no failing type, just one group drawn over another at `lg`
  // and nowhere below it.
  test('no two groups are placed on the same grid cell', () => {
    const cells = MIX_GROUP_IDS.map((id) => {
      const classes = MIXER_GROUP_PLACEMENT[id].split(/\s+/);
      const col = classes.find((c) => c.includes('col-start-'));
      const row = classes.find((c) => c.includes('row-start-'));
      // A group placed on no cell at all is the same bug arriving by omission:
      // it falls into grid auto-flow and lands wherever the others left a hole.
      expect(col, `${id} names no column`).toBeDefined();
      expect(row, `${id} names no row`).toBeDefined();
      return `${col} ${row}`;
    });
    expect(new Set(cells).size).toBe(MIX_GROUP_IDS.length);
  });

  // The point of the whole layout: below `lg` the groups are one column in
  // MIX_GROUP_IDS order, so Beat stays last. A placement class that forgot its
  // `lg:` prefix would move Beat up into the middle on a phone.
  test('every placement class is gated behind the lg breakpoint', () => {
    for (const id of MIX_GROUP_IDS) {
      for (const cls of MIXER_GROUP_PLACEMENT[id].split(/\s+/)) {
        expect(cls, `${id}: ${cls}`).toMatch(/^lg:/);
      }
    }
  });
});

describe('a mixer row sets focus', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('every row carries a focus button', () => {
    const html = renderToString(<SoundMixer />);
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-mix-focus-${id}"`);
  });

  // aria-current is what tells a screen reader which row is the one being
  // edited, and it is the only visible difference between the six rows.
  test('the focused row is marked, and only that one', () => {
    useAppStore.setState({ focusTrack: 'chord' });
    const html = renderToString(<SoundMixer />);
    expect(openTagContaining(html, 'id="btn-mix-focus-chord"')).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/g)?.length).toBe(1);
  });
});
