import React from 'react';
import { loadLoop } from '@/store/loadLoop';
import { loopLabel } from '@/store/loop';
import { useAppStore } from '@/store/store';
import { GROUP_LABEL, HEADER_FIELD_SHELL, HEADER_SELECT } from '../ui/fieldClasses';

/** Pure handler behind the dropdown, exported for a store-driven test. */
export const onSelectLoop = (id: string) => loadLoop(id);

/**
 * The loop picker, shown in the header on the loop layer. Picking calls the
 * same atomic loadLoop swap as the Arrange tab, so it changes WHICH loop the
 * editing tabs target.
 *
 * It carries its own caption, in the same shell the key/scale pair wears: a
 * bare ghost select in the navbar showed a loop NAME with nothing saying it was
 * a loop, which read as a label rather than a control. The caption shows at
 * every width (UX F-10): on the phone it used to drop, and the header then
 * showed a bare name that read as a title. The room for it comes from the
 * wordmark, whose text hides below `sm` (Wordmark.tsx), so the select keeps
 * `w-32` from 360px up; only a 320px phone narrows it to `w-24`, where the
 * shell would otherwise run over the wordmark (measured, review 4123990330).
 */
export function LoopSelector() {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  return (
    <div className={HEADER_FIELD_SHELL}>
      <span className={GROUP_LABEL}>Loop</span>
      <select
        id="select-loop"
        value={activeLoopId}
        onChange={(e) => onSelectLoop(e.target.value)}
        className={`${HEADER_SELECT} text-primary w-24 min-[360px]:w-32`}
        title="Active Loop"
      >
        {loops.map((loop) => (
          <option key={loop.id} value={loop.id}>
            {loopLabel(loop)}
          </option>
        ))}
      </select>
    </div>
  );
}
