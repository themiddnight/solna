import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { MIXER_CHANNELS, SoundMixer } from './SoundMixer';

describe('MIXER_CHANNELS', () => {
  // The same six layers, in the same order, as LOOP_MIX_CHANNELS in
  // song/SortableLoopCard.tsx. The spec's rule is that nothing may introduce a
  // seventh grouping of the same layers, and a table that drifted in order
  // would be exactly that.
  test('lists the six layers in the canonical order', () => {
    expect(MIXER_CHANNELS.map((c) => c.volumeKey)).toEqual([
      'synthVolume', 'fxVolume', 'chordVolume', 'bassVolume', 'padVolume', 'masterSequencerVolume',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.muteKey)).toEqual([
      'synthMuted', 'fxMuted', 'chordMuted', 'bassMuted', 'padMuted', 'drumMuted',
    ]);
  });

  test('every channel has both a volume setter and a mute toggle', () => {
    expect(MIXER_CHANNELS.map((c) => c.setVolumeKey)).toEqual([
      'setSynthVolume', 'setFxVolume', 'setChordVolume', 'setBassVolume', 'setPadVolume',
      'setMasterSequencerVolume',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.toggleKey)).toEqual([
      'toggleSynthMuted', 'toggleFxMuted', 'toggleChordMuted', 'toggleBassMuted', 'togglePadMuted',
      'toggleDrumMuted',
    ]);
  });

  test('labels are unique and human, and ids are unique', () => {
    expect(new Set(MIXER_CHANNELS.map((c) => c.label)).size).toBe(6);
    expect(new Set(MIXER_CHANNELS.map((c) => c.idPrefix)).size).toBe(6);
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
