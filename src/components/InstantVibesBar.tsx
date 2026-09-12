import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, Dices } from 'lucide-react';
import { VIBES, type VibeSpec } from '../data/vibes';
import { useAppStore } from '../store/store';
import { formatKeyLabel, getTonicSpelling } from '@/utils/noteSpelling';

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

export function loadVibeActions() {
  if (!vibeActionsPromise) {
    vibeActionsPromise = import('./vibeActions');
  }
  return vibeActionsPromise;
}

/** Cancels whatever this ref has pending, then schedules `fn` to replace it. */
function scheduleTimeout(
  ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  fn: () => void,
  ms: number,
): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = setTimeout(fn, ms);
}

type VibeToast =
  | { kind: 'load'; text: string }
  | { kind: 'reroll'; headline: string; detail: string };

/** How long the load toast stays; the reroll's holds longer, its second line
 *  having more to read than the load toast's one. */
const LOAD_TOAST_MS = 3000;
const REROLL_TOAST_MS = 4000;
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
 * The bar's one toast and the dice spin, each with its own dismissal timer.
 *
 * Only one toast and one spin can be pending at a time. Without tracking both,
 * clicking a chip and then its dice within the chip's 3s toast window lets the
 * chip's older timer fire and dismiss the reroll toast early; and a timer left
 * running past unmount would call setState on an unmounted component.
 */
function useVibeFeedback() {
  const [toast, setToast] = useState<VibeToast | null>(null);
  const [rollingVibeId, setRollingVibeId] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      // A pending timer id is written by a later click, never by this effect,
      // so only the ref read at cleanup time can name the timer still armed.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, []);

  const showToast = useCallback((next: VibeToast, ms: number) => {
    setToast(next);
    scheduleTimeout(toastTimerRef, () => setToast(null), ms);
  }, []);

  const setSpin = useCallback((vibeId: string) => setRollingVibeId(vibeId), []);

  const scheduleSpinStop = useCallback((ms: number) => {
    scheduleTimeout(spinTimerRef, () => setRollingVibeId(null), ms);
  }, []);

  return { toast, rollingVibeId, showToast, setSpin, scheduleSpinStop };
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

/** The bar's feedback banner: a load confirmation or a reroll summary. */
function VibeToastBanner({ toast }: { toast: VibeToast }) {
  return (
    <div className="toast toast-top toast-end animate-fade-in">
      {toast.kind === 'load' ? (
        <div className="alert alert-success alert-soft py-1 px-2 text-[10px] gap-1">
          <Check className="w-3 h-3" />
          <span className="hidden md:inline">{toast.text}</span>
          <span className="md:hidden">Loaded</span>
        </div>
      ) : (
        // A different colour role from the load toast, so a reroll and
        // a load are visually distinct at a glance.
        <div className="alert alert-info alert-soft py-1 px-2 text-[10px] gap-1">
          <div className="hidden md:flex flex-col items-start gap-0.5">
            <span className="font-semibold">{toast.headline}</span>
            <span className="opacity-80">{toast.detail}</span>
          </div>
          <span className="md:hidden">🎲 Rerolled</span>
        </div>
      )}
    </div>
  );
}

export const InstantVibesBar = React.memo(function InstantVibesBar() {
  const selectedVibeId = useAppStore((s) => s.selectedVibeId);
  const bpm = useAppStore((s) => s.bpm);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  const prefetch = useVibePrefetch();
  const { toast, rollingVibeId, showToast, setSpin, scheduleSpinStop } = useVibeFeedback();

  const handleSelectVibe = async (vibe: VibeSpec) => {
    const { selectVibe } = await loadVibeActions();
    selectVibe(vibe, { onToast: (text) => showToast({ kind: 'load', text }, LOAD_TOAST_MS) });
  };

  const handleReroll = async (vibe: VibeSpec) => {
    const { rerollVibe } = await loadVibeActions();
    setSpin(vibe.id);
    try {
      rerollVibe(vibe, {
        onToast: (t) => showToast({ kind: 'reroll', ...t }, REROLL_TOAST_MS),
      });
    } finally {
      // Robust to rerollVibe throwing: the spin must stop either way, or the
      // dice would spin forever.
      scheduleSpinStop(ROLLING_MS);
    }
  };

  return (
    <div className="shrink-0 bg-base-300 border-b border-base-300 px-3 py-1.5 select-none relative z-30 transition-all">
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

        {/* Collapse toggle & Feedback banner */}
        <div className="flex items-center gap-1.5 shrink-0">
          {toast && <VibeToastBanner toast={toast} />}
        </div>
      </div>
    </div>
  );
});
