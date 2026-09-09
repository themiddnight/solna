import React from 'react';
import { cx } from './cx';

/**
 * A grid's tool lane, and the group that keeps a wrap from cutting through the
 * middle of one.
 *
 * The lanes exist because a step grid's tools split cleanly in two by how often
 * a hand reaches for them: SETTINGS you pick once and leave (view mode, octave
 * window, loop length, step resolution, gate) and ACTIONS you tap over and over
 * while writing (record, copy, paste, clear). One lane above the grid holds the
 * first, one below holds the second. That is the whole rule — no exceptions, so
 * there is nothing to remember beyond "set it up there, do it down here".
 *
 * Below the grid is not a leftover slot for the overflow: the action lane lands
 * next to the bottom input dock, which is where the hands already are when the
 * record button matters, and it puts the eye path in the order the work happens
 * (look at the grid, then act on it) rather than making it double back.
 *
 * Both lanes sit OUTSIDE the grid's own `overflow-x-auto`, so a 700px-wide grid
 * scrolls under tools that stay put — the same reason SequencerView's toolbar
 * is outside its scroll container.
 */
export function ToolbarLane({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center flex-wrap gap-x-3 gap-y-2', className)}>
      {children}
    </div>
  );
}

/**
 * Several groups gathered as ONE side of a `justify-between` lane.
 *
 * It exists because a lane spaces only its own direct children: put four
 * groups in a bare `<div className="flex flex-wrap">` to hold them together
 * opposite the lane's other half, and the lane's `gap-x-3 gap-y-2` reaches the
 * div and stops, so the groups inside render flush against each other and
 * wrapped rows touch. Carrying the lane's own gaps is what keeps the wrap rule
 * — break between groups, never through one — true one level down.
 *
 * Use it instead of nesting a `ToolbarLane` inside a `ToolbarLane`: a lane is
 * a ROW (one above the grid, one below), and a lane that is really a cluster
 * leaves a reader with no rule to follow.
 */
export function ToolbarCluster(props: { children: React.ReactNode; className?: string }) {
  // Delegates rather than repeating the class string. "A cluster carries the
  // lane's own gaps" is the whole point of the component, so it has to be true
  // by construction — two identical literals would let the next gap retune land
  // on one and not the other, which is the drift this file exists to stop.
  return <ToolbarLane {...props} />;
}

/**
 * One semantic cluster inside a lane — the octave stepper, the two grid
 * selects, copy+paste.
 *
 * `shrink-0` and the tight inner `gap-1` against the lane's wider `gap-x-3` are
 * what make a wrap break BETWEEN groups instead of through one. Without it a
 * lane of flat siblings wraps wherever the width happens to run out, which is
 * how the lead grid's toolbar ended up splitting an octave stepper across two
 * rows on a phone.
 */
export function ToolbarGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-1 shrink-0', className)}>{children}</div>
  );
}

/**
 * The resting look of a toolbar action button. Exported so
 * `fieldClasses.test.ts` can fail the build if a component hand-writes it
 * again — the lead grid carried four copies of this exact string.
 *
 * `/60`, not `/70`: the extraction is supposed to name the look the app
 * already wears, and every other site of this idiom (the lead grid's view
 * toggle, the input dock, the arpeggiator, LFO, oscillator and filter panels)
 * spells it `/60`. Extracting at a value nothing used would have made the
 * constant a twelfth variant rather than the one the others collapse into.
 */
export const TOOLBAR_BUTTON_IDLE = 'btn-ghost border border-base-300 text-base-content/60';

export interface ToolbarButtonProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  /**
   * Drops the label below `sm`, leaving the icon to carry the button.
   *
   * Opt-in, not the default, and the difference is width the row actually has:
   * a lane of its own under a grid fits four labelled buttons inside 375px, so
   * hiding the words there would trade legibility for space nothing needs —
   * `Copy` and `Paste` are two near-identical 12px glyphs once the words go.
   * A row that shares its width with a `select` (the drum grid's) genuinely
   * runs out, and that is the case this exists for.
   */
  collapseLabel?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Toggle buttons only. Renders `aria-pressed` and the armed look; plain
   * actions leave it undefined so they get no pressed state at all.
   */
  pressed?: boolean;
  size?: 'xs' | 'sm';
}

/**
 * The action button every grid toolbar uses.
 *
 * SequencerView wrote this pattern by hand twice and the lead grid had
 * text-only buttons with no icon at all instead — one role wearing two looks,
 * which is the drift `fieldClasses.ts` exists to stop for class strings.
 *
 * A pressed toggle wears `btn-error`, and only a toggle does: the lead
 * recorder already owned that red, so a destructive action must NOT also claim
 * it — Clear is set apart by its own group's spacing and its icon instead.
 */
export function ToolbarButton({
  id,
  icon,
  label,
  title,
  onClick,
  disabled,
  pressed,
  collapseLabel,
  size = 'xs',
}: ToolbarButtonProps) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      className={cx(
        'btn gap-1',
        size === 'sm' ? 'btn-sm' : 'btn-xs',
        pressed ? 'btn-error' : TOOLBAR_BUTTON_IDLE,
      )}
    >
      {icon}
      <span className={cx(collapseLabel && 'hidden sm:inline')}>{label}</span>
    </button>
  );
}
