import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  leadDispatchTicks,
  leadScheduleHits,
  leadStepAction,
  type LeadArming,
} from './useLeadPlayback';

describe('leadStepAction', () => {
  test('a stopped player is idle and never arms', () => {
    const arming: LeadArming = { armed: false };
    expect(leadStepAction('stopped', 0, arming, 16)).toBe('idle');
    expect(arming.armed).toBe(false);
  });

  test('arms on the first bar line, plays while armed', () => {
    const arming: LeadArming = { armed: false };
    expect(leadStepAction('playing', 5, arming, 16)).toBe('idle');
    expect(leadStepAction('playing', 16, arming, 16)).toBe('play');
    expect(leadStepAction('playing', 17, arming, 16)).toBe('play');
  });

  test('a soft stop keeps playing to the bar line, then stops there', () => {
    const arming: LeadArming = { armed: true };
    expect(leadStepAction('stopping', 20, arming, 16)).toBe('play');
    expect(leadStepAction('stopping', 32, arming, 16)).toBe('soft-stop');
  });
});

describe('useLeadPlayback shares the one HARD_STOP_RELEASE', () => {
  test('declares no local copy and still uses the shared constant', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/loop/lead/useLeadPlayback.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^const HARD_STOP_RELEASE/m);
    expect(source).toContain('HARD_STOP_RELEASE');
  });
});

describe('useLeadPlayback feeds the loop gate and the sounding notes into the scheduler', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/loop/lead/useLeadPlayback.ts'),
    'utf8',
  );

  test('reads leadGate live from the store inside the clock callback', () => {
    expect(source).toContain('s.leadGate');
  });

  test('resolves triggers from leadSoundingNotes, not a step note set', () => {
    expect(source).toContain('leadSoundingNotes(s.leadMelodySteps, column, stepsPerBar, stride)');
    expect(source).not.toContain('leadStepNotes');
  });
});

describe('leadDispatchTicks', () => {
  test('at 1/16 a dispatch owns exactly one column, as it always did', () => {
    expect(leadDispatchTicks(0, 2)).toEqual([0]);
    expect(leadDispatchTicks(1, 2)).toEqual([2]);
    expect(leadDispatchTicks(7, 2)).toEqual([14]);
  });

  test('at 1/32 a dispatch owns two, and only 1/32 ever does', () => {
    expect(leadDispatchTicks(0, 1)).toEqual([0, 1]);
    expect(leadDispatchTicks(3, 1)).toEqual([6, 7]);
  });

  test('at 1/8 every other dispatch owns none', () => {
    // An even stride can never land on an odd tick, so this is the same
    // formula, not a special case: the range simply contains no on-grid
    // tick on the odd 16ths.
    expect(leadDispatchTicks(0, 4)).toEqual([0]);
    expect(leadDispatchTicks(1, 4)).toEqual([]);
    expect(leadDispatchTicks(2, 4)).toEqual([4]);
    expect(leadDispatchTicks(3, 4)).toEqual([]);
  });

  test('a nonsense stride still yields the on-clock tick, never a hang', () => {
    expect(leadDispatchTicks(2, 0)).toEqual([4]);
  });
});

describe('leadScheduleHits — the arp runs on the clock, not on the grid', () => {
  // tickDur of 1 keeps the offsets readable: one tick == one unit.
  test('at 1/16 both branches are exactly today: one hit, this column, no offset', () => {
    for (const step of [0, 1, 5, 16]) {
      const block = leadScheduleHits(step, 2, 16, false, 1);
      const arp = leadScheduleHits(step, 2, 16, true, 1);
      expect(block).toEqual([{ column: step % 16, offsetSec: 0 }]);
      expect(arp).toEqual(block);
    }
  });

  test('at 1/8 the arp fires on EVERY 16th, on the column sounding there', () => {
    // The odd 16th has no column of its own; the 1/8 column that started on
    // the even one is still sounding, so that is what feeds the arp. Gating
    // on "does a column start here" would drop these dispatches entirely.
    expect(leadScheduleHits(0, 4, 8, true, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
    expect(leadScheduleHits(1, 4, 8, true, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
    expect(leadScheduleHits(2, 4, 8, true, 1)).toEqual([{ column: 1, offsetSec: 0 }]);
    expect(leadScheduleHits(3, 4, 8, true, 1)).toEqual([{ column: 1, offsetSec: 0 }]);
    // The block path is unchanged by this: it still owns columns only.
    expect(leadScheduleHits(1, 4, 8, false, 1)).toEqual([]);
  });

  test('at 1/32 the arp fires ONCE per dispatch, not twice', () => {
    expect(leadScheduleHits(3, 1, 32, true, 1)).toEqual([{ column: 6, offsetSec: 0 }]);
    // The block path is the branch that owns both 1/32 columns.
    expect(leadScheduleHits(3, 1, 32, false, 1)).toEqual([
      { column: 6, offsetSec: 0 },
      { column: 7, offsetSec: 1 },
    ]);
  });

  test('both branches wrap into the loop', () => {
    expect(leadScheduleHits(8, 2, 8, true, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
    expect(leadScheduleHits(8, 2, 8, false, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
  });
});
