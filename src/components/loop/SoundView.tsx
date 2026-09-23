import React from "react";
import { useAppStore } from "@/store/store";
import { useLiveStore } from "../ui/useLiveStore";
import {
  MIX_LAYER_IDS,
  controlTargetForFocus,
  isMelodicFocus,
  melodyTrackForFocus,
  synthTargetForFocus,
  type MixLayerId,
} from "@/store/focusTrack";
import { soloTrackForFocus } from "@/store/trackAudibility";
import type { SynthControlTarget } from "@/utils/synthControl";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
import type { LoopCopyGroupId } from "@/store/loopCopy";
import { BeatSoundSection } from "./beat/BeatSoundSection";
import { SoundMixer } from "./SoundMixer";
import { SoundSynthSection } from "./SoundSynthSection";
import { ViewHeader } from "../ui/ViewHeader";
import { SegmentedButton, SegmentedGroup } from "../ui/SegmentedControl";
import { soundDepthOptions, useSoundDepth } from "./useSoundDepth";
import { SoloButton } from "../ui/SoloButton";
import { GroupFrame } from "../ui/GroupFrame";
import { MIX_LAYER_LABELS } from "../mixLayers";

// Re-exported for scripts/check-key-bindings.ts, which asserts that the synth
// key bindings never collide with the drum-pad shortcuts. The table itself
// lives in ui/Keyboard.tsx; this is the historical import path.
export { KEYBOARD_NOTES } from "../ui/Keyboard";

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

// The two MELODY focuses render as bare chips, the three accompaniment ones go
// in the framed group, and Beat sits last on its own — the same pitched-first,
// rhythm-after order MIX_LAYERS uses. Derived from the roster rather than
// hand-listed so a seventh layer renders somewhere instead of silently
// nowhere, and the melody split asks the store which focuses ARE melody tracks
// rather than testing `!== 'synth'`: FX is a melody track beside Lead, and
// putting it under a frame labelled "Accompaniment" would make the frame say
// something untrue. Module scope, so the tables are not rebuilt per render.
const MELODY_FOCUSES: readonly MixLayerId[] = MIX_LAYER_IDS.filter(
  (id) => melodyTrackForFocus(id) !== null,
);
const BEAT_FOCUS: MixLayerId = 'drum';
const ACCOMPANIMENT_FOCUSES = MIX_LAYER_IDS.filter(
  (id) => !MELODY_FOCUSES.includes(id) && id !== BEAT_FOCUS,
);

// The Beat chip's label comes from MIX_LAYERS' drum row; its styling is
// literal rather than from SYNTH_TARGET_STYLES, which has five entries and no
// sixth to add: a drum focus has no synth channel, so a row in that table
// would be a claim that it does. Both class strings are literals — Tailwind v4
// scans source statically, so a class assembled at runtime is never emitted.
const BEAT_CHIP = {
  label: MIX_LAYER_LABELS[BEAT_FOCUS],
  activeBtn: 'btn-accent',
  softBtn: 'btn-soft btn-accent',
};

/**
 * The one "what am I working on" control, and the only place on this tab that
 * can change it — the header's `viewControls` occupant.
 *
 * It lives in the HEADER, not in the Synth section, because the Synth section
 * is unmounted on a drum focus: inside it, the row would take the only way
 * back to a melodic focus down with it.
 */
