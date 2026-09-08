import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { MIXER_CHANNELS, SoundMixer } from './SoundMixer';

describe('MIXER_CHANNELS', () => {
  // The same five layers, in the same order, as LOOP_MIX_CHANNELS in
  // song/SortableLoopCard.tsx. The spec's rule is that nothing may introduce a
  // sixth grouping of the same layers, and a table that drifted in order would
  // be exactly that.
  test('lists the five layers in the canonical order', () => {
    expect(MIXER_CHANNELS.map((c) => c.volumeKey)).toEqual([
      'synthVolume', 'chordVolume', 'bassVolume', 'padVolume', 'masterSequencerVolume',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.muteKey)).toEqual([
      'synthMuted', 'chordMuted', 'bassMuted', 'padMuted', 'drumMuted',
    ]);
  });

  test('every channel has both a volume setter and a mute toggle', () => {
    expect(MIXER_CHANNELS.map((c) => c.setVolumeKey)).toEqual([
      'setSynthVolume', 'setChordVolume', 'setBassVolume', 'setPadVolume',
      'setMasterSequencerVolume',
    ]);
    expect(MIXER_CHANNELS.map((c) => c.toggleKey)).toEqual([
      'toggleSynthMuted', 'toggleChordMuted', 'toggleBassMuted', 'togglePadMuted',
      'toggleDrumMuted',
    ]);
  });

  test('labels are unique and human, and ids are unique', () => {
    expect(new Set(MIXER_CHANNELS.map((c) => c.label)).size).toBe(5);
    expect(new Set(MIXER_CHANNELS.map((c) => c.idPrefix)).size).toBe(5);
  });
});

describe('SoundMixer', () => {
  const html = renderToString(<SoundMixer />);

  test('renders five faders', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`id="slider-${c.idPrefix}-layer-volume"`);
    }
  });

  test('renders five mutes, including the two that had no UI before', () => {
    for (const c of MIXER_CHANNELS) {
      expect(html).toContain(`id="btn-mix-mute-${c.idPrefix}"`);
    }
    expect(html).toContain('id="btn-mix-mute-synth"');
    expect(html).toContain('id="btn-mix-mute-drum"');
  });
});
