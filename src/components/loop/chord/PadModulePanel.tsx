import React, { useMemo } from "react";
import { useAppStore } from "@/store/store";
import {
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from "@/audio/presetRegistry";
import { ChannelStrip } from "@/components/ui/ChannelStrip";
import { FIELD_LABEL, FIELD_SELECT, JOIN_LANE, SECTION_HEADER } from "@/components/ui/fieldClasses";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
import { PAD_INTERVALS } from "@/types";
import type { PadInterval, PadVoicing } from "@/types";
import { AdjustSynthButton } from "./AdjustSynthButton";
import { PresetSelect } from "./PresetSelect";
import { droneDegreeButtons, padPresetGroups } from "./padPanel";

// Oct 1 reaches a bass-register drone, Oct 5 a high pad. Wider at the bottom
// than the chord module (2-6) and at the top than the bass module (1-4),
// because this one control serves both a chord-following pad and a held drone.
const PAD_OCTAVES = [1, 2, 3, 4, 5];

/** Names for PAD_INTERVALS (`src/types.ts`), for the toggle buttons' tooltips. */
const PAD_INTERVAL_NAMES: Record<PadInterval, string> = {
  1: 'unison',
  4: 'perfect fourth',
  5: 'perfect fifth',
  8: 'octave',
  12: 'perfect twelfth',
};

const PAD_VOICINGS: { value: PadVoicing; label: string }[] = [
  { value: "triad", label: "Triad" },
  { value: "open5", label: "Open 5th" },
  { value: "root", label: "Root" },
];

/**
 * A join-group button, styled active/inactive from SYNTH_TARGET_STYLES.pad —
 * the same active/inactive pair SynthView's target selector uses, so the
 * pad's own toggles read as the same widget family.
 */
function PadToggleButton({
  id,
  active,
  onClick,
  title,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={`btn btn-xs join-item text-[11px] font-semibold ${
        active
          ? SYNTH_TARGET_STYLES.pad.activeBtn
          : "btn-ghost text-base-content/60"
      }`}
      title={title}
    >
      {children}
    </button>
  );
}

export function PadModulePanel() {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
  const customPresets = useAppStore((s) => s.customSynthPresets);
  const padMode = useAppStore((s) => s.padMode);
  const setPadMode = useAppStore((s) => s.setPadMode);
  const padOctave = useAppStore((s) => s.padOctave);
  const setPadOctave = useAppStore((s) => s.setPadOctave);
  const padVoicing = useAppStore((s) => s.padVoicing);
  const setPadVoicing = useAppStore((s) => s.setPadVoicing);
  const padDroneDegree = useAppStore((s) => s.padDroneDegree);
  const setPadDroneDegree = useAppStore((s) => s.setPadDroneDegree);
  const padDroneIntervals = useAppStore((s) => s.padDroneIntervals);
  const togglePadDroneInterval = useAppStore((s) => s.togglePadDroneInterval);
  const padVolume = useAppStore((s) => s.padVolume);
  const setPadVolume = useAppStore((s) => s.setPadVolume);

  const presetName = padSynthParams.preset ?? "";
  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const presetGroups = useMemo(
    () => padPresetGroups(getPresetsGroupedByCategory(allPresets), presetName),
    [allPresets, presetName],
  );

  return (
    <div className="mt-4 card bg-panel tint-pad border border-module-pad/30 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className={SECTION_HEADER}>Pad Module</h3>
          <p className="text-[10px] text-base-content/60">
            Pad follows the chord progression, legato. Drone holds a fixed
            note, interval or chord for the whole loop pass.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={JOIN_LANE}
            role="group"
            aria-label="Pad mode"
          >
            <PadToggleButton
              id="btn-pad-mode-pad"
              active={padMode === "pad"}
              onClick={() => setPadMode("pad")}
              title="Legato pad, follows the chord progression"
            >
              Pad
            </PadToggleButton>
            <PadToggleButton
              id="btn-pad-mode-drone"
              active={padMode === "drone"}
              onClick={() => setPadMode("drone")}
              title="Fixed drone, held for the whole loop pass"
            >
              Drone
            </PadToggleButton>
          </div>
          <AdjustSynthButton target="pad" className="text-module-pad" />
        </div>
      </div>

      <div className="flex flex-row flex-wrap items-end gap-3">
        <PresetSelect
          id="select-pad-sound-preset"
          label="Pad Preset"
          title="Pad sound preset — factory Pad presets, synced with the synth page"
          placeholder="Pad Preset…"
          groups={presetGroups}
          value={presetName}
          onSelect={(name) => {
            const preset = findPresetByName(name, allPresets);
            if (!preset) return;
            setPadSynthParams({
              ...padSynthParams,
              ...preset.params,
              preset: preset.name,
            });
          }}
        />

        {/* Octave sits OUTSIDE the mode branch: padOctave feeds resolveDroneNotes as
            well as the chord-following path, so hiding it in pad mode left the drone
            with a register the ear could hear and the hand could not reach. */}
        <div>
          <label className={FIELD_LABEL} htmlFor="select-pad-octave">Pad Octave</label>
          <select
            id="select-pad-octave"
            value={padOctave}
            onChange={(e) => setPadOctave(parseInt(e.target.value, 10))}
            className={FIELD_SELECT}
            title="Register for the pad voicing or the held drone"
          >
            {PAD_OCTAVES.map((o) => (
              <option key={o} value={o}>
                Oct {o}
              </option>
            ))}
          </select>
        </div>

        {/* The two control blocks SWAP rather than both rendering with one
            disabled: a greyed-out control invites the user to work out why it
            does nothing, and each set stays dormant-but-persisted while the
            other shows. */}
        {padMode === "drone" ? (
          <>
            <div>
              <span className={FIELD_LABEL} id="label-pad-drone-degree">Drone Degree</span>
              <div
                className={JOIN_LANE}
                role="group"
                aria-labelledby="label-pad-drone-degree"
              >
                {droneDegreeButtons(scaleRoot, scaleType, padDroneDegree).map(
                  ({ index, label, active }) => (
                    <PadToggleButton
                      id={`btn-pad-drone-degree-${index}`}
                      key={index}
                      active={active}
                      onClick={() => setPadDroneDegree(index)}
                      title={`Drone on scale degree ${label}`}
                    >
                      {label}
                    </PadToggleButton>
                  ),
                )}
              </div>
            </div>

            <div>
              <span className={FIELD_LABEL} id="label-pad-drone-intervals">Drone Intervals</span>
              <div
                className={JOIN_LANE}
                role="group"
                aria-labelledby="label-pad-drone-intervals"
              >
                {PAD_INTERVALS.map((interval) => (
                  <PadToggleButton
                    id={`btn-pad-drone-interval-${interval}`}
                    key={interval}
                    active={padDroneIntervals.includes(interval)}
                    onClick={() => togglePadDroneInterval(interval)}
                    title={`Toggle drone interval ${interval} (${PAD_INTERVAL_NAMES[interval]})`}
                  >
                    {interval}
                  </PadToggleButton>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div>
            <span className={FIELD_LABEL} id="label-pad-voicing">Pad Voicing</span>
            <div
              className={JOIN_LANE}
              role="group"
              aria-labelledby="label-pad-voicing"
            >
              {PAD_VOICINGS.map(({ value, label }) => (
                <PadToggleButton
                  id={`btn-pad-voicing-${value}`}
                  key={value}
                  active={padVoicing === value}
                  onClick={() => setPadVoicing(value)}
                  title={`Pad voicing: ${label}`}
                >
                  {label}
                </PadToggleButton>
              ))}
            </div>
          </div>
        )}

        <ChannelStrip
          idPrefix="pad"
          label="Pad Level"
          volumeDb={padVolume}
          accentClass={SYNTH_TARGET_STYLES.pad.accent}
          onVolumeDbChange={setPadVolume}
          showReadout={false}
          sliderClassName={SYNTH_TARGET_STYLES.pad.slider}
        />
      </div>
    </div>
  );
}
