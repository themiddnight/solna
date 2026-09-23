import React, { useCallback, useMemo, useState } from 'react';
import { Bookmark, Drum, RotateCcw } from 'lucide-react';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { useAppStore } from '@/store/store';
import { BEAT_PREVIEW_VELOCITY, ensureDrumEngine, triggerPad } from '@/audio/playback/drumPlayback';
import { SectionCard } from '@/components/ui/SectionCard';
import { useLiveStore } from '@/components/ui/useLiveStore';
import { ModulePasteButton } from '../ModulePasteButton';
import { SoundScope } from '../SoundScope';
import { MIX_LAYER_LABELS } from '@/components/mixLayers';
import { BeatFilterPanel } from './BeatFilterPanel';
import { BeatPresetToolbar } from './BeatPresetToolbar';
import { QuickSavePopover } from '@/components/ui/QuickSavePopover';
import { BeatVoiceGrid } from './BeatVoiceGrid';
import { useBeatParamDraft } from './useBeatParamDraft';
import type { BeatFilterParams, BeatParams, BeatPreset, BeatVoiceId, BeatVoices } from '@/types';
import type { SoundDepth } from '../useSoundDepth';

/**
 * The one preset list the toolbar reads, and the entry the current patch is
 * based on.
 *
 * Memoized on the library alone, because this array's IDENTITY is a prop of the
 * toolbar: rebuilding it every render made every knob pointermove during a drag
 * push a new `presets` down, which re-ran the toolbar's two `filter` passes and
 * re-rendered 13+N `<option>` elements for a list that only changes when a
 * preset is saved or deleted.
 *
 * Factory first, then the user's own: ONE list, built from the live library,
 * and the only source of ids the toolbar can hand back. `setBeatPreset` throws
 * on an id it cannot resolve, so nothing here may invent one.
 */
function useBeatPresetLibrary(
  customBeatPresets: readonly BeatPreset[],
  basePresetId: string | null,
): { presets: readonly BeatPreset[]; base: BeatPreset | undefined } {
  const presets = useMemo<readonly BeatPreset[]>(
    () => [...BEAT_PRESETS, ...customBeatPresets],
    [customBeatPresets],
  );
  const base = useMemo(
    () => presets.find((preset) => preset.id === basePresetId),
    [presets, basePresetId],
  );
  return { presets, base };
}

/**
 * Saves the live Beat patch to the user library and confirms it through the
 * feedback host (key `beat-preset`, R330) — the save had no confirmation of
 * its own before.
 */
export function saveBeatPreset(name: string, params: BeatParams): BeatPreset {
  const { saveCustomBeatPreset, showFeedback } = useAppStore.getState();
  const saved = saveCustomBeatPreset(name, params);
  showFeedback({ key: 'beat-preset', message: `Saved Beat preset "${saved.name}"`, tone: 'success' });
  return saved;
}

/** One voice parameter written into a draft patch, rebuilding only that voice.
 *
 *  The cast is the one `readBeatParam` documents from the other direction:
 *  `BeatVoices` is heterogeneous on purpose, so a runtime key has no type. It
 *  is contained here rather than spread across the rows. */
function withVoiceParam(
  voices: BeatVoices,
  voice: BeatVoiceId,
  key: string,
  value: number,
): BeatVoices {
  return {
    ...voices,
    [voice]: { ...(voices[voice] as unknown as Record<string, number>), [key]: value },
  } as BeatVoices;
}

/** Props for {@link BeatSoundSection}. */
export interface BeatSoundSectionProps {
  /** The DRUM-scope depth (see `DepthScope` in `useSoundDepth.ts`): a Beat
   *  preference held independently of the melodic one, so going deep on the
   *  synth never drags Beat's editor along with it. On this section its three
   *  rungs read `Simple`/`Essential`/`All`, never Simple/Pro: Beat has no
   *  second parameter model for a "Pro" to switch to. The first rung is the
   *  only one that changes WHAT is on screen rather than how much of it —
   *  `minimal` drops the voice grid and leaves the kit row. */
  depth: SoundDepth;
  /** The tab the app is showing, for the scope's rAF gate. Passed down rather
   *  than read here for the same reason the Synth section takes it: SoundView
   *  owns the tab, and every view stays mounted, so a section that read the
   *  tab for itself would be a second place that has to remember to pause. */
  activeTab: string;
}

/** The Beat card's own tint: the ACCENT role, not a module token — see the
 *  card's docblock for why. Built the same shape `SYNTH_TARGET_STYLES`
 *  builds a target's tint (a ring plus a background tint), as literal
 *  classes: Tailwind v4 scans source statically, so nothing here may be
 *  assembled at runtime. */
const BEAT_TINT_CLASS = 'ring-1 ring-accent/40 tint-accent';

