import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import { focusSynthTarget } from '@/store/focusTrack';
import type { SynthControlTarget } from '@/utils/synthControl';

export function AdjustSynthButton({
  target,
  className = "",
}: {
  target: SynthControlTarget;
  className?: string;
}) {
  const setFocusTrack = useAppStore((s) => s.setFocusTrack);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const label = SYNTH_TARGET_STYLES[target].label;
  return (
    <button
      type="button"
      onClick={() => focusSynthTarget(target, { setFocusTrack, setActiveTab })}
      className={`btn btn-xs btn-ghost gap-1 ${className}`}
      title={`Open the synth view with the ${label} target selected`}
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
      <span>Adjust Synth</span>
    </button>
  );
}
