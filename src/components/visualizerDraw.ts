import {
  createThemePalette,
  resolveThemeFontFamily,
  rgbToCss,
  type Rgb,
  type ThemeToken,
} from '@/utils/themeColor';

/**
 * The canvas half of `AudioVisualizer`, as pure functions of a frame.
 *
 * It lives in its own module for the same reason `themeColor.ts` does: a
 * canvas cannot take a class, so every colour and every font here is resolved
 * from a live theme token at draw time — and none of that is React. What is
 * left in the component is the loop that READS the analyser (which is the part
 * the layering exemption in `eslint.config.js` actually covers) and the frame
 * dispatch below it.
 */

/** A role or token colour, optionally alpha-composited, off the live palette. */
export interface VisualizerColors {
  role: (alpha?: number) => string;
  token: (token: ThemeToken, alpha?: number) => string;
}

/**
 * Per-visualizer drawing state that has to survive from one frame to the next:
 * the spectrum bars' peak-hold heights and the spectrum wave's smoothed
 * previous frame. Passed in rather than held at module scope, so two mounted
 * visualizers never share a curve.
 */
export interface VisualizerFrameState {
  peaks: number[];
  prevData: number[];
}

/** A frame's surface, its geometry in CSS pixels, and its data. */
export interface VisualizerFrame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  data: Uint8Array;
  isSounding: boolean;
  colors: VisualizerColors;
  state: VisualizerFrameState;
}

const ROLE_TOKEN: Record<'primary' | 'secondary' | 'accent', ThemeToken> = {
  primary: '--color-primary',
  secondary: '--color-secondary',
  accent: '--color-accent',
};

/**
 * The frame's two colour lookups. `palette` is a getter, not a value: the
 * component caches the palette in a ref (getComputedStyle flushes layout, so
 * it must never be in the frame loop) and falls back to building one only if
 * the effect has not run yet.
 */
export function visualizerColors(
  role: 'primary' | 'secondary' | 'accent',
  palette: () => Record<ThemeToken, Rgb> | null,
): VisualizerColors {
  const resolve = (): Record<ThemeToken, Rgb> => palette() ?? createThemePalette();
  return {
    role: (alpha?: number) => rgbToCss(resolve()[ROLE_TOKEN[role]], alpha),
    token: (token: ThemeToken, alpha?: number) => rgbToCss(resolve()[token], alpha),
  };
}

/** The resting line a visualizer with no analyser at all draws. */
export function drawIdleLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colors: VisualizerColors,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.strokeStyle = colors.token('--color-base-content', 0.35);
  ctx.lineWidth = 1.5;
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

/** Logarithmic frequency data sampling: 20Hz - ~18kHz over `numPoints`. */
function getLogFrequencyData(data: Uint8Array, numPoints: number, len: number): number[] {
  const result: number[] = new Array(numPoints).fill(0);
  const minBin = 1;
  const maxBin = Math.max(minBin + 1, Math.floor(len * 0.85));

  for (let i = 0; i < numPoints; i++) {
    const fractionStart = i / numPoints;
    const fractionEnd = (i + 1) / numPoints;

    // Exponential/logarithmic bin mapping
    const startBin = Math.min(
      maxBin - 1,
      Math.floor(minBin * Math.pow(maxBin / minBin, fractionStart)),
    );
    const endBin = Math.min(
      maxBin,
      Math.max(startBin + 1, Math.floor(minBin * Math.pow(maxBin / minBin, fractionEnd))),
    );

    let sum = 0;
    let count = 0;
    let peak = 0;

    for (let b = startBin; b < endBin; b++) {
      const val = data[b] || 0;
      sum += val;
      if (val > peak) peak = val;
      count++;
    }

    const avg = count > 0 ? sum / count : 0;
    const blended = avg * 0.65 + peak * 0.35;
    // Treble compensation tilt
    const trebleTilt = 1 + (i / numPoints) * 0.4;
    result[i] = Math.min(255, blended * trebleTilt);
  }

  return result;
}

