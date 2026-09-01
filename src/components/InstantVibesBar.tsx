import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, Dices } from 'lucide-react';
import { VIBE_CHIPS, type VibeChip } from '../store/vibeChips';
import { useAppStore } from '../store/store';

/**
 * The vibe table plus the two actions, loaded on demand.
 *
 * instantVibes.ts resolves every vibe's chords, drum pattern and effect chain
 * at module-evaluation time, so a static import here put ~45 KB of source
 * (instantVibes + vibeVariation + vibeDrumPatterns + vibeEffectChains) into
 * the eagerly-parsed main chunk for a bar that renders eight names and eight
 * emoji. None of it is needed until a chip is clicked.
 *
 * The promise is cached, so the module is fetched and evaluated at most once.
 */
let vibeActionsPromise: Promise<{
  INSTANT_VIBES: import('../types').InstantVibe[];
  selectVibe: typeof import('./vibeActions').selectVibe;
  rerollVibe: typeof import('./vibeActions').rerollVibe;
}> | null = null;

export function loadVibeActions() {
  if (!vibeActionsPromise) {
    vibeActionsPromise = Promise.all([
      import('./vibeActions'),
      import('../store/instantVibes'),
    ]).then(([actions, table]) => ({
      INSTANT_VIBES: table.INSTANT_VIBES,
      selectVibe: actions.selectVibe,
      rerollVibe: actions.rerollVibe,
    }));
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

export const InstantVibesBar: React.FC = React.memo(() => {
  const selectedVibeId = useAppStore((s) => s.selectedVibeId);

  type VibeToast =
    | { kind: 'load'; text: string }
    | { kind: 'reroll'; headline: string; detail: string };

  const [toast, setToast] = useState<VibeToast | null>(null);
  const [rollingVibeId, setRollingVibeId] = useState<string | null>(null);
  const bpm = useAppStore((s) => s.bpm);
  const scaleRoot = useAppStore((s) => s.scaleRoot);

  // Only one toast and one spin can be pending at a time. Without tracking
  // these, clicking a chip and then its dice within the chip's 3s toast
  // window lets the chip's older timer fire and dismiss the reroll toast
  // early; and a timer left running past unmount would call setState on an
  // unmounted component.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, []);

  const scheduleToastClear = (ms: number) =>
    scheduleTimeout(toastTimerRef, () => setToast(null), ms);

  // Prefetch so the click is never the first time this module is fetched.
  // Idle time after mount covers the common case; hover/focus covers a user
  // who clicks within the first idle-callback window.
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

  const handleSelectVibe = async (chip: VibeChip) => {
    const { INSTANT_VIBES, selectVibe } = await loadVibeActions();
    const vibe = INSTANT_VIBES.find((v) => v.id === chip.id);
    if (!vibe) return;
    selectVibe(vibe, { onToast: (text) => setToast({ kind: 'load', text }) });
    scheduleToastClear(3000);
  };

  const handleReroll = async (chip: VibeChip) => {
    const { INSTANT_VIBES, rerollVibe } = await loadVibeActions();
    const vibe = INSTANT_VIBES.find((v) => v.id === chip.id);
    if (!vibe) return;
    setRollingVibeId(chip.id);
    try {
      rerollVibe(vibe, { onToast: (t) => setToast({ kind: 'reroll', ...t }) });
      // 400 ms of spin, then the icon settles; the toast holds longer because
      // its second line has more to read than the load toast's one.
      scheduleToastClear(4000);
    } finally {
      // Robust to rerollVibe throwing: the spin must stop either way, or the
      // dice would spin forever.
      scheduleTimeout(spinTimerRef, () => setRollingVibeId(null), 400);
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
          {VIBE_CHIPS.map((vibe) => {
            const isSelected = selectedVibeId === vibe.id;

            const chip = (
              <button
                id={`btn-vibe-${vibe.id}`}
                onClick={() => handleSelectVibe(vibe)}
                onMouseEnter={prefetch}
                onFocus={prefetch}
                title={`${vibe.name} (${vibe.bpm} BPM · ${vibe.scaleRoot} ${vibe.scaleType})`}
                className={`btn btn-xs group gap-1.5 font-semibold whitespace-nowrap shrink-0 normal-case ${
                  isSelected
                    ? `${vibe.hasVariation ? 'join-item ' : ''}btn-primary`
                    : 'btn-soft'
                }`}
              >
                <span className="text-xs leading-none">{vibe.emoji}</span>
                <span className="font-medium">{vibe.name}</span>
                <span className="text-[9px] font-mono opacity-70">
                  {/* The loaded chip is the always-visible readout of what is
                      actually loaded: after a reroll the authored BPM is no
                      longer true, and there is no undo to fall back on. */}
                  {isSelected ? `${scaleRoot} · ${bpm}` : vibe.bpm}
                </span>
              </button>
            );

            if (!isSelected || !vibe.hasVariation) {
              return <React.Fragment key={vibe.id}>{chip}</React.Fragment>;
            }

            return (
              <div key={vibe.id} className="join shrink-0">
                {chip}
                <button
                  id={`btn-vibe-reroll-${vibe.id}`}
                  onClick={() => handleReroll(vibe)}
                  title={`Reroll ${vibe.name}`}
                  aria-label={`Reroll ${vibe.name}`}
                  className="join-item btn btn-xs btn-primary btn-square"
                >
                  <Dices
                    className={`w-3.5 h-3.5 ${
                      rollingVibeId === vibe.id ? 'animate-spin motion-reduce:animate-none' : ''
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {/* Collapse toggle & Feedback banner */}
        <div className="flex items-center gap-1.5 shrink-0">
          {toast && (
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
          )}
        </div>
      </div>
    </div>
  );
});
