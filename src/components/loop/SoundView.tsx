import React from "react";
import { Disc3 } from "lucide-react";
import { useAppStore } from "@/store/store";
import { useLiveStore } from "../ui/useLiveStore";
import { synthTargetForFocus, type MixLayerId } from "@/store/focusTrack";
import type { SynthControlTarget } from "@/utils/synthControl";
import type { LoopCopyGroupId } from "@/store/loopCopy";
import { DRUM_KITS } from "@/data/drumKits";
import { SectionCard } from "../ui/SectionCard";
import { ModulePasteButton } from "./ModulePasteButton";
import { Knob } from "../ui/Knob";
import { Field } from "../ui/Field";
import { FIELD_SELECT } from "../ui/fieldClasses";
import { SoundMixer } from "./SoundMixer";
import { SoundSynthSection } from "./SoundSynthSection";

// Re-exported for scripts/check-key-bindings.ts, which asserts that the synth
// key bindings never collide with the drum-pad shortcuts. The table itself
// lives in ui/Keyboard.tsx; this is the historical import path.
export { KEYBOARD_NOTES } from "../ui/Keyboard";

// Re-exported for the test that pins the rule which closes the synth-only
// overlays on a drum focus; it lives with the code that reads it.
export { shouldCloseSynthOverlays } from "./synth/synthPresetBrowser";

/**
 * The sound group the Synth band's paste button names, per focused target.
 *
 * A table, NOT `synthTarget === 'fx' ? ['fx-sound'] : ['lead-sound']`. This
 * band edits whichever patch `synthTarget` names, and `synthTargetForFocus` is
 * `controlTargetForFocus` for EVERY melodic focus — chord, bass and pad
 * included, not just Lead and FX (`isMelodicFocus` is `focus !== 'drum'`). A
 * two-way test therefore put a Lead paste button on the chord patch's own
 * band: the button wrote the clipboard's Lead sound into `synthParams` while
 * the user was looking at `chordSynthParams`, with no error anywhere.
 *
 * Keyed by the union, so a sixth target is a compile error here rather than a
 * call site falling through to Lead — the shape `resolveSynthControlChannel`'s
 * `channels` table already uses for the same reason. Exported so the mapping
 * itself is testable: the source-text pin this replaced could only assert that
 * the two strings appear, which is exactly what the defect satisfied.
 *
 * It is passed to the Synth section rather than read there, so the tab keeps
 * naming what its own bands write, and the section's markup keeps rendering it.
 */
export const SYNTH_SOUND_GROUP: Record<SynthControlTarget, LoopCopyGroupId> = {
  synth: 'lead-sound',
  fx: 'fx-sound',
  chord: 'chord-sound',
  bass: 'bass-sound',
  pad: 'pad-sound',
};

// The kit roster never changes at runtime, so it is read once here rather than
// re-keyed on every render — a Knob drag re-renders this view per pointermove.
// Module-scope resolution is fine in `components/`; it is `src/data/` that may
// not (CLAUDE.md, layer 1).
const DRUM_KIT_NAMES = Object.keys(DRUM_KITS);


const DrumSoundCard = React.memo(function DrumSoundCard() {
  const soundKit = useAppStore((s) => s.soundKit);
  const onChangeSoundKit = useAppStore((s) => s.setSoundKit);
  const drumFilterCutoff = useAppStore((s) => s.drumFilterCutoff);
  const drumFilterResonance = useAppStore((s) => s.drumFilterResonance);
  const drumFilterType = useAppStore((s) => s.drumFilterType);
  const setDrumFilterCutoff = useAppStore((s) => s.setDrumFilterCutoff);
  const setDrumFilterResonance = useAppStore((s) => s.setDrumFilterResonance);
  const setDrumFilterType = useAppStore((s) => s.setDrumFilterType);

  /* Drum Sound — kit and filter. Moved here from the sequencer: all of it
      changes how the kit SOUNDS and none of it changes a note, which is the
      Sound/Pattern boundary rule. The grid that picks these notes lives on
      Pattern › Beat. The bus level left this card for the Mixer below, so
      that the drum bus is balanced against the other four and not alone. **/
  return (
    <SectionCard
      icon={Disc3}
      title="Drum Sound"
      actions={<ModulePasteButton groups={['drums-sound']} />}
    >
        {/* items-start + a shared lane per field: bottom-aligning controls of
            three different heights (32px select, 24px join, 48px knob) put
            these labels on different baselines. */}
        <div className="flex items-start gap-5 flex-wrap">
          <Field label="Kit" htmlFor="select-sequencer-sound-kit">
            <select
              id="select-sequencer-sound-kit"
              value={soundKit}
              onChange={(e) => onChangeSoundKit(e.target.value)}
              className={FIELD_SELECT}
              title="Drum kit — the sounds each track plays"
            >
              {DRUM_KIT_NAMES.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Filter">
            <div className="join">
              {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-drum-filter-${t}`}
                  onClick={() => setDrumFilterType(t)}
                  className={`btn btn-sm join-item text-[10px] font-semibold uppercase ${
                    drumFilterType === t ? "btn-secondary" : "btn-ghost"
                  }`}
                >
                  {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                </button>
              ))}
            </div>
          </Field>

          {/* `size="sm"` (36px), not the app-wide default 48px: every other
              knob is the main content of its own card, these two are one
              field in a row. No `label` — the stacked one above says it, so
              the knob renders its value readout alone. */}
          <Field label="Cutoff">
            <Knob
              id="knob-drum-filter-cutoff"
              size="sm"
              color="text-secondary"
              layout="horizontal"
              value={drumFilterCutoff}
              min={50}
              max={12000}
              step={10}
              scale="log"
              format={(v) => `${Math.round(v)} Hz`}
              onChange={setDrumFilterCutoff}
            />
          </Field>

          <Field label="Res">
            <Knob
              id="knob-drum-filter-resonance"
              size="sm"
              color="text-secondary"
              layout="horizontal"
              value={drumFilterResonance}
              min={0.1}
              max={20}
              step={0.1}
              scale="linear"
              format={(v) => v.toFixed(1)}
              onChange={setDrumFilterResonance}
            />
          </Field>
        </div>
    </SectionCard>
  );
});

/**
 * The Sound tab: the Synth section (its own module — it owns the channel
 * routing, the preset browser and both overlays), the Drum Sound card that
 * takes the Synth section's place on a drum focus, and the one mixer.
 */
export const SoundView = React.memo(function SoundView() {
  // useLiveStore, not useAppStore: the Drum Sound card's gate below derives
  // from this value, and only useLiveStore serves getState() on the server
  // snapshot renderToString uses — see useLiveStore.ts and testing.md.
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useAppStore((s) => s.setFocusTrack);
  // App keeps every view mounted (block/hidden) so audio survives a tab
  // switch, which means the section's oscilloscope rAF loop must be gated on
  // this or it runs forever behind a hidden tab.
  const activeTab = useAppStore((s) => s.activeTab);
  const synthTarget = synthTargetForFocus(focusTrack);

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      <SoundSynthSection
        focusTrack={focusTrack as MixLayerId}
        activeTab={activeTab}
        onFocus={setFocusTrack}
        soundGroups={SYNTH_SOUND_GROUP}
      />

      {/* A drum focus has no synth channel to show a kit for — Drum Sound
          takes its place instead, below. */}
      {synthTarget === null && <DrumSoundCard />}

      {/* The one mixer: every layer's level and mute, including the drum bus
          whose level used to be a lone strip in the card above. */}
      <SoundMixer />
    </div>
  );
});
