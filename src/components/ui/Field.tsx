import React from 'react';
import { FIELD_LABEL, FIELD_LANE } from './fieldClasses';

export interface FieldProps {
  /** Visible stacked label. Omit only when the card's own title already names
   *  the field — pass `ariaLabel` on the control itself in that case. */
  label?: string;
  /** `for` target, when the control has an id worth pointing the label at. */
  htmlFor?: string;
  children: React.ReactNode;
}

/**
 * One field in a card's control row: a stacked label above the app's standard
 * 32px control lane.
 *
 * `FIELD_LABEL` and `FIELD_LANE` stop the two class strings from drifting, but
 * they cannot stop the *structure* from drifting — the sequencer's Drum Sound
 * row hand-assembled the same `<div><label/><div lane/></div>` four times in a
 * row, and its indentation had already come apart. The pairing is the rule, so
 * the pairing is what this owns; the tokens are its internals.
 */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, children }) => (
  <div>
    {label !== undefined && (
      <label className={FIELD_LABEL} htmlFor={htmlFor}>
        {label}
      </label>
    )}
    <div className={FIELD_LANE}>{children}</div>
  </div>
);
