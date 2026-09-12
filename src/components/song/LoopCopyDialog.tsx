import React, { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { loopBars } from '@/utils/songStructure';
import { impliesKeyCopy, LOOP_COPY_GROUPS } from '@/store/loopCopy';
import { useAppStore } from '@/store/store';
import type { LoopCopyAspect, LoopCopyGroupId, LoopCopyTrack } from '@/store/loopCopy';
import type { Loop } from '@/store/types';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { Modal } from '../ui/Modal';

export type LoopCopyQuickChip = 'sounds' | 'patterns' | 'everything';

/**
 * A quick chip TICKS the matrix; it is not a separate mode. Quick and
 * detailed are one selection state with two ways in, so a chip can be
 * followed by a manual untick with no mode to leave. Derived from
 * LOOP_COPY_GROUPS by aspect, so a thirteenth group joins the right chip
 * without a second list being edited.
 */
export function quickChipSelection(chip: LoopCopyQuickChip): LoopCopyGroupId[] {
  if (chip === 'everything') return LOOP_COPY_GROUPS.map((group) => group.id);
  const aspect: LoopCopyAspect = chip === 'sounds' ? 'sound' : 'pattern';
  return LOOP_COPY_GROUPS.filter((group) => group.aspect === aspect).map((group) => group.id);
}

/**
 * The Chords-implies-Key rule applied to a candidate selection. A DEFAULT the
 * user may then untick, never a lock — copying a progression into a different
 * key on purpose is a real musical move.
 */
export function withImpliedKey(
  source: Loop,
  target: Loop,
  next: readonly LoopCopyGroupId[],
): LoopCopyGroupId[] {
  if (next.includes('key') || !impliesKeyCopy(source, target, next)) return [...next];
  return [...next, 'key'];
}

/** The shared key-label convention (Header, InstantVibesBar, ...) — see
 *  formatKeyLabel's own docblock for why this must not be reopened locally. */
const keyName = (loop: Loop) => formatKeyLabel(loop.scaleRoot, loop.scaleType);

const barCount = (bars: number) => `${bars} bar${bars === 1 ? '' : 's'}`;

/**
 * A From option states the key and the bar count — the two facts that decide
 * whether the copy will surprise you, visible before the pick rather than
 * after. `label` is loopLabel(loop), resolved by the caller, so an unnamed
 * loop reads as `Synthwave 80s — C Major · 8 bars` rather than as a blank
 * followed by two facts about nothing.
 */
export function loopCopySourceOption(loop: Loop, label: string): string {
  return `${label} — ${keyName(loop)} · ${barCount(loopBars(loop.chords))}`;
}

/**
 * The collapsed Details summary. It always states what is currently ticked,
 * so a quick chip is never a black box — the collapsed state still tells you
 * what Apply will do.
 */
export function loopCopySummary(selected: readonly LoopCopyGroupId[]): string {
  const labels = LOOP_COPY_GROUPS.filter((group) => selected.includes(group.id)).map(
    (group) => group.label,
  );
  return labels.length === 0 ? 'nothing selected' : labels.join(', ');
}

/** Null unless the copy actually crosses a key boundary — see impliesKeyCopy. */
export function loopKeyNotice(
  source: Loop,
  target: Loop,
  selected: readonly LoopCopyGroupId[],
): string | null {
  if (!selected.includes('key') || !impliesKeyCopy(source, target, selected)) return null;
  return `Key / Scale added: the source is in ${keyName(source)}, this loop is in ${keyName(target)}.`;
}

/**
 * loopBars(chords) IS the loop's length in the arrangement, so copying a
 * progression stretches or shrinks this loop inside the song. Null when the
 * lengths match: a notice that fires every time is a notice nobody reads.
 */
export function loopBarsNotice(
  source: Loop,
  target: Loop,
  selected: readonly LoopCopyGroupId[],
): string | null {
  if (!selected.includes('chord-progression')) return null;
  const next = loopBars(source.chords);
  const now = loopBars(target.chords);
  if (next === now) return null;
  return `This loop becomes ${barCount(next)}, was ${now}.`;
}

/**
 * The remembered source, or the first source when the remembered one no longer
 * names a loop in this project (it was deleted, or the list shrank). Empty
 * string when there is no source at all — the same sentinel the dialog has
 * always used for a project that holds only the target loop.
 */
export function resolveCopySourceId(
  sources: readonly Loop[],
  rememberedSourceId: string | null,
): string {
  return sources.some((loop) => loop.id === rememberedSourceId)
    ? (rememberedSourceId as string)
    : (sources[0]?.id ?? '');
}

/**
 * Whether a restored selection counts as an explicit "no key" decision rather
 * than a rule that never fired. True only when the progression is ticked, key
 * is NOT, and the keys actually differ — the one combination a restored
 * snapshot can only reach by the user having unticked 'key' on purpose, which
 * the next toggle/source-change must then respect instead of re-adding it.
 */
export function restoreKeyTouched(
  selected: readonly LoopCopyGroupId[],
  source: Loop | undefined,
  target: Loop | undefined,
): boolean {
  return (
    source !== undefined &&
    target !== undefined &&
    selected.includes('chord-progression') &&
    !selected.includes('key') &&
    impliesKeyCopy(source, target, selected)
  );
}

/** The matrix's row labels. The GROUPING still lives only in
 *  LOOP_COPY_GROUPS; this is the display name of a row, not a membership. */
const TRACK_ROWS: readonly { track: LoopCopyTrack; label: string }[] = [
  { track: 'lead', label: 'Lead' },
  { track: 'fx', label: 'FX' },
  { track: 'chord', label: 'Chords' },
  { track: 'bass', label: 'Bass' },
  { track: 'pad', label: 'Pad' },
  { track: 'drums', label: 'Drums' },
];

const QUICK_CHIPS: readonly { kind: LoopCopyQuickChip; label: string }[] = [
  { kind: 'sounds', label: 'All sounds' },
  { kind: 'patterns', label: 'All patterns' },
  { kind: 'everything', label: 'Everything' },
];

const groupAt = (track: LoopCopyTrack, aspect: LoopCopyAspect) =>
  LOOP_COPY_GROUPS.find((group) => group.track === track && group.aspect === aspect);

const LOOP_WIDE_GROUPS = LOOP_COPY_GROUPS.filter((group) => group.track === 'loop');

export interface LoopCopyDialogProps {
  /** The loop being copied INTO. Pull, not push: the loop in view is the destination. */
  targetId: string;
  loops: readonly Loop[];
  /** loopLabel(loop) per loop id, resolved by ArrangeView — the dialog never
   *  reads loop.name or loop.tempName itself. */
  labels: Readonly<Record<string, string>>;
  onApply: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void;
  onClose: () => void;
}

/**
 * Pick a source loop, tick which parts to take, Apply overwrites those parts
 * of the target. A dumb view: it imports no engine, holds all of its
 * selection state locally (transient UI belongs nowhere near a slice, least
 * of all a persisted one) and takes its data and both callbacks as props.
 *
 * No confirmation on top and no toast: the dialog and its Apply button ARE
 * the confirmation, and the result is immediately visible on the target card
 * — bar badge, key badge, chord strip, mixer strip.
 */
/** One aspect's checkbox: the matrix and the loop-wide list render the same input. */
function CopyGroupCheckbox({
  id,
  label,
  checked,
  onToggle,
}: {
  id: LoopCopyGroupId;
  label: string;
  checked: boolean;
  onToggle: (id: LoopCopyGroupId) => void;
}) {
  return (
    <input
      id={`chk-loop-copy-${id}`}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={() => onToggle(id)}
      className="checkbox checkbox-xs checkbox-primary"
    />
  );
}

/** The three one-click presets. */
function CopyQuickChips({ onPick }: { onPick: (kind: LoopCopyQuickChip) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_CHIPS.map(({ kind, label }) => (
        <button
          key={kind}
          id={`btn-loop-copy-chip-${kind}`}
          type="button"
          onClick={() => onPick(kind)}
          className="btn btn-xs btn-outline btn-primary"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The modal footer: Cancel, and Apply, which writes the selection through. */
function CopyDialogActions({
  disabled,
  onApply,
  onCancel,
}: {
  disabled: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-action">
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
      <button
        id="btn-loop-copy-apply"
        type="button"
        disabled={disabled}
        onClick={onApply}
        className="btn btn-primary"
      >
        Apply
      </button>
    </div>
  );
}

/** A muted advisory line: the implied key, or a bar-count mismatch. */
function CopyNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-info">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

/** The Details disclosure: the per-track sound/pattern/progression matrix. */
function CopyDetails({
  selected,
  onToggle,
}: {
  selected: readonly LoopCopyGroupId[];
  onToggle: (id: LoopCopyGroupId) => void;
}) {
  const checkbox = (id: LoopCopyGroupId, label: string) => (
    <CopyGroupCheckbox id={id} label={label} checked={selected.includes(id)} onToggle={onToggle} />
  );

  return (
    <details className="rounded-box border border-base-300 bg-base-200/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-base-content/70">
        {`Details — ${loopCopySummary(selected)}`}
      </summary>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-[1fr_5rem_5rem_5rem] items-center gap-y-1 text-xs">
          <span />
          <span className="text-center text-[10px] font-bold uppercase tracking-wider text-base-content/50">
            Sound
          </span>
          <span className="text-center text-[10px] font-bold uppercase tracking-wider text-base-content/50">
            Pattern
          </span>
          <span className="text-center text-[10px] font-bold uppercase tracking-wider text-base-content/50">
            Progression
          </span>
          {TRACK_ROWS.map(({ track, label }) => {
            const sound = groupAt(track, 'sound');
            const pattern = groupAt(track, 'pattern');
            const progression = groupAt(track, 'progression');
            return (
              <React.Fragment key={track}>
                <span className="font-semibold text-base-content">{label}</span>
                <span className="text-center">{sound && checkbox(sound.id, sound.label)}</span>
                <span className="text-center">
                  {pattern && checkbox(pattern.id, pattern.label)}
                </span>
                <span className="text-center">
                  {progression && checkbox(progression.id, progression.label)}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        <div className="space-y-1 border-t border-base-300 pt-3 text-xs">
          {LOOP_WIDE_GROUPS.map((group) => (
            <div key={group.id} className="flex items-center gap-2">
              {checkbox(group.id, group.label)}
              <span className="font-semibold text-base-content">{group.label}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

/**
 * Pick a source loop, tick which parts to take, Apply overwrites those parts
 * of the target. A dumb view: it imports no engine, holds all of its
 * selection state locally (transient UI belongs nowhere near a slice, least
 * of all a persisted one) and takes its data and both callbacks as props.
 *
 * No confirmation on top and no toast: the dialog and its Apply button ARE
 * the confirmation, and the result is immediately visible on the target card
 * — bar badge, key badge, chord strip, mixer strip.
 */
export function LoopCopyDialog({
  targetId,
  loops,
  labels,
  onApply,
  onClose,
}: LoopCopyDialogProps) {
  const sources = loops.filter((loop) => loop.id !== targetId);
  const target = loops.find((loop) => loop.id === targetId);

  const rememberedSelection = useAppStore((s) => s.loopCopySelection);
  const rememberedSourceId = useAppStore((s) => s.loopCopySourceId);
  const setLoopCopySelection = useAppStore((s) => s.setLoopCopySelection);

  const [sourceId, setSourceId] = useState(() => resolveCopySourceId(sources, rememberedSourceId));
  const [selected, setSelected] = useState<LoopCopyGroupId[]>(() => [...rememberedSelection]);

  const source = sources.find((loop) => loop.id === sourceId) ?? sources[0];

  // Set the moment the user directly checks or unchecks 'key' itself — the
  // one signal that a "no key" state is a decision, not just a rule that
  // never fired. Once true, nothing else in this dialog session may run
  // withImpliedKey again; a quick chip is the one exception, since it
  // replaces the whole selection and so replaces that decision too.
  // A restored selection that omits 'key' while its progression is ticked and
  // the keys differ was a deliberate untick, so it starts already-touched to
  // keep the next toggle from silently re-adding 'key'.
  const keyTouchedRef = useRef(restoreKeyTouched(rememberedSelection, source, target));

  if (!target || !source) return null;

  const toggle = (id: LoopCopyGroupId) => {
    if (id === 'key') keyTouchedRef.current = true;
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((group) => group !== id);
      const next = [...prev, id];
      // The implied-key default is re-derived only when the box that DRIVES
      // the rule is the one just ticked. Running it over every toggle (as
      // this used to) re-added 'key' the moment any OTHER box was ticked,
      // even after the user had explicitly unticked it — withImpliedKey has
      // no way to tell "never considered" apart from "removed on purpose".
      // Also gated on keyTouchedRef, same as pickSource below: re-ticking
      // 'chord-progression' after the user has explicitly unticked 'key'
      // must not silently re-add it either.
      return id === 'chord-progression' && !keyTouchedRef.current
        ? withImpliedKey(source, target, next)
        : next;
    });
  };

  // A chip replaces the whole selection, so it replaces any earlier explicit
  // 'key' decision along with it — re-arm the derivation rather than leaving
  // it stuck off.
  const pickChip = (kind: LoopCopyQuickChip) => {
    keyTouchedRef.current = false;
    setSelected(withImpliedKey(source, target, quickChipSelection(kind)));
  };

  const keyNotice = loopKeyNotice(source, target, selected);
  const barsNotice = loopBarsNotice(source, target, selected);

  const apply = () => {
    setLoopCopySelection(selected, source.id);
    onApply(targetId, source.id, selected);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy into "${labels[targetId] ?? ''}"`}
      size="md"
      boxClassName="space-y-4"
    >
      <label className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
          From
        </span>
        <select
          id="select-loop-copy-source"
          aria-label="Copy from loop"
          value={sourceId}
          onChange={(event) => {
            const id = event.target.value;
            setSourceId(id);
            const nextSource = sources.find((loop) => loop.id === id);
            // Skip the re-derivation once the user has explicitly touched
            // 'key' — a source swap is an unrelated change and must not
            // clobber that decision, the same trap toggle() above already
            // guards against for an unrelated checkbox tick.
            if (nextSource && !keyTouchedRef.current) {
              setSelected((prev) => withImpliedKey(nextSource, target, prev));
            }
          }}
          className="select select-sm select-bordered flex-1 text-xs"
        >
          {sources.map((loop) => (
            <option key={loop.id} value={loop.id}>
              {loopCopySourceOption(loop, labels[loop.id] ?? '')}
            </option>
          ))}
        </select>
      </label>

      <CopyQuickChips onPick={pickChip} />

      <CopyDetails selected={selected} onToggle={toggle} />

      {keyNotice && <CopyNotice>{keyNotice}</CopyNotice>}
      {barsNotice && <CopyNotice>{barsNotice}</CopyNotice>}

      <CopyDialogActions
        disabled={selected.length === 0}
        onApply={apply}
        onCancel={onClose}
      />
    </Modal>
  );
}
