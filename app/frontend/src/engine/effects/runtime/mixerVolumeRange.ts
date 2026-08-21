/**
 * The app's standard mix-fader range, in dB (TR-40).
 *
 * Its own module so both the instrument fader (`MixerEngine.setUserVolume`) and the per-peer
 * voice fader (`VoiceVolumeController.setVoiceVolume`) can share one definition — importing it
 * from `MixerEngine` would make `voiceVolumeController → MixerEngine → voiceVolumeController`
 * a cycle. `MixerEngine` re-exports both names, so existing importers are unaffected.
 *
 * `-Infinity` (true mute) deliberately bypasses the floor — see `setUserVolume`.
 */
export const MIXER_VOLUME_MIN_DB = -60;
export const MIXER_VOLUME_MAX_DB = 12;