/** Spectrum bars, logarithmically scaled, with per-bar peak hold. */
export function drawSpectrumBars(frame: VisualizerFrame): void {
  const { ctx: c, width: w, height: h, data, isSounding, colors, state } = frame;
  const len = data.length;
  // ~4x the old resolution. The cap is the analyser's own bin count — you
  // cannot draw more bars than there are frequency bins to fill them, and
  // asking getLogFrequencyData for more just duplicates neighbours.
  const barCount = Math.min(100, len, Math.max(24, Math.floor(w / 3)));
  const gap = barCount > 48 ? 0.5 : 1.5;
  const barWidth = Math.max(1, (w - (barCount - 1) * gap) / barCount);
  const logData = isSounding ? getLogFrequencyData(data, barCount, len) : new Array(barCount).fill(0);

  if (state.peaks.length !== barCount) {
    state.peaks = new Array(barCount).fill(0);
  }

  // Bar-independent, so they are built once per frame rather than once
  // per bar: `barCount` reaches 100, and each rebuild cost a gradient
  // plus three palette lookups and template-string builds.
  const barGradient = c.createLinearGradient(0, h, 0, 0);
  barGradient.addColorStop(0, colors.role(0.55));
  barGradient.addColorStop(0.7, colors.role(0.9));
  barGradient.addColorStop(1, colors.role(1));
  const peakColor = colors.token('--color-base-content', 0.85);

  for (let i = 0; i < barCount; i++) {
    const val = logData[i] || 0;
    const percent = isSounding ? val / 255 : 0;
    const barHeight = isSounding ? Math.max(2, percent * (h - 4)) : 0;
    const x = i * (barWidth + gap);
    const y = h - barHeight;

    // Peak drop falloff
    if (barHeight > state.peaks[i]) {
      state.peaks[i] = barHeight;
    } else {
      state.peaks[i] = Math.max(0, state.peaks[i] - (isSounding ? 0.6 : 1.2));
    }

    if (barHeight > 0) {
      c.fillStyle = barGradient;
      c.beginPath();
      if (c.roundRect) {
        c.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      } else {
        c.rect(x, y, barWidth, barHeight);
      }
      c.fill();
    }

    // Peak line
    if (state.peaks[i] > 1) {
      const peakY = h - state.peaks[i] - 1;
      c.fillStyle = peakColor;
      c.fillRect(x, Math.max(0, peakY), barWidth, 1.5);
    }
  }
}

/** The smoothed points one spectrum-wave frame draws. */
function spectrumWavePoints(frame: VisualizerFrame, samplePoints: number): { x: number; y: number }[] {
  const { width: w, height: h, data, isSounding, state } = frame;
  const logData = isSounding
    ? getLogFrequencyData(data, samplePoints, data.length)
    : new Array(samplePoints).fill(0);
  const points: { x: number; y: number }[] = [];

  // Smooth with previous frame for fluid animation
  if (state.prevData.length !== samplePoints) {
    state.prevData = new Array(samplePoints).fill(0);
  }

  for (let i = 0; i < samplePoints; i++) {
    const raw = logData[i] || 0;
    // Interpolate for buttery smoothness (fast decay if sound stopped)
    const decayFactor = isSounding ? 0.35 : 0.7;
    const smoothed = state.prevData[i] * decayFactor + (isSounding ? (raw / 255) * (1 - decayFactor) : 0);
    state.prevData[i] = smoothed;

    const x = (i / (samplePoints - 1)) * w;
    // If sound is playing, use magnitude; if idle/silent, sit flat at bottom baseline
    const y = isSounding ? h - Math.max(2, smoothed * (h - 4)) - 2 : h - 2;

    points.push({ x, y });
  }

  return points;
}

/** Spectrum wave: a log-scaled curve under an area gradient fill. */
export function drawSpectrumWave(frame: VisualizerFrame): void {
  const { ctx: c, width: w, height: h, isSounding, colors } = frame;
  const samplePoints = 56;
  const points = spectrumWavePoints(frame, samplePoints);

  if (isSounding) {
    // Draw Gradient Area Fill
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colors.role(0.45));
    grad.addColorStop(0.5, colors.role(0.2));
    grad.addColorStop(1, colors.role(0));

    c.beginPath();
    c.moveTo(points[0].x, h);
    c.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      c.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    c.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    c.lineTo(w, h);
    c.closePath();
    c.fillStyle = grad;
    c.fill();
  }

  // Top glowing stroke line (or flat resting baseline when idle)
  c.beginPath();
  c.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    c.quadraticCurveTo(p0.x, p0.y, midX, midY);
  }
  c.lineTo(points[points.length - 1].x, points[points.length - 1].y);

  c.shadowBlur = isSounding ? 10 : 0;
  c.shadowColor = colors.role();
  c.strokeStyle = isSounding ? colors.role() : colors.token('--color-base-content', 0.35);
  c.lineWidth = isSounding ? 2 : 1;
  c.stroke();
  c.shadowBlur = 0; // reset
}

