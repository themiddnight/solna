import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Dices } from 'lucide-react';
import { VIBES, type VibeSpec } from '../data/vibes';
import { useAppStore } from '../store/store';
import { formatKeyLabel, getTonicSpelling } from '@/utils/noteSpelling';
import { scheduleTimeout } from './ui/useTimedToast';

/**
 * The two vibe actions, loaded on demand.
 *
 * `VIBES` is imported eagerly above and costs one file: data/vibes.ts imports
 * nothing at runtime, so its transitive graph is empty. What still must not be
 * eager is `./vibeActions`, which reaches applyVibeToStore and from there
 * audio/engine, playbackEngine and the four library resolvers. None of that is
 * needed until a chip is clicked.
 *
 * The promise is cached, so the module is fetched and evaluated at most once.
 */
let vibeActionsPromise: Promise<typeof import('./vibeActions')> | null = null;

function loadVibeActions() {
  if (!vibeActionsPromise) {
    vibeActionsPromise = import('./vibeActions');
  }
  return vibeActionsPromise;
}

/** 400 ms of spin, then the dice icon settles. */
const ROLLING_MS = 400;

/**
 * Warm the lazy `./vibeActions` module so a click is never the first time it is
 * fetched. Idle time after mount covers the common case; hover/focus covers a
 * user who clicks within the first idle-callback window.
 */
function useVibePrefetch(): () => void {
  const prefetch = useCallback(() => { void loadVibeActions(); }, []);

  useEffect(() => {
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (idle) {
      idle(() => { void loadVibeActions(); }, { timeout: 2000 });
      return;
    }
    const timer = setTimeout(() => { void loadVibeActions(); }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return prefetch;
}

/**
 * The dice spin and its one stop timer. Only one spin can be pending at a
 * time, and a timer left running past unmount would call setState on an
 * unmounted component. (The load/reroll confirmation is the feedback host's —
 * see vibeActions.ts.)
 */
function useDiceSpin() {
  const [rollingVibeId, setRollingVibeId] = useState<string | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      // A pending timer id is written by a later click, never by this effect,
      // so only the ref read at cleanup time can name the timer still armed.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, []);

  const setSpin = useCallback((vibeId: string) => setRollingVibeId(vibeId), []);

  const scheduleSpinStop = useCallback((ms: number) => {
    scheduleTimeout(spinTimerRef, () => setRollingVibeId(null), ms);
  }, []);

  return { rollingVibeId, setSpin, scheduleSpinStop };
}

interface VibeChipProps {
  vibe: VibeSpec;
  isSelected: boolean;
  /** What the chip's third line reads: see the call site. */
  readout: string;
  rolling: boolean;
  onSelect: (vibe: VibeSpec) => void;
  onReroll: (vibe: VibeSpec) => void;
  onPrefetch: () => void;
}

/**
 * One vibe chip. The selected chip of a random vibe carries its dice button in
 * a `join` group beside it, so the two read as one control.
 */
function VibeChip({
  vibe,
  isSelected,
  readout,
  rolling,
  onSelect,
  onReroll,
  onPrefetch,
}: VibeChipProps) {
  const chip = (
    <button
      id={`btn-vibe-${vibe.id}`}
      onClick={() => onSelect(vibe)}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      title={`${vibe.name} (${vibe.bpm} BPM · ${formatKeyLabel(vibe.scaleRoot, vibe.scaleType)})`}
      className={`btn btn-xs group gap-1.5 font-semibold whitespace-nowrap shrink-0 normal-case ${
        isSelected ? `${vibe.random ? 'join-item ' : ''}btn-primary` : 'btn-soft'
      }`}
    >
      <span className="text-xs leading-none">{vibe.emoji}</span>
      <span className="font-medium">{vibe.name}</span>
      <span className="text-[9px] tabular-nums opacity-70">{readout}</span>
    </button>
  );

  if (!isSelected || !vibe.random) {
    return <React.Fragment>{chip}</React.Fragment>;
  }

  return (
    <div className="join shrink-0">
      {chip}
      <button
        id={`btn-vibe-reroll-${vibe.id}`}
        onClick={() => onReroll(vibe)}
        title={`Reroll ${vibe.name}`}
        aria-label={`Reroll ${vibe.name}`}
        className="join-item btn btn-xs btn-primary btn-square"
      >
        <Dices
          className={`w-3.5 h-3.5 ${
            rolling ? 'animate-spin motion-reduce:animate-none' : ''
          }`}
        />
      </button>
    </div>
  );
}

export const InstantVibesBar = React.memo(function InstantVibesBar() {
  const selectedVibeId = useAppStore((s) => s.selectedVibeId);
  const bpm = useAppStore((s) => s.bpm);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  const prefetch = useVibePrefetch();
  const { rollingVibeId, setSpin, scheduleSpinStop } = useDiceSpin();

  const handleSelectVibe = async (vibe: VibeSpec) => {
    const { selectVibe } = await loadVibeActions();
    selectVibe(vibe);
  };

  const handleReroll = async (vibe: VibeSpec) => {
    const { rerollVibe } = await loadVibeActions();
    setSpin(vibe.id);
    try {
      rerollVibe(vibe);
    } finally {
      // Robust to rerollVibe throwing: the spin must stop either way, or the
      // dice would spin forever.
      scheduleSpinStop(ROLLING_MS);
    }
  };

  return (
    <div className="shrink-0 bg-base-300 border-b border-base-300 px-3 py-1.5 select-none transition-all">
      <div className="flex items-center justify-between gap-2 max-w-full">
        {/* Left Label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-bold tracking-wide uppercase text-base-content/80">
            Vibes
          </span>
        </div>

        {/* Horizontal Scrolling Vibe Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 no-scrollbar scroll-smooth flex-1 max-w-full">
          {VIBES.map((vibe) => {
            const isSelected = selectedVibeId === vibe.id;
            // The loaded chip is the always-visible readout of what is
            // actually loaded: after a reroll the authored BPM is no longer
            // true, and there is no undo to fall back on.
            const readout = isSelected
              ? `${getTonicSpelling(scaleRoot, scaleType)} · ${bpm}`
              : String(vibe.bpm);

            return (
              <VibeChip
                key={vibe.id}
                vibe={vibe}
                isSelected={isSelected}
                readout={readout}
                rolling={rollingVibeId === vibe.id}
                onSelect={handleSelectVibe}
                onReroll={handleReroll}
                onPrefetch={prefetch}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
