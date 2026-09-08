import React from 'react';

export interface GroupFrameProps {
  /**
   * Rendered in caps above the frame's contents. Omitted where the enclosing
   * card is already named for the group — Pattern › Accompaniment — because a
   * second label there duplicates the card title.
   */
  label?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A neutral enclosure that says "these belong together" and nothing else.
 *
 * It NEVER recolors its contents and carries no tint of its own. index.css
 * spaces the module hues around the OKLCH wheel deliberately and records that
 * chord (125deg), bass (256deg) and pad (40deg, the one recorded exception in
 * the amber band) must stay separable; a group tint would undo exactly that,
 * to express a grouping the enclosure already expresses. The frame groups by
 * enclosure; the dots keep saying which is which.
 *
 * Presentation only. controlTarget's persisted values are unchanged.
 */
export function GroupFrame({ label, className, children }: GroupFrameProps) {
  return (
    <div className={`border border-base-300 rounded-box p-1 ${className ?? ''}`}>
      {label !== undefined && (
        <span className="block text-[10px] uppercase tracking-wider text-base-content/50 font-semibold px-1 pb-0.5">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