function SoundFocusChips({
  focusTrack,
  synthTarget,
  onFocus,
}: {
  focusTrack: MixLayerId;
  synthTarget: SynthControlTarget | null;
  onFocus: (focus: MixLayerId) => void;
}) {
  const renderFocusChip = (focus: MixLayerId) => {
    const style = isMelodicFocus(focus)
      ? SYNTH_TARGET_STYLES[controlTargetForFocus(focus)]
      : BEAT_CHIP;
    return (
      <button
        key={focus}
        id={`btn-focus-${focus}`}
        aria-current={focusTrack === focus ? 'true' : undefined}
        onClick={() => onFocus(focus)}
        className={`btn btn-xs text-[11px] font-semibold rounded-sm ${
          focusTrack === focus ? style.activeBtn : style.softBtn
        }`}
      >
        {style.label}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap max-md:flex-nowrap items-center gap-2 min-w-0 max-w-full">
      {/* No "Focus:" GROUP_LABEL here — a decision, not an omission. The
          header's own title already says this is Sound, and the row sits
          right beside it with no room to spare for a caption that would
          only repeat what the six chips already show by being chips. */}
      {/* Six chips, not five: `drum` is a focus like any other and Beat is
          where the drum kit is edited. */}
      <div
        className={`flex items-center gap-1 flex-wrap max-md:flex-nowrap max-md:min-w-0 max-md:overflow-x-auto no-scrollbar max-md:*:shrink-0 bg-base-200 border rounded-box px-2 py-1 ${synthTarget ? SYNTH_TARGET_STYLES[synthTarget].border : 'border-accent'}`}
      >
        {MELODY_FOCUSES.map(renderFocusChip)}
        {/* Chord, bass and pad are one job done three ways. The frame is
            inside the tinted outer group, not replacing it: the outer tint
            tracks the ACTIVE target, this one groups three of the four. See
            ui/GroupFrame for why it adds no colour. daisyUI's join requires
            its direct children to be the joined items, which a GroupFrame
            between the outer div and three of the four chips breaks — so
            join/join-item are not used here and gap-1 carries the spacing. */}
        <GroupFrame label="Accom" className="flex items-center gap-1 p-1">
          {ACCOMPANIMENT_FOCUSES.map(renderFocusChip)}
        </GroupFrame>
        {renderFocusChip(BEAT_FOCUS)}
      </div>

      {/* ONE solo button, following the focus — Sound edits exactly one layer
          at a time, so five buttons here would be four controls for layers
          this view is not editing. It sits beside the Focus chips because "it
          follows the focus" is only legible next to the focus. Session-only,
          and cleared by LEAVING the loop layer, by a change of active loop, or
          by a project swap — NOT by a focus change, which is what makes a set
          spanning two tracks buildable from here at all. store/soloNav.ts owns
          that rule and says why. It is NOT the header's SoloChip: that one is
          the loop's own state showing up wherever the user is, this one is a
          toggle for the one track the focus names. */}
      <SoloButton id="btn-solo-target" track={soloTrackForFocus(focusTrack)} size="sm" />
    </div>
  );
}

/**
 * The Sound tab: the Synth section (its own module — it owns the channel
 * routing, the preset browser and both overlays), the Beat Sound section that
 * takes the Synth section's place on a drum focus, and the one mixer.
 */
export const SoundView = React.memo(function SoundView() {
  // useLiveStore, not useAppStore: the Beat Sound section's gate below derives
  // from this value, and only useLiveStore serves getState() on the server
  // snapshot renderToString uses — see useLiveStore.ts and testing.md.
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useAppStore((s) => s.setFocusTrack);
  // App keeps every view mounted (block/hidden) so audio survives a tab
  // switch, which means the section's oscilloscope rAF loop must be gated on
  // this or it runs forever behind a hidden tab.
  const activeTab = useAppStore((s) => s.activeTab);
  const synthTarget = synthTargetForFocus(focusTrack);
  const { depth, setDepth } = useSoundDepth(focusTrack);

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* The tab's own header, drawn by the tab. It used to be rendered by the
          Synth section, which made the tab's identity — its icon, its title,
          the SoloChip every HeaderCard carries — the property of a component
          that is unmounted on a drum focus. */}
      <ViewHeader
        view="sound"
        viewControls={
          <SoundFocusChips
            focusTrack={focusTrack}
            synthTarget={synthTarget}
            onFocus={setFocusTrack}
          />
        }
        actions={
          /* Depth: HOW DEEP the focused thing is shown, in the right-hand
             cluster beside the SoloChip. `viewControls` is for what selects
             WHAT the view shows, which on this tab is the focus. */
          <SegmentedGroup>
            {soundDepthOptions(focusTrack).map(({ depth: option, label, icon, title }) => (
              <SegmentedButton
                key={option}
                id={`btn-mode-${option}`}
                icon={icon}
                label={label}
                active={depth === option}
                onSelect={() => setDepth(option)}
                title={title}
              />
            ))}
          </SegmentedGroup>
        }
      />

      {/* Exactly one editor. A melodic focus has a synth channel to shape; a
          drum focus has the Beat instrument's own editor instead. The synth
          section UNMOUNTS rather than rendering bodiless: an editor with no
          patch to edit must not be left holding one, and `useSynthChannel`'s
          Lead fallback must never be reachable from a drum focus.

          The unmount is also what discards the section's overlay state —
          the preset library and the quick-save popover are `useState`
          inside a section that does not survive this gate, so there is
          nothing left to close once it is gone. */}
      {synthTarget !== null && (
        <SoundSynthSection
          focusTrack={focusTrack}
          synthTarget={synthTarget}
          activeTab={activeTab}
          soundGroups={SYNTH_SOUND_GROUP}
          depth={depth}
          onDepth={setDepth}
        />
      )}

      {synthTarget === null && <BeatSoundSection depth={depth} activeTab={activeTab} />}

      {/* The one mixer: every layer's level and mute, including the drum bus
          whose level used to be a lone strip in the card above. */}
      <SoundMixer />
    </div>
  );
});
