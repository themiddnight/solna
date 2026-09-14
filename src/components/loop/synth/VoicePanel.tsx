import type { CommonVoiceParams } from '@/types/synth';
import { KnobGrid, ModuleChip, ProModule, ToggleRow, type PatchPanelProps } from './proControls';

/**
 * Pro-Mode module 7 — Voice (prototype Variant A's modulation row).
 *
 * Five controls, and the fifth is WIDTH, not Drift. The prototype draws a Drift
 * knob; `CommonVoiceParams` has no analog-drift parameter, this change
 * deliberately does not add one, and a knob that writes nowhere is worse than a
 * missing knob because it looks like it works. Width takes that slot, which is
 * also what gives Simple's Width a canonical Pro parameter to be a lossless
 * view of (`common.stereoWidth`).
 *
 * The two spread-ish names are pinned by the design and must not drift under a
 * synonym: **Spread** is `common.unisonDetuneCents`, **Width** is
 * `common.stereoWidth`.
 *
 * It wears `module-env-vca`, the amplitude stage's identity, which ENV 1 also
 * wears — see `proControls.ts`'s `ProModuleColor` note for why a tenth module
 * hue was rejected.
 */
const VOICE_COLOR = 'text-module-env-vca' as const;

export function VoicePanel({ patch, onPatch }: PatchPanelProps) {
  const common = patch.common;
  const write = (next: Partial<CommonVoiceParams>) =>
    onPatch({ ...patch, common: { ...common, ...next } });

  return (
    <ProModule
      badge={7}
      title="Voice"
      color={VOICE_COLOR}
      chip={
        <ModuleChip color={VOICE_COLOR}>
          {common.voiceMode === 'poly' ? `POLY ${common.unisonVoices}` : 'MONO'}
        </ModuleChip>
      }
    >
      <ToggleRow
        idPrefix="btn-voice-mode"
        caption="Voicing"
        color={VOICE_COLOR}
        value={common.voiceMode}
        options={[
          { value: 'mono', label: 'MONO, monophonic', content: 'MONO' },
          { value: 'poly', label: 'POLY, polyphonic', content: 'POLY' },
        ]}
        onSelect={(voiceMode) => write({ voiceMode })}
      />

      <KnobGrid
        color={VOICE_COLOR}
        specs={[
          {
            id: 'slider-voice-unison',
            label: 'Unison',
            value: common.unisonVoices,
            min: 1,
            max: 8,
            step: 1,
            format: (v) => String(Math.round(v)),
            onChange: (unisonVoices) => write({ unisonVoices }),
          },
          {
            id: 'slider-voice-spread',
            label: 'Spread',
            value: common.unisonDetuneCents,
            min: 0,
            max: 100,
            step: 1,
            format: (v) => `${Math.round(v)} ct`,
            onChange: (unisonDetuneCents) => write({ unisonDetuneCents }),
          },
          {
            id: 'slider-voice-glide',
            label: 'Glide',
            value: common.glideSeconds,
            min: 0,
            max: 5,
            step: 0.01,
            format: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
            onChange: (glideSeconds) => write({ glideSeconds }),
          },
          {
            id: 'slider-voice-width',
            label: 'Width',
            value: common.stereoWidth,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${Math.round(v * 100)}%`,
            onChange: (stereoWidth) => write({ stereoWidth }),
          },
        ]}
      />
    </ProModule>
  );
}
