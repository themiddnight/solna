import type { ReactNode } from 'react';
import { SECTION_HEADER } from '@/components/ui/fieldClasses';
import { SoloButton } from '@/components/ui/SoloButton';
import { AdjustSynthButton } from './AdjustSynthButton';

/**
 * The shell the three Accompaniment modules share: Chord, Bass and Pad.
 *
 * `ui/SectionCard` does this one level up, for the Sound tab's three peer
 * sections. This is the same idea for the three peer module cards inside
 * ChordView, and it exists for the same reason: the three were hand-written
 * copies whose only record of being one thing was a comment in two of them
 * saying "see the note in ChordModulePanel". They had already drifted — the
 * solo/adjust cluster was `gap-1.5` in two and `gap-2` in the third — and every
 * change to the shape (dropping the stale `mt-4`, adding the `role`/
 * `aria-labelledby` pair) had to be made three times and agreed.
 *
 * The header is fixed at [title][description] · [actions][solo][Adjust Synth]
 * because all three want exactly that. `actions` is the one open slot — the
 * paste button, whose group ids differ per module — and it sits left of the
 * solo/adjust pair so those two keep the corner in every card. Pad's mode
 * switch used to sit in this row and was moved down into the body precisely so
 * the three headers could be one thing; keeping the cluster closed here is
 * what stops the next control drifting back into it.
 *
 * `role="group"` plus the heading as its label is what lets every field below
 * drop its `Chord `/`Bass `/`Pad ` prefix: the context a screen reader needs
 * comes from the group, not from repeating the word five times.
 *
 * There is deliberately no `mt-4`. The `GroupFrame` in ChordView owns the
 * spacing between these cards (`p-1` + `gap-3 sm:gap-4`); the margin was left
 * over from when they were direct children of a `space-y` root, and inside the
 * frame it double-counted — a 20px top inset against 4px on the other sides.
 */
export type ModuleTarget = 'chord' | 'bass' | 'pad';

/**
 * The per-module classes, as a table rather than three sets of literals.
 *
 * Spelled out rather than built from `SYNTH_TARGET_STYLES`: the border carries
 * a `/30` alpha, and Tailwind resolves class names at build time from source
 * text, so `border-module-${target}/30` would compile to nothing. One row per
 * module keeps every name a grep can find.
 */
const MODULE_CLASSES: Record<ModuleTarget, { tint: string; border: string; accent: string }> = {
  chord: { tint: 'tint-chord', border: 'border-module-chord/30', accent: 'text-module-chord' },
  bass: { tint: 'tint-bass', border: 'border-module-bass/30', accent: 'text-module-bass' },
  pad: { tint: 'tint-pad', border: 'border-module-pad/30', accent: 'text-module-pad' },
};

export interface ModulePanelCardProps {
  target: ModuleTarget;
  /** e.g. "Chord Module". The card's accessible name. */
  title: string;
  /** The one-line "what this layer does" under the title. */
  description: ReactNode;
  /** Extra header controls (e.g. the paste button), rendered left of the solo/adjust cluster. */
  actions?: ReactNode;
  children: ReactNode;
}

export function ModulePanelCard({ target, title, description, actions, children }: ModulePanelCardProps) {
  const { tint, border, accent } = MODULE_CLASSES[target];
  const titleId = `${target}-module-title`;
  return (
    <div role="group" aria-labelledby={titleId} className={`card bg-panel ${tint} border ${border} p-4`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 id={titleId} className={SECTION_HEADER}>
            {title}
          </h3>
          <p className="text-[10px] text-base-content/60">{description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          <SoloButton track={target} />
          <AdjustSynthButton target={target} className={accent} />
        </div>
      </div>
      {/* Children, not a fixed body row. All three open with a wrapping row of
          labelled fields, but Chord and Bass then carry a full-width step
          editor BELOW that row and inside this card, so the row is the panel's
          shape rather than the card's. */}
      {children}
    </div>
  );
}
