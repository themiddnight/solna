import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FIELD_SELECT } from '@/components/ui/fieldClasses';
import { beatPatchOf } from '@/store/beatPresets';
import type { BeatParams, BeatPreset } from '@/types';

export interface BeatPresetToolbarProps {
  /** The COMMITTED params — provenance and Edited are properties of what is
   *  stored, not of a knob mid-drag. */
  params: BeatParams;
  /** The live library: factory presets followed by the user's own. */
  presets: readonly BeatPreset[];
  onSelect: (presetId: string) => void;
}

/**
 * Whether the loop's patch still equals the preset it names.
 *
 * A structural comparison, not a stored flag: `Edited` is derived by comparing
 * the current patch with its base (the spec's rule), so it cannot go stale and
 * there is nothing extra to persist. `basePresetId` is excluded because it is
 * provenance, and `outputTrimDb` is included because a patch's calibration is
 * part of the sound snapshot a preset carries.
 */
export function isBeatPatchEdited(params: BeatParams, base: BeatPreset | undefined): boolean {
  if (!base) return false;
  return JSON.stringify(beatPatchOf(params)) !== JSON.stringify(base.patch);
}

/**
 * The selector's next entry in a direction, or `undefined` when the library
 * cannot answer.
 *
 * A base that no longer resolves has no position in the list, so stepping from
 * it starts at the first entry rather than guessing where it "would" have sat.
 */
export function stepBeatPreset(
  presets: readonly BeatPreset[],
  currentId: string | null,
  direction: 1 | -1,
): BeatPreset | undefined {
  if (presets.length === 0) return undefined;
  const index = presets.findIndex((preset) => preset.id === currentId);
  if (index < 0) return presets[0];
  return presets[(index + direction + presets.length) % presets.length];
}

/**
 * The library menu. Its own component so the toolbar stays under this repo's
 * function-length rule, and because the grouping — factory, then the user's own,
 * plus the `Custom patch` entry a dangling base needs — is one idea.
 */
function BeatPresetSelect({
  presets,
  selectedId,
  onSelect,
}: {
  presets: readonly BeatPreset[];
  /** The id of the RESOLVED base, or '' when the loop's base is unresolvable. */
  selectedId: string;
  onSelect: (presetId: string) => void;
}) {
  const factory = presets.filter((preset) => preset.origin === 'factory');
  const user = presets.filter((preset) => preset.origin === 'user');
  return (
    <>
    <label htmlFor="select-beat-preset" className="shrink-0 text-sm text-base-content/70">
      Kit:
    </label>
    <select
      id="select-beat-preset"
      className={FIELD_SELECT}
      aria-label="Beat preset"
      value={selectedId}
      onChange={(e) => onSelect(e.target.value)}
    >
      {/* The unresolvable case is an OPTION, not a blank select: the patch is
          still playable and still the user's, it simply has no source to name. */}
      {selectedId === '' && <option value="">Custom patch</option>}
      <optgroup label="Factory">
        {factory.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </optgroup>
      {user.length > 0 && (
        <optgroup label="My Presets">
          {user.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
    </>
  );
  
}

/**
 * The kit picker: which sound the loop is built on, and the arrows that walk
 * the library.
 *
 * It is the RIGHT half of the kit row; `BeatSoundSection` puts the bus filter
 * opposite it. Both state bus-level facts, which is what separates that row
 * from the per-voice grid below it — and it is the shape the synth's own
 * preset bar has, a picker on the right with the row's other half to its left.
 *
 * Quick Save and Reset All are NOT here. They act on the whole patch, which is
 * what the section BAND's actions cell is for, and that is where the Synth
 * section keeps its own pair — leaving them in this row made a control that
 * rewrites every voice look like one more way to browse the library.
 *
 * EVERY ID THIS RENDERS COMES FROM `presets`, which is the LIVE library — the
 * factory table plus whatever the user currently has saved. `setBeatPreset`
 * throws on an id it cannot resolve, deliberately, so the guard belongs at the
 * call site: `select` re-checks the chosen id against the same list before
 * calling out, and the two arrows only ever hand back an entry OF that list.
 * A loop whose `basePresetId` names a deleted user preset therefore renders as
 * `Custom patch` and disables the resets that would need the missing source,
 * rather than throwing or silently installing somebody else's sound.
 */
export function BeatPresetToolbar({ params, presets, onSelect }: BeatPresetToolbarProps) {
  const base = presets.find((preset) => preset.id === params.basePresetId);
  const edited = isBeatPatchEdited(params, base);

  // The one door out of this component, and it re-resolves against the live
  // list: a stale option in a menu the browser has kept, or an id a future
  // caller derives from stored state, must not reach the throwing resolver.
  const select = (presetId: string) => {
    if (!presets.some((preset) => preset.id === presetId)) return;
    onSelect(presetId);
  };

  const step = (direction: 1 | -1) => {
    const next = stepBeatPreset(presets, params.basePresetId, direction);
    if (next) select(next.id);
  };

  return (
    /* `shrink-0`, and no wrapping inside: the menu and its two arrows are one
       control and must break away from the filter opposite them as a unit,
       rather than stacking the arrows under the menu. */
    <div className="flex items-center gap-2 shrink-0">
      {edited && <span className="badge badge-sm badge-warning font-semibold">Edited</span>}

      <BeatPresetSelect presets={presets} selectedId={base?.id ?? ''} onSelect={select} />

      <div className="join">
        <button
          id="btn-beat-preset-prev"
          type="button"
          className="btn btn-sm btn-ghost join-item min-h-11"
          aria-label="Previous Beat preset"
          onClick={() => step(-1)}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          id="btn-beat-preset-next"
          type="button"
          className="btn btn-sm btn-ghost join-item min-h-11"
          aria-label="Next Beat preset"
          onClick={() => step(1)}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
