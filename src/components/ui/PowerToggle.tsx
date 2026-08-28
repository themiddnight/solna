import React from 'react';
import { Power } from 'lucide-react';

/**
 * Closed union, in the spirit of `KnobColor` in Knob.tsx: the set of legal
 * toggle tones stays reviewable, and Tailwind can see every class literally.
 *
 * Sequencer track mutes deliberately do NOT pass their track's colour —
 * `SequencerTrack.color` is a persisted string (store/initialState.ts) and so
 * cannot join a closed union, and the coloured dot beside the track name
 * already carries that identity. Track mutes pass 'primary'.
 */
export const POWER_TOGGLE_TONES = ['primary', 'accent', 'module-chord', 'module-bass'] as const;
export type PowerToggleTone = (typeof POWER_TOGGLE_TONES)[number];

/**
 * Full literal class strings. Never assemble these by interpolation —
 * Tailwind v4 scans source statically and would emit nothing.
 */
const TONE_CLASS: Record<PowerToggleTone, string> = {
  primary: 'btn-primary',
  accent: 'btn-accent',
  // No leading `btn` here — the component already applies `SIZE_CLASS[size]`.
  'module-chord':
    '[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]',
  'module-bass':
    '[--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]',
};

/**
 * Same reasoning as `TONE_CLASS` above: `btn-${size}` would be invisible to
 * Tailwind v4's static scan. Only two sizes are legal, so a literal record
 * costs nothing and keeps the file consistent with its own warning.
 */
const SIZE_CLASS: Record<'xs' | 'sm', string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
};

/**
 * Pure state -> appearance mapping, exported so behaviour is testable without
 * a DOM — the same shape as `resolveTransportButtons` in PlayerTransport.tsx.
 *
 * On wears the module's own tone; off is `btn-ghost` plus dimmed text. The off
 * state is never `btn-error`: per design.md 6.5, `error` means destructive, so
 * red would read as "this is broken" rather than "this is muted".
 */
export function resolvePowerToggle(
  on: boolean,
  tone: PowerToggleTone,
  iconOnly: boolean,
): { className: string; label: string } {
  const shape = iconOnly ? 'btn-square' : 'gap-1';
  return {
    className: on
      ? `${TONE_CLASS[tone]} btn-active ${shape}`
      : `btn-ghost text-base-content/40 ${shape}`,
    label: on ? 'On' : 'Off',
  };
}

export interface PowerToggleProps {
  on: boolean;
  onToggle: () => void;
  /** Subject of the control, e.g. "Chord", "Reverb". Rendered as `${name} On`. */
  name: string;
  tone: PowerToggleTone;
  /** Icon-only square button — used for the sequencer's per-track mutes. */
  iconOnly?: boolean;
  size?: 'xs' | 'sm';
  id?: string;
  /**
   * Verbs used to build the `title` tooltip, describing what a *click* will
   * do rather than repeating the current state (which `aria-pressed` and the
   * visible label already carry). Defaults to generic power language; pass
   * `{ on: 'Unmute', off: 'Mute' }` for a control that reads as a mute, e.g.
   * the sequencer's icon-only track toggles.
   */
  verb?: { on: string; off: string };
}

/**
 * The app's single on/off affordance. One icon everywhere: `Power` means
 * on/off, and `Volume2`/`VolumeX` are reserved for actual level controls.
 */
export const PowerToggle: React.FC<PowerToggleProps> = ({
  on, onToggle, name, tone, iconOnly = false, size = 'sm', id,
  verb = { on: 'Turn on', off: 'Turn off' },
}) => {
  const { className, label } = resolvePowerToggle(on, tone, iconOnly);
  // The button's accessible name is set explicitly rather than left to fall
  // back to visible text, since the icon-only variant has no visible text at
  // all. `title` is deliberately a different string: it describes the effect
  // of clicking (an action), while the accessible name / visible label state
  // what the control currently is (a state) — `aria-pressed` already exposes
  // the state to assistive tech, so the tooltip earns its keep by adding the
  // one thing that isn't already on screen.
  const accessibleName = `${name} ${label}`;
  const actionTitle = on ? `${verb.off} ${name}` : `${verb.on} ${name}`;
  return (
    <button
      id={id}
      type="button"
      aria-pressed={on}
      aria-label={accessibleName}
      onClick={onToggle}
      className={`btn ${SIZE_CLASS[size]} text-xs font-semibold ${className}`}
      title={actionTitle}
    >
      <Power className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {!iconOnly && <span>{accessibleName}</span>}
    </button>
  );
};
