import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { MeterBar } from './MeterBar';
import { dbfsToPercent, METER_TICK_DBFS } from '@/utils/meterScale';
import { ZONE_GOOD_MAX, ZONE_TOO_QUIET_MAX } from '@/utils/meterZones';

/** Every `width:N%` in the markup, in order: the peak fill, then the RMS fill. */
function fillWidths(html: string): number[] {
  return [...html.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

/** Every `left:N%` in the markup, in order: the ticks, then the peak-hold marker. */
function markerPositions(html: string): number[] {
  return [...html.matchAll(/left:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

describe('MeterBar', () => {
  test('fills nothing at silence', () => {
    const html = renderToString(<MeterBar peakDbfs={-Infinity} rmsDbfs={-Infinity} />);
    expect(fillWidths(html)).toEqual([0, 0]);
  });

  // The colour is chosen ONCE, from the live peak's zone. Not per segment (which is what the
  // ten-block bar this replaces did, and where its two derivations disagreed), and never as a
  // gradient across the fill element.
  test('takes one colour from the peak zone, and a quiet reading is neutral rather than green', () => {
    const quiet = renderToString(
      <MeterBar peakDbfs={ZONE_TOO_QUIET_MAX - 6} rmsDbfs={ZONE_TOO_QUIET_MAX - 9} />,
    );
    expect(quiet).toContain('bg-base-content/30');
    expect(quiet).not.toContain('bg-success');
  });

  test('a good reading is green, a hot one amber, an over one red', () => {
    expect(renderToString(<MeterBar peakDbfs={-12} rmsDbfs={-15} />)).toContain('bg-success');
    expect(renderToString(<MeterBar peakDbfs={-3} rmsDbfs={-6} />)).toContain('bg-warning');
    expect(renderToString(<MeterBar peakDbfs={-0.2} rmsDbfs={-3} />)).toContain('bg-error');
  });

  // The RMS layer is what makes "how loud is this really?" readable next to "did it spike?".
  // It shares the peak's colour, so it can never read as a second, differently-classified signal.
  test('draws the RMS fill over the peak fill, always the shorter of the two', () => {
    const html = renderToString(<MeterBar peakDbfs={-6} rmsDbfs={-18} />);
    const [peak, rms] = fillWidths(html);
    expect(peak).toBeCloseTo(dbfsToPercent(-6), 5);
    expect(rms).toBeCloseTo(dbfsToPercent(-18), 5);
    expect(rms).toBeLessThan(peak);
  });

  // The two fills share one colour, so opacity is the ONLY thing that makes them two layers
  // rather than one — and it has to be the LONGER (peak) fill that is faint, because a
  // translucent short fill over an opaque long one composites back to the long one's colour and
  // the RMS reading disappears. That is what shipped before this assertion existed, with the
  // width assertions above passing the whole time.
  test('makes the peak fill the faint layer and the RMS fill the solid one', () => {
    const html = renderToString(<MeterBar peakDbfs={-6} rmsDbfs={-18} />);
    const peakFill = /<div[^>]*data-meter-peak-fill[^>]*>/.exec(html)?.[0] ?? '';
    const rmsFill = /<div[^>]*data-meter-rms-fill[^>]*>/.exec(html)?.[0] ?? '';
    expect(peakFill).toContain('opacity-40');
    expect(rmsFill).not.toContain('opacity-');
    // Paint order: the faint peak fill first, the solid RMS fill over it.
    expect(html.indexOf('data-meter-peak-fill')).toBeLessThan(html.indexOf('data-meter-rms-fill'));
  });

  // Ticks are the whole reason a reading is legible without a number beside it: -24 is the floor
  // of "loud enough", -6 the top of "comfortable", 0 the digital ceiling. They come from
  // METER_TICK_DBFS rather than being re-typed here, so they move with the zone boundaries.
  test('draws a tick per METER_TICK_DBFS entry, positioned on the same scale as the fill', () => {
    const html = renderToString(<MeterBar peakDbfs={-Infinity} rmsDbfs={-Infinity} />);
    expect(markerPositions(html)).toEqual(METER_TICK_DBFS.map(dbfsToPercent));
  });

  test('the ticks sit where the piecewise scale puts them, not on a linear ramp', () => {
    // -6 dBFS is 72% of the track, not the 90% a linear -60..0 mapping would give it.
    expect(dbfsToPercent(ZONE_GOOD_MAX)).toBeCloseTo(72, 5);
  });

  test('draws the held-peak marker only when it is above the live peak', () => {
    const above = renderToString(<MeterBar peakDbfs={-30} rmsDbfs={-36} heldPeakDbfs={-6} />);
    expect(above).toContain('data-meter-hold');
    expect(markerPositions(above)).toContain(dbfsToPercent(-6));

    const below = renderToString(<MeterBar peakDbfs={-6} rmsDbfs={-12} heldPeakDbfs={-30} />);
    expect(below).not.toContain('data-meter-hold');
  });

  test('passes a title through for the tooltip', () => {
    const html = renderToString(
      <MeterBar peakDbfs={-Infinity} rmsDbfs={-Infinity} title="Master peak: -∞ dB" />,
    );
    expect(html).toContain('title="Master peak: -∞ dB"');
  });

  // murva shipped a gradient fill and it put a red tip on the bar at every level, silence
  // included, because a gradient rescales with the element it is painted on. This is the one
  // property that must survive any restyling of this component.
  test('never paints the fill as a gradient, even at full scale', () => {
    const html = renderToString(<MeterBar peakDbfs={0} rmsDbfs={0} />);
    expect(html).not.toContain('gradient');
  });
});
