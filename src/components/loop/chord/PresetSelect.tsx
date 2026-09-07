import React from "react";
import type { CategoryPresetGroup } from "@/audio/presetRegistry";
import { FIELD_LABEL, FIELD_SELECT } from "@/components/ui/fieldClasses";

export interface PresetSelectProps {
  /** DOM id of the `<select>`; the label's `htmlFor` follows it. */
  id: string;
  label: string;
  title: string;
  /** The blank first option's text — "Chord Preset…", "Pad Preset…". */
  placeholder: string;
  /**
   * Already-filtered option groups. The caller decides WHICH groups its layer
   * offers (the pad narrows to `Pad` plus the group holding the current
   * selection; chord and bass offer all of them) and memoises the list; this
   * component only draws them.
   */
  groups: CategoryPresetGroup[];
  /** The selected preset's NAME — presets are addressed by name here, not id. */
  value: string;
  /** Receives the raw `<option>` value; resolving it to a preset is the layer's job. */
  onSelect: (presetName: string) => void;
}

/**
 * The sound-preset dropdown every layer module card carries.
 *
 * Written three times before this — chord, bass and pad each spelled out the
 * same optgroup loop, the same `★` prefix for a user preset and the same
 * `text-secondary` tint that marks one. The star and the tint are the only
 * signal that a preset is yours rather than the factory's, so three copies is
 * three chances for one card to stop saying it.
 *
 * Deliberately NOT the card shell: the three cards' headers differ in copy,
 * badge and side controls, and folding those together buys nothing.
 */
export function PresetSelect({
  id,
  label,
  title,
  placeholder,
  groups,
  value,
  onSelect,
}: PresetSelectProps) {
  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        className={FIELD_SELECT}
        title={title}
      >
        <option value="">{placeholder}</option>
        {groups.map((group) => (
          <optgroup key={group.category} label={group.label} className="font-bold">
            {group.presets.map((p) => (
              <option
                key={p.id}
                value={p.name}
                className={p.isFactory ? "" : "text-secondary"}
              >
                {!p.isFactory ? `★ ${p.name}` : p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