/** The dashed grid and the +1 / 0 / -1 labels a panel-sized scope wears. */
function drawScopeAxes(frame: VisualizerFrame): void {
  const { ctx: c, width: w, height: h, colors } = frame;
  const centerY = h / 2;
  // 1. Axis reference grid: +1 top, 0 centre, -1 bottom.
  c.beginPath();
  c.strokeStyle = colors.token('--color-base-content', 0.25);
  c.lineWidth = 1;
  c.setLineDash([3, 3]);

  c.moveTo(0, 3);
  c.lineTo(w, 3);

  c.moveTo(0, centerY);
  c.lineTo(w, centerY);

  c.moveTo(0, h - 3);
  c.lineTo(w, h - 3);
  c.stroke();
  c.setLineDash([]);

  // 2. Axis scale labels.
  c.fillStyle = colors.token('--color-base-content', 0.6);
  // Canvas cannot take a class, so the family is named here — but READ
  // from `--font-sans` rather than re-typed, the same way every colour on
  // this canvas comes from a token. A literal here is a third copy of the
  // stack that a rebrand would leave behind, and the theme guard cannot
  // catch it (it bans monospace, not sans).
  c.font = `8px ${resolveThemeFontFamily()}`;
  c.fillText('+1', 3, 9);
  c.fillText(' 0', 3, centerY + 3);
  c.fillText('-1', 3, h - 5);
}

/** The trace's sample points: triggered at centre when sounding, flat when not. */
function scopePoints(
  data: Uint8Array,
  w: number,
  centerY: number,
  amplitudeLimit: number,
  isSounding: boolean,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];

  if (!isSounding) {
    // When completely idle / silent, render a clean resting flat line at centerY
    points.push({ x: 0, y: centerY });
    points.push({ x: w, y: centerY });
    return points;
  }

  // Trigger detection, anchored at the CENTRE of the display the way a
  // hardware scope does it: the rising zero-crossing is placed at w/2 and
  // the samples before it fill the left half. Drawing from the trigger at
  // x=0 (what this did before) throws away every pre-trigger sample and
  // pins the waveform to the left edge.
  const len = data.length;
  const span = Math.min(len, 512);
  const half = Math.floor(span / 2);

  // Search forward from `half` so a trigger found still has `half`
  // samples of history behind it to draw.
  let triggerIndex = half;
  for (let i = half; i < len - 1 && i < half + 256; i++) {
    if (data[i] < 128 && data[i + 1] >= 128) {
      triggerIndex = i;
      break;
    }
  }

  const startIndex = triggerIndex - half;
  const sliceWidth = w / (span - 1);

  for (let i = 0; i < span; i++) {
    const idx = startIndex + i;
    // 128 is the byte value of silence, so out-of-range reads rest on the
    // centre line rather than snapping the trace to a corner.
    const rawByte = idx >= 0 && idx < len && data[idx] !== undefined ? data[idx] : 128;
    // Normalized from -1.0 (negative trough) to +1.0 (positive crest), centered at 0
    const normalized = (rawByte - 128) / 128.0;
    const x = i * sliceWidth;
    // Positive goes UP (y decreases), Negative goes DOWN (y increases), Zero stays at centerY
    const y = centerY - normalized * amplitudeLimit;
    points.push({ x, y });
  }

  return points;
}

/**
 * Oscilloscope: the time-domain trace, positive up and negative down, with the
 * axis furniture the caller can afford. An inline scope is a couple of dozen
 * CSS pixels tall, so `showAxes` is false there and the trace gets that height
 * back — labels and a dashed grid at that size crowd out the wave they
 * annotate.
 */
export function drawOscilloscope(frame: VisualizerFrame, showAxes: boolean): void {
  const { ctx: c, width: w, height: h, data, isSounding, colors } = frame;
  const centerY = h / 2;
  // Full half-height either way: +1 reaches the top edge and -1 the bottom,
  // with 0 on centerY. Leaving 4px of slack made a small scope look like it
  // only had a positive half.
  const amplitudeLimit = Math.max(2, h / 2 - (showAxes ? 3 : 1));

  if (showAxes) drawScopeAxes(frame);

  const points = scopePoints(data, w, centerY, amplitudeLimit, isSounding);
  if (points.length === 0) return;

  const beamColor = colors.role();

  // 3. Draw subtle dual-sided center glow fill when sounding
  if (isSounding) {
    c.beginPath();
    c.moveTo(points[0].x, centerY);
    for (let i = 0; i < points.length; i++) {
      c.lineTo(points[i].x, points[i].y);
    }
    c.lineTo(points[points.length - 1].x, centerY);
    c.closePath();
    c.fillStyle = colors.role(0.14);
    c.fill();
  }

  // 4. Draw Oscilloscope Beam Curve (or flat line at centerY)
  c.beginPath();
  c.moveTo(points[0].x, points[0].y);

  if (points.length > 2) {
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      c.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    c.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  } else {
    c.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  }

  c.shadowBlur = isSounding ? 10 : 0;
  c.shadowColor = beamColor;
  c.strokeStyle = isSounding ? beamColor : colors.token('--color-base-content', 0.4);
  c.lineWidth = isSounding ? 2.2 : 1.2;
  c.stroke();
  c.shadowBlur = 0;
}