/**
 * The band's right-hand cell: the patch-wide gestures, in the cell the Synth
 * section keeps its own pair in. Its own component for the reason
 * `SynthSectionActions` is one — the section's function is already at this
 * repo's line ceiling, and a three-button cluster is one idea.
 */
function BeatSectionActions({
  base,
  isSaving,
  saveName,
  onOpenQuickSave,
  onCloseQuickSave,
  onSaveNameChange,
  onQuickSaveSubmit,
  onResetAll,
}: {
  /** The resolved base preset, or undefined when the loop names none. */
  base: BeatPreset | undefined;
  isSaving: boolean;
  saveName: string;
  onOpenQuickSave: () => void;
  onCloseQuickSave: () => void;
  onSaveNameChange: (name: string) => void;
  onQuickSaveSubmit: (e: React.FormEvent) => void;
  onResetAll: () => void;
}) {
  return (
    <>
      <QuickSavePopover
        open={isSaving}
        onOpen={onOpenQuickSave}
        onClose={onCloseQuickSave}
        trigger={{
          id: 'btn-beat-quick-save',
          label: 'Save',
          icon: <Bookmark className="w-3.5 h-3.5 text-secondary" />,
          className: 'btn btn-sm btn-ghost gap-1 border border-base-300 text-xs font-semibold',
          title: 'Save Beat preset',
        }}
        heading="Save Beat Preset:"
        placeholder="Preset Name..."
        saveLabel="Save Beat"
        name={saveName}
        onNameChange={onSaveNameChange}
        onSubmit={onQuickSaveSubmit}
      />
      {/* Source-dependent: a reset copies from the base preset, and there is
          nothing to copy from when the base cannot be resolved. */}
      <button
        id="btn-beat-reset-all"
        disabled={base === undefined}
        type="button"
        className="btn btn-sm btn-ghost gap-1 border border-base-300 text-xs font-semibold"
        title={base ? `Reset every voice to ${base.name}` : 'This patch has no preset to reset to'}
        onClick={onResetAll}
      >
        <RotateCcw className="w-3.5 h-3.5 text-secondary" />
        <span className="hidden sm:inline">Reset All</span>
      </button>
      <ModulePasteButton groups={['beat-sound']} />
    </>
  );
}

/**
 * The Beat instrument's sound editor, and the ONLY one: preset toolbar, the
 * Beat-wide filter, then one card per voice in canonical order.
 *
 * The card wears the ACCENT tint: Synth tints by the focused TRACK, but Beat
 * is one instrument holding eleven voices of different colours, so there is
 * no single focused voice to take a colour from — tinting by voice would be
 * picking one of eleven arbitrarily. Accent is already the role a drum focus
 * reads as elsewhere on this tab (`SoundFocusChips` in `SoundView.tsx` falls
 * back to `border-accent` when there is no synth target), so this card and
 * that chip read as the same kind of surface rather than introducing a
 * `--module-beat` token nothing else would use. The eleven voice cards
 * underneath stay untinted — `PanelCard`'s `inset` and `tint` are mutually
 * exclusive by construction, and a voice's colour identity already lives in
 * its own header chip and knob tints.
 *
 * NO SIMPLE/PRO SPLIT. Beat has one detailed editor by design — every knob
 * maps to exactly one stored parameter and Primary/More is disclosure, not a
 * second parameter model. The tab's depth switch therefore reaches this
 * section under DIFFERENT WORDS — `Simple`, `Essential` and `All`, from
 * `soundDepthOptions` — and its first rung hides the voice grid outright
 * rather than thinning it, which is a change of SCOPE, not of parameter model. It is also its OWN stored value, held in the drum
 * scope `useSoundDepth` keeps beside the melodic one: depth fluency is per
 * instrument, so someone at home in the synth's Pro rack may still want the
 * drums at Essential. Calling this side "Pro" would make one word mean two
 * things in one app and would contradict the paragraph above it.
 *
 * THE DRAFT IS THE WHOLE AUDIO STORY. Pointer moves write
 * `useBeatParamDraft`'s local draft and preview it through
 * `store/beatPreview.ts`; pointerup commits ONCE through `setBeatParams`;
 * pointercancel restores the committed sound and writes nothing. No component
 * here imports the engine — the preview module and the drum playback bridge
 * are the two doors, and both live outside `src/components/`.
 *
 * `useLiveStore`, not `useAppStore`, for the values a test sets before
 * rendering: zustand serves the store's CREATION-time state to
 * `renderToString` otherwise (.claude/rules/testing.md).
 */
