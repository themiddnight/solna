import React from 'react';
import { audioEngine } from '@/audio/engine';
import { attachTickMeter } from '@/utils/meterAttach';
import { formatReduction, quantiseReduction, reductionPercent } from '@/utils/gainReduction';

export interface GainReductionMeterProps {
  /** Which master dynamics stage to read. */
  stage: 'compressor' | 'limiter';
  /**
   * False while the stage is bypassed. The meter then registers nothing and
   * reads a flat 0 dB — which is also what the engine would report, since a
   * bypassed stage is disconnected from the graph.
   */
  active: boolean;
}

/**
 * The gain-reduction readout for one master dynamics stage: what the safety
 * net is actually doing, in dB, so "on" is visible rather than a claim.
 *
 * Reads audioEngine directly (layering rule 3 exemption, alongside
 * AudioVisualizer / VuMeter / AmbientBackdrop). The value must NOT enter a
 * zustand slice: all four tab views stay mounted, so a store write per frame
 * would re-render every one of them.
 *
 * Ticking is delegated to the shared meter scheduler with NO analyser — the
 * scheduler hands back a zero-length buffer and throttles to the 'master' tier.
 * The registration is gated on THIS component's own root element via
 * `attachTickMeter`'s `visibilityElement`, which is what stops it in a view
 * nobody is looking at: solna's four tab views all stay mounted, so
 * `document.visibilitychange` alone (a hidden BROWSER tab) would leave this
 * reading `.reduction` at 60Hz while the user is on the Synth tab. The gate
 * lives here rather than in a prop the caller passes, so a future second
 * caller cannot forget it.
 *
 * State commits only when the QUANTISED reading moves (0.5 dB), so a stage
 * hovering around one value re-renders two <span>s occasionally instead of
 * sixty times a second.
 */
export const GainReductionMeter = React.memo(function GainReductionMeter({
  stage,
  active,
}: GainReductionMeterProps) {
  const [reduction, setReduction] = React.useState(0);
  const lastRef = React.useRef(0);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!active) {
      lastRef.current = 0;
      setReduction(0);
      return;
    }
    return attachTickMeter({
      id: `gain-reduction-${stage}`,
      tier: 'master',
      visibilityElement: rootRef.current,
      onTick: () => {
        const raw =
          stage === 'compressor'
            ? audioEngine.getCompressorReduction()
            : audioEngine.getLimiterReduction();
        const next = quantiseReduction(raw);
        if (next !== lastRef.current) {
          lastRef.current = next;
          setReduction(next);
        }
      },
    });
  }, [active, stage]);

  return (
    <div ref={rootRef} className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-base-content/60">
        <span>Gain Reduction</span>
        <span className={active ? 'font-mono text-success' : 'font-mono text-base-content/40'}>
          {formatReduction(reduction)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-base-300">
        <div
          className="h-full rounded-full bg-success transition-[width] duration-75"
          style={{ width: `${reductionPercent(reduction)}%` }}
        />
      </div>
    </div>
  );
});
