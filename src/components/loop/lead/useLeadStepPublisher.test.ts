import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leadMarkerPublishes } from './useLeadStepPublisher';
import { clampLeadCursor } from '@/audio/leadMelody';
import { clockStepToGridColumn } from '@/audio/leadLiveRecord';
import { LEAD_STEP_RESOLUTION_IDS, columnsPerBar, strideFor } from '@/utils/stepResolution';
import { METERS, METER_IDS } from '@/utils/meter';

const TICK_DUR = 0.0625; // one 1/32 at 120bpm; the offsets are all that use it.

/**
 * What the marker shows at the instant clock step `s` SOUNDS, given the
 * hits each dispatch publishes.
 *
 * Modelled as real time rather than as "the hits of this dispatch": at 1/8 a
 * column spans two clock 16ths, so an odd step publishes nothing at all and
 * the marker is still showing what the previous even step put there. A test
 * that only looked at the current dispatch would read `undefined` and never
 * notice that the marker and the recorder had parted company.
 */
function markerAt(steps: number[], stride: number, columns: number): number[] {
  const shown: number[] = [];
  let marker = 0;
  for (const step of steps) {
    const hits = leadMarkerPublishes(step, stride, columns, TICK_DUR);
    // Everything at offset 0 has landed by the time the step sounds.
    for (const hit of hits.filter((h) => h.offsetSec === 0)) marker = hit.column;
    shown.push(marker);
    // The rest land before the next dispatch.
    for (const hit of hits.filter((h) => h.offsetSec > 0)) marker = hit.column;
  }
  return shown;
}

/**
 * The one claim DEV-378 makes: the marker is the column recording writes at.
 *
 * The recorder's own arithmetic is reproduced here from leadRecord.ts —
 * clockStepToGridColumn then clampLeadCursor — rather than asserted against
 * a hard-coded table, because what must hold is that the two AGREE, not that
 * either one returns some particular number.
 */
describe('the marker column is the recorder write column', () => {
  for (const meterId of METER_IDS) {
    for (const resolution of LEAD_STEP_RESOLUTION_IDS) {
      test(`${meterId} at ${resolution}, over two loops`, () => {
        const stepsPerBar = METERS[meterId].stepsPerBar;
        const stride = strideFor(resolution);
        const loopLength = 4;
        const columns = loopLength * columnsPerBar(stepsPerBar, stride);
        // Two full loops, so the wrap at the seam is covered too.
        const steps = Array.from({ length: loopLength * stepsPerBar * 2 }, (_, i) => i);

        const shown = markerAt(steps, stride, columns);
        const written = steps.map((step) =>
          clampLeadCursor(
            clockStepToGridColumn(step, columns, stride),
            loopLength,
            stepsPerBar,
            stride,
          ),
        );
        expect(shown).toEqual(written);
      });
    }
  }
});

describe('leadMarkerPublishes', () => {
  test('1/32 publishes both of the dispatch own columns, the second half a 16th later', () => {
    const hits = leadMarkerPublishes(3, strideFor('1/32'), 64, TICK_DUR);
    expect(hits).toEqual([
      { column: 6, offsetSec: 0 },
      { column: 7, offsetSec: TICK_DUR },
    ]);
  });

  test('1/16 publishes exactly one column per dispatch, on the dispatch own time', () => {
    const hits = leadMarkerPublishes(3, strideFor('1/16'), 32, TICK_DUR);
    expect(hits).toEqual([{ column: 3, offsetSec: 0 }]);
  });

  test('1/8 publishes on even steps only, because a column spans two 16ths', () => {
    const stride = strideFor('1/8');
    expect(leadMarkerPublishes(2, stride, 16, TICK_DUR)).toEqual([{ column: 1, offsetSec: 0 }]);
    expect(leadMarkerPublishes(3, stride, 16, TICK_DUR)).toEqual([]);
  });

  test('wraps at the loop end rather than running past it', () => {
    expect(leadMarkerPublishes(16, strideFor('1/16'), 16, TICK_DUR)).toEqual([
      { column: 0, offsetSec: 0 },
    ]);
  });
});

/**
 * Structural pins. The gate and the single-producer rule both live inside a
 * clock callback and a React effect, which this suite cannot render — and
 * both are exactly the kind of thing a later edit narrows back by accident.
 * DEV-374's first attempt at this feature widened the CONSUMER without the
 * producer and froze the marker at a stale zero; these two assertions are
 * what would have caught the mirror-image mistake.
 */
describe('the lead step producer', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/loop/lead/useLeadStepPublisher.ts'),
    'utf8',
  );

  test('is gated on leadMarkerFollowsClock, never on the lead player alone', () => {
    expect(source).toContain('leadMarkerFollowsClock');
    expect(source).not.toContain('useAppStore((s)');
  });

  test('is the only thing in the app that publishes a lead step', () => {
    const producers = ['src/components/loop/lead/useLeadStepPublisher.ts', 'src/components/loop/lead/useLeadPlayback.ts']
      .map((file) => readFileSync(join(process.cwd(), file), 'utf8'))
      .map((text) => (text.match(/publishStepAt\(\s*'lead'/g) ?? []).length);
    expect(producers).toEqual([1, 0]);
  });
});