export const BeatSoundSection = React.memo(function BeatSoundSection({ depth, activeTab }: BeatSoundSectionProps) {
  const beatParams = useLiveStore((s) => s.beatParams);
  const activeLoopId = useLiveStore((s) => s.activeLoopId);
  const customBeatPresets = useLiveStore((s) => s.customBeatPresets);

  // useLiveStore: a test sets `beatMix` before rendering, and only this hook
  // serves getState() for the server snapshot (.claude/rules/testing.md).
  const mutedVoices = useLiveStore((s) => s.beatMix.voices);
  const setBeatParams = useAppStore((s) => s.setBeatParams);
  const setBeatPreset = useAppStore((s) => s.setBeatPreset);
  const resetBeatParams = useAppStore((s) => s.resetBeatParams);
  const resetBeatVoice = useAppStore((s) => s.resetBeatVoice);

  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState('');

  const { draft, update, commit, cancel } = useBeatParamDraft(
    beatParams,
    activeLoopId,
    setBeatParams,
  );

  const { presets, base } = useBeatPresetLibrary(customBeatPresets, beatParams.basePresetId);
  const baseResolves = base !== undefined;

  const draftFilter = (patch: Partial<BeatFilterParams>) =>
    update((params: BeatParams) => ({ ...params, filter: { ...params.filter, ...patch } }));

  // `useCallback`: unbound, reaches every `BeatVoiceCard` via `BeatVoiceGrid`
  // — a fresh identity here fails `BeatVoiceCard`'s `React.memo` for all 11.
  const draftVoiceParam = useCallback(
    (voice: BeatVoiceId, key: string, value: number) =>
      update((p: BeatParams) => ({ ...p, voices: withVoiceParam(p.voices, voice, key, value) })),
    [update],
  );

  // `init()` is idempotent but not free, so it runs on the tap, not per hit.
  const preview = useCallback((voice: BeatVoiceId) => {
    ensureDrumEngine();
    triggerPad(voice, BEAT_PREVIEW_VELOCITY);
  }, []);

  return (
    <SectionCard
      icon={Drum}
      title="Beat Sound"
      tint={BEAT_TINT_CLASS}
      /* The Beat bus's own scope, the counterpart of the Synth band's. It taps
         `'sequencer'` — the engine's name for the drum bus, which predates
         Beat being an instrument rather than a kit name — and traces in
         ACCENT, the role this card is already tinted with. There is no
         per-voice scope: the tap is the bus, so one well shows the whole kit,
         which is also the only thing a Preview tap or a running pattern can
         put through it. */
      monitor={
        <SoundScope
          source="sequencer"
          label={MIX_LAYER_LABELS.drum}
          colorTheme="accent"
          paused={activeTab !== 'sound'}
        />
      }
      /* Quick Save, Reset All, paste — the patch-wide gestures, in the band's
         actions cell, which is where the Synth section keeps its own pair.
         They used to ride the kit row below, where a control that rewrites
         every voice sat beside the control that picks a kit and read as one
         more way to browse the library. */
      actions={
        <BeatSectionActions
          base={base}
          isSaving={isSaving}
          saveName={saveName}
          onOpenQuickSave={() => {
            setSaveName(base ? `${base.name} Edit` : 'My Beat');
            setIsSaving(true);
          }}
          onCloseQuickSave={() => setIsSaving(false)}
          onSaveNameChange={setSaveName}
          onQuickSaveSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            saveBeatPreset(saveName, beatParams);
            setIsSaving(false);
          }}
          onResetAll={resetBeatParams}
        />
      }
    >
      {/* The KIT ROW: everything here is bus-level — how the whole kit is
          filtered, and which kit it is. Everything below it is per-voice.
          That split is why the filter is not a card: a card in this editor
          means one voice. Wraps as two groups rather than four controls, so a
          narrow viewport stacks filter over picker instead of shuffling a
          knob under a menu. */}
      <div className="flex items-end justify-between gap-x-5 gap-y-3 flex-wrap">
        <BeatFilterPanel
          filter={draft.filter}
          onDraft={draftFilter}
          onCommit={commit}
          onCancel={cancel}
        />

        <BeatPresetToolbar params={beatParams} presets={presets} onSelect={setBeatPreset} />
      </div>

      {/* `minimal` UNMOUNTS the grid rather than hiding it. Nothing in a voice
          card subscribes to a clock or holds an analyser — the knobs read the
          draft and the Preview button is inert until pressed — so there is no
          audio or animation reason to keep eleven cards mounted with `hidden`,
          and unmounting is what actually returns the height. It changes no
          sound: depth is a view preference that reaches no store slice and no
          engine setter, so a hidden voice still plays. */}
      {depth !== 'minimal' && (
        <BeatVoiceGrid
          voices={draft.voices}
          depth={depth}
          onPreview={preview}
          onDraft={draftVoiceParam}
          onCommit={commit}
          onCancel={cancel}
          onResetVoice={resetBeatVoice}
          resetDisabled={!baseResolves}
          mutedVoices={mutedVoices}
        />
      )}
    </SectionCard>
  );
});
