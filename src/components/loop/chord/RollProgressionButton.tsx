import { ChevronDown, Shuffle } from 'lucide-react';
import { Popup } from '@/components/ui/Popup';
import { HINT_TEXT } from '@/components/ui/fieldClasses';
import type { RollBarsPerChord, RollChordCount } from './markovProgression';
import type { UseProgressionDice } from './useProgressionDice';

const CHORD_COUNT_OPTIONS: readonly RollChordCount[] = ['keep', 2, 3, 4, 6, 8];
const BARS_PER_CHORD_OPTIONS: readonly RollBarsPerChord[] = [1, 2, 4];

/** Both halves of the split button: the Re-harmonize family's colour, one `join`. */
const ROLL_BUTTON = 'btn btn-xs btn-secondary btn-soft join-item';

const ROLL_PANEL =
  'mt-1 w-64 max-w-[calc(100vw-1rem)] p-3 bg-base-100 border border-base-300 rounded-box shadow-xl';

/** Selected-vs-not, spelled the way `ui/SegmentedControl` spells it. */
function optionClass(active: boolean): string {
  return `btn btn-xs join-item ${active ? 'btn-active btn-primary' : 'btn-ghost'}`;
}

interface OptionRowProps<T extends string | number> {
  idPrefix: string;
  legend: string;
  options: readonly T[];
  value: T;
  labelOf: (option: T) => string;
  onPick: (option: T) => void;
}

/** One segmented choice: a `join` of pressed/unpressed buttons under a fieldset legend. */
function OptionRow<T extends string | number>({ idPrefix, legend, options, value, labelOf, onPick }: OptionRowProps<T>) {
  return (
    <fieldset className="fieldset p-0">
      <legend className="fieldset-legend text-xs pt-0">{legend}</legend>
      <div className="join">
        {options.map((option) => (
          <button
            key={option}
            id={`${idPrefix}-${option}`}
            type="button"
            aria-pressed={option === value}
            onClick={() => onPick(option)}
            className={optionClass(option === value)}
          >
            {labelOf(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The options popup's body: Chords, Bars per chord (hidden while Keep),
 * Borrowed, and a Random that rolls with them. Exported for its render test.
 */
export function RollOptionsPanel({ dice }: { dice: UseProgressionDice }) {
  return (
    <div role="dialog" aria-label="Random options" className="flex flex-col gap-3">
      <OptionRow
        idPrefix="btn-roll-chords"
        legend="Chords"
        options={CHORD_COUNT_OPTIONS}
        value={dice.chordCount}
        labelOf={(count) => (count === 'keep' ? 'Keep' : String(count))}
        onPick={dice.setChordCount}
      />
      {dice.chordCount !== 'keep' && (
        <OptionRow
          idPrefix="btn-roll-bars"
          legend="Bars per chord"
          options={BARS_PER_CHORD_OPTIONS}
          value={dice.barsPerChord}
          labelOf={String}
          onPick={dice.setBarsPerChord}
        />
      )}
      <label className="label gap-2 text-xs">
        <input
          id="chk-roll-borrowed"
          type="checkbox"
          className="toggle toggle-sm toggle-secondary"
          checked={dice.allowBorrowed && dice.borrowedAvailable}
          disabled={!dice.borrowedAvailable}
          onChange={(e) => dice.setAllowBorrowed(e.target.checked)}
        />
        Borrowed chords
      </label>
      {!dice.borrowedAvailable && (
        <p className="text-xs text-base-content/60">This scale has no borrowed chords.</p>
      )}
      <p className={`${HINT_TEXT} text-xs text-base-content/60`}>7ths follow Quick Add.</p>
      <button
        id="btn-roll-progression-apply"
        type="button"
        onClick={dice.rollFromOptions}
        className="btn btn-sm btn-secondary gap-1"
      >
        <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
        Random
      </button>
    </div>
  );
}

/**
 * The Random split button (the Beat grid's word and icon): the main half
 * rolls with the current options, the caret opens them in a `ui/Popup` (overlay kind popup, R325). Icon only
 * below `sm`, like its neighbours. The Popup wrapper is `flex` so the caret
 * keeps the join's height.
 */
export function RollProgressionButton({ dice }: { dice: UseProgressionDice }) {
  return (
    <div className="join">
      <button
        id="btn-roll-progression"
        type="button"
        onClick={dice.roll}
        aria-label="Random progression"
        title="Randomize a new progression in this key"
        className={`${ROLL_BUTTON} gap-1`}
      >
        <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Random</span>
      </button>
      <Popup
        open={dice.optionsOpen}
        onClose={dice.closeOptions}
        align="end"
        className="flex"
        panelClassName={ROLL_PANEL}
        trigger={
          <button
            id="btn-roll-progression-options"
            type="button"
            onClick={dice.toggleOptions}
            aria-label="Random options"
            aria-haspopup="dialog"
            aria-expanded={dice.optionsOpen}
            className={`${ROLL_BUTTON} px-1`}
          >
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        }
      >
        <RollOptionsPanel dice={dice} />
      </Popup>
    </div>
  );
}
