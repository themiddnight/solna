import React from 'react';
import { loadLoop } from '../../store/loadLoop';
import { useAppStore } from '../../store/store';

/** Pure handler behind the dropdown, exported for a store-driven test. */
export const onSelectLoop = (id: string) => loadLoop(id);

/**
 * The loop picker, shown in the header on the loop layer. Picking calls the
 * same atomic loadLoop swap as the Arrange tab, so it changes WHICH loop the
 * editing tabs target.
 */
export const LoopSelector: React.FC = () => {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  return (
    <select
      id="select-loop"
      value={activeLoopId}
      onChange={(e) => onSelectLoop(e.target.value)}
      className="select select-sm select-ghost font-bold text-primary max-w-24 sm:max-w-32 truncate"
      title="Active Loop"
    >
      {loops.map((loop) => (
        <option key={loop.id} value={loop.id}>
          {loop.name}
        </option>
      ))}
    </select>
  );
};
