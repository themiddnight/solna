export type { ArpRate } from '../types';
import type { ArpRate } from '../types';

export interface ArpTrigger {
  noteIndex: number;
  timeOffsetSec: number;
  holdSec: number;
}

// One row per arpRate. stepMod: fire every N sixteenth steps (1 = every step,
// so the modulo always passes). notes: note count per trigger. holdFloor/holdFactor
// reproduce each original branch's hold math exactly (32n uses the half-step
// duration and a 0.03 floor; the others use the full step and 0.04).
const ARP_RATE_CFG: Record<ArpRate, { stepMod: number; notes: number; holdFloor: number; holdFactor: number }> = {
  '4n': { stepMod: 4, notes: 1, holdFloor: 0.04, holdFactor: 4 * 0.85 },
  '8n': { stepMod: 2, notes: 1, holdFloor: 0.04, holdFactor: 2 * 0.85 },
  '16n': { stepMod: 1, notes: 1, holdFloor: 0.04, holdFactor: 1 * 0.85 },
  '32n': { stepMod: 0.5, notes: 2, holdFloor: 0.03, holdFactor: 0.5 * 0.85 },
};

/**
 * `step` must already be BAR-PHASED by `arpStepFor` (utils/meter.ts) at the
 * call site. Passing the raw monotonic clock step makes the arp phase drift
 * across bar lines in any meter whose bar is not a multiple of four steps.
 */
/**
 * Whether `rate` fires anything at all on this bar-phased step.
 *
 * Exists so a clock subscriber can skip the expensive `buildArpSequence` on
 * the four-in-five steps a 4n arp does not fire on — the sequence used to be
 * built BEFORE computeArpTriggers got a chance to say "nothing here".
 *
 * `step` must already be bar-phased by `arpStepFor`, exactly like
 * computeArpTriggers' own `step`.
 */
export function arpFiresOnStep(step: number, rate: ArpRate): boolean {
  return step % ARP_RATE_CFG[rate].stepMod === 0;
}

export function computeArpTriggers(step: number, seqLen: number, rate: ArpRate, stepDur16: number): ArpTrigger[] {
  if (!arpFiresOnStep(step, rate)) return [];
  const cfg = ARP_RATE_CFG[rate];
  const subDur = cfg.notes === 2 ? stepDur16 / 2 : stepDur16;
  const triggers: ArpTrigger[] = [];
  for (let i = 0; i < cfg.notes; i++) {
    const noteIndex = cfg.notes === 2 ? (step * 2 + i) % seqLen : Math.floor(step / cfg.stepMod) % seqLen;
    triggers.push({
      noteIndex,
      timeOffsetSec: cfg.notes === 2 ? i * subDur : 0,
      holdSec: Math.max(cfg.holdFloor, cfg.holdFactor * stepDur16),
    });
  }
  return triggers;
}
