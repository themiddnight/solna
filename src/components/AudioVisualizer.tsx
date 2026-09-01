import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../audio/engine';
import {
  createThemePalette,
  rgbToCss,
  subscribeToThemeChange,
  type Rgb,
  type ThemeToken,
} from '../utils/themeColor';

export type VisualizerMode = 'wave' | 'bars' | 'oscilloscope';

/**
 * Single source of truth for the mode names shown in this component's own
 * legend/controls AND in any caller-rendered switcher (e.g.
 * `EffectsRackView`'s Spectrum/Bars/Waveform buttons). Both used to spell
 * these out separately and drifted ("Spectrum Wave" vs "Spectrum") — read
 * from here instead of re-typing the strings.
 */
export const VISUALIZER_MODE_LABEL: Record<VisualizerMode, string> = {
  wave: 'Spectrum',
  bars: 'Bars',
  oscilloscope: 'Waveform',
};

/**
 * The mode order, shared by the canvas click-to-cycle gesture and any
 * caller-rendered switcher. The set and its order used to be spelled out
 * separately in both places, so a fourth mode would have had to be added
 * twice — exactly the split `VISUALIZER_MODE_LABEL` closed for the names.
 */
export const VISUALIZER_MODES = Object.keys(VISUALIZER_MODE_LABEL) as VisualizerMode[];

/**
 * Consecutive silent frames before the render loop drops to a low rate.
 *
 * 90 frames is 1.5 s at 60 fps: past the tail of any release this app can
 * produce, so a decaying note never stutters, but short enough that an idle
 * tab stops burning a full canvas repaint within two seconds.
 */
export const SILENT_FRAMES_BEFORE_THROTTLE = 90;

/** ~10 fps while silent — enough for the idle trace to look alive. */
export const THROTTLED_FRAME_INTERVAL_MS = 100;

export interface SilenceThrottle {
  silentFrames: number;
  lastDrawAtMs: number;
}

export function initialSilenceThrottle(): SilenceThrottle {
  return { silentFrames: 0, lastDrawAtMs: Number.NEGATIVE_INFINITY };
}

/**
 * Whether this frame should draw, and the next state.
 *
 * The rAF loop is gated on `paused` (tab visibility) but was never gated on
 * whether anything is SOUNDING, so a visible tab repainted a full canvas at
 * 60 fps into silence for the whole session. The analyser reads stay
 * every-frame — they are two getByte* calls into pre-allocated buffers, and
 * they are what detects the return of sound; only the draw is skipped.
 *
 * Pure, and exported, so the state machine is testable without a canvas, a
 * DOM or a real animation frame (this repo has no testing-library setup).
 */
export function nextSilenceThrottle(
  state: SilenceThrottle,
  isSounding: boolean,
  nowMs: number,
): { state: SilenceThrottle; shouldDraw: boolean } {
  if (isSounding) {
    // Snap back instantly: one sounding frame is enough, so the first sample
    // of a new note is drawn on the frame it arrives.
    return { state: { silentFrames: 0, lastDrawAtMs: nowMs }, shouldDraw: true };
  }
  const silentFrames = state.silentFrames + 1;
  if (silentFrames <= SILENT_FRAMES_BEFORE_THROTTLE) {
    return { state: { silentFrames, lastDrawAtMs: nowMs }, shouldDraw: true };
  }
  if (nowMs - state.lastDrawAtMs >= THROTTLED_FRAME_INTERVAL_MS) {
    return { state: { silentFrames, lastDrawAtMs: nowMs }, shouldDraw: true };
  }
  return { state: { silentFrames, lastDrawAtMs: state.lastDrawAtMs }, shouldDraw: false };
}

interface AudioVisualizerProps {
  mode?: VisualizerMode;
  className?: string;
  height?: number | string;
  /** Semantic role the visualizer paints in. Resolved at runtime from the
   *  active daisyUI theme by src/utils/themeColor.ts. */
  colorTheme?: 'primary' | 'secondary' | 'accent';
  /**
   * Freeze the render loop. `App.tsx` keeps all four views mounted (toggling
   * `block`/`hidden`) so audio never stops on a tab switch, which means a
   * visualizer inside a view would otherwise keep an rAF loop alive on every
   * hidden tab. Callers inside a view MUST bind this to their tab's activity.
   */
  paused?: boolean;
  /**
   * Makes `mode` controlled: when provided, the canvas quick-toggle click
   * calls this instead of writing
   * to internal state, and the component renders strictly from the `mode`
   * prop. Required whenever a caller renders its own mode switcher alongside
   * this component (e.g. `EffectsRackView`) — otherwise the canvas click and
   * the caller's switcher fight over two separate sources of truth. Omit it
   * for a simple, self-contained visualizer with no external switcher.
   */
  onModeChange?: (mode: VisualizerMode) => void;
  /**
   * Tap one source layer's bus (`'synth' | 'chord' | 'bass'`) instead of the
   * master output. The layer bus sits after the VCA but before the parallel
   * sends, so the trace is that patch alone rather than the finished mix —
   * which is what makes the Synth view's scope follow its Target selector.
   * Omit for the master analyser.
   */
  source?: string;
  /**
   * 'panel' is the full widget: click-to-cycle, the live-signal legend, and
   * the optional mode buttons. 'inline' is a fixed read-only trace for a
   * control row — no legend, and no click handler, so a stray click cannot
   * cycle a dedicated oscilloscope away from the mode its caller chose.
   */
  variant?: 'panel' | 'inline';
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = React.memo(({
  mode: initialMode = 'wave',
  className = '',
  height = 40,
  colorTheme = 'primary',
  paused = false,
  onModeChange,
  source,
  variant = 'panel',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [internalMode, setInternalMode] = useState<VisualizerMode>(initialMode);
  // Controlled/uncontrolled split (same shape as a plain <input>): when the
  // caller passes `onModeChange` it owns `mode` entirely and this component
  // never keeps its own copy that could drift from the caller's switcher.
  const isControlled = onModeChange !== undefined;
  const mode = isControlled ? initialMode : internalMode;
  const setMode = (next: VisualizerMode) => {
    if (onModeChange) {
      onModeChange(next);
    } else {
      setInternalMode(next);
    }
  };
  // Sounding indicator is updated imperatively from the rAF loop — a React
  // state update here would re-render the component every frame.
  const indicatorRef = useRef<HTMLSpanElement | null>(null);

  // Analyser scratch buffers. The render loop runs 60x/sec, so allocating
  // these per frame would hand the GC ~1.5KB every frame, per instance —
  // they are reused and only reallocated when the analyser's size changes,
  // the same guard `AudioEngine.getAudioLevel` uses for its own buffer.
  const freqBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Peak hold data for spectrum bars
  const peaksRef = useRef<number[]>([]);
  const prevDataRef = useRef<number[]>([]);

  // Silence throttle state, in a ref: it is per-frame bookkeeping, so a
  // useState here would re-render the component 60 times a second — the same
  // reason indicatorRef exists.
  const throttleRef = useRef<SilenceThrottle>(initialSilenceThrottle());

  // Resolved theme colours, cached across frames. The rAF loop runs 60x/sec,
  // and getComputedStyle is a layout-flushing call, so it must never be in it.
  // Built by the effect below, which runs before the first frame. A lazy
  // init here as well would build the palette twice at mount — 12
  // getComputedStyle reads and up to 12 probe elements — and throw the first
  // one away unused.
  const paletteRef = useRef<Record<ThemeToken, Rgb> | null>(null);

  useEffect(() => {
    const refresh = () => {
      paletteRef.current = createThemePalette();
    };
    refresh();
    return subscribeToThemeChange(refresh);
  }, []);

  useEffect(() => {
    // Controlled mode renders straight from `initialMode` already (see
    // `mode` above); re-deriving internal state here too would just be a
    // second, redundant write.
    if (isControlled) return;
    setInternalMode(initialMode);
  }, [initialMode, isControlled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const ROLE_TOKEN: Record<'primary' | 'secondary' | 'accent', ThemeToken> = {
      primary: '--color-primary',
      secondary: '--color-secondary',
      accent: '--color-accent',
    };

    /** Theme colour for the active role, optionally alpha-composited. */
    const roleColor = (alpha?: number): string => {
      const palette = paletteRef.current ?? createThemePalette();
      return rgbToCss(palette[ROLE_TOKEN[colorTheme]], alpha);
    };

    /** Any theme token, optionally alpha-composited. */
    const tokenColor = (token: ThemeToken, alpha?: number): string => {
      const palette = paletteRef.current ?? createThemePalette();
      return rgbToCss(palette[token], alpha);
    };

    const render = () => {
      const analyser = source === undefined
        ? audioEngine.getAnalyser()
        : audioEngine.getSourceAnalyser(source);
      // The backing store is sized in device pixels and the context is scaled
      // by the same dpr, so the drawing math must be in CSS pixels or every
      // shape comes out dpr-times too big and its bottom half falls off the
      // canvas. That is what hid the oscilloscope's whole negative half: -1
      // was being drawn a full canvas-height below the visible area.
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      if (!analyser) {
        // Idle placeholder line
        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.strokeStyle = tokenColor('--color-base-content', 0.35);
        ctx.lineWidth = 1.5;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        animationId = requestAnimationFrame(render);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      if (freqBufRef.current?.length !== bufferLength) {
        freqBufRef.current = new Uint8Array(bufferLength);
      }
      // Time-domain data is fftSize long, NOT frequencyBinCount (= fftSize/2).
      // Sizing this buffer off frequencyBinCount handed the scope half a window
      // and made its trigger search miss cycles it should have locked onto.
      if (timeBufRef.current?.length !== analyser.fftSize) {
        timeBufRef.current = new Uint8Array(analyser.fftSize);
      }
      const freqData = freqBufRef.current;
      const timeData = timeBufRef.current;

      // The oscilloscope draws from timeData alone, so neither the frequency
      // read nor the avgEnergy loop earns its keep there — and SynthView
      // keeps an inline scope alive alongside the panel visualizer.
      const needsFrequencyData = mode !== 'oscilloscope';
      if (needsFrequencyData) {
        analyser.getByteFrequencyData(freqData);
      }
      analyser.getByteTimeDomainData(timeData);

      // Check if there is actual audio activity (filter out digital silence & DC bias)
      let maxDeviation = 0;
      for (let i = 0; i < timeData.length; i++) {
        const dev = Math.abs(timeData[i] - 128);
        if (dev > maxDeviation) maxDeviation = dev;
      }

      // Strictly consider sounding only if audio is genuinely active. The
      // spectrum modes keep the original two-term test verbatim: maxDeviation
      // alone would also accept a sub-audio LFO sweep that avgEnergy rejects.
      // The oscilloscope uses the time-domain term only — it has no frequency
      // data to consult, and a DC offset is a steady deviation from 128 that
      // maxDeviation catches on its own.
      let isSounding: boolean;
      if (needsFrequencyData) {
        let energy = 0;
        for (let i = 0; i < bufferLength; i++) {
          energy += freqData[i];
        }
        isSounding = energy / bufferLength > 2.5 && maxDeviation > 3;
      } else {
        isSounding = maxDeviation > 3;
      }
      const indicator = indicatorRef.current;
      if (indicator && indicator.dataset.sounding !== String(isSounding)) {
        indicator.dataset.sounding = String(isSounding);
        indicator.className = isSounding
          ? 'w-1.5 h-1.5 rounded-full bg-success animate-ping'
          : 'w-1.5 h-1.5 rounded-full bg-base-content/30';
      }

      // Nothing is sounding and nothing has been for SILENT_FRAMES_BEFORE_
      // THROTTLE frames: keep reading the analyser (that is how sound is
      // detected) but stop repainting the canvas every frame. The canvas is
      // NOT cleared on a skipped frame, so the last drawn image simply stays.
      const throttle = nextSilenceThrottle(
        throttleRef.current,
        isSounding,
        performance.now(),
      );
      throttleRef.current = throttle.state;
      if (!throttle.shouldDraw) {
        animationId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      if (mode === 'bars') {
        renderBars(ctx, width, height, freqData, bufferLength, isSounding);
      } else if (mode === 'oscilloscope') {
        renderOscilloscope(ctx, width, height, timeData, timeData.length, isSounding);
      } else {
        // 'wave' spectrum wave
        renderSpectrumWave(ctx, width, height, freqData, bufferLength, isSounding);
      }

      animationId = requestAnimationFrame(render);
    };

    // Helper: Logarithmic frequency data sampling
    const getLogFrequencyData = (
      data: Uint8Array,
      numPoints: number,
      len: number
    ): number[] => {
      const result: number[] = new Array(numPoints).fill(0);
      const minBin = 1;
      const maxBin = Math.max(minBin + 1, Math.floor(len * 0.85)); // 20Hz - ~18kHz range

      for (let i = 0; i < numPoints; i++) {
        const fractionStart = i / numPoints;
        const fractionEnd = (i + 1) / numPoints;

        // Exponential/logarithmic bin mapping
        const startBin = Math.min(
          maxBin - 1,
          Math.floor(minBin * Math.pow(maxBin / minBin, fractionStart))
        );
        const endBin = Math.min(
          maxBin,
          Math.max(
            startBin + 1,
            Math.floor(minBin * Math.pow(maxBin / minBin, fractionEnd))
          )
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
    };

    // Helper: Spectrum Bars (Logarithmic scale)
    const renderBars = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      isSounding: boolean
    ) => {
      // ~4x the old resolution. The cap is the analyser's own bin count — you
      // cannot draw more bars than there are frequency bins to fill them, and
      // asking getLogFrequencyData for more just duplicates neighbours.
      const barCount = Math.min(100, len, Math.max(24, Math.floor(w / 3)));
      const gap = barCount > 48 ? 0.5 : 1.5;
      const barWidth = Math.max(1, (w - (barCount - 1) * gap) / barCount);
      const logData = isSounding ? getLogFrequencyData(data, barCount, len) : new Array(barCount).fill(0);

      if (peaksRef.current.length !== barCount) {
        peaksRef.current = new Array(barCount).fill(0);
      }

      // Bar-independent, so they are built once per frame rather than once
      // per bar: `barCount` reaches 100, and each rebuild cost a gradient
      // plus three palette lookups and template-string builds.
      const barGradient = c.createLinearGradient(0, h, 0, 0);
      barGradient.addColorStop(0, roleColor(0.55));
      barGradient.addColorStop(0.7, roleColor(0.9));
      barGradient.addColorStop(1, roleColor(1));
      const peakColor = tokenColor('--color-base-content', 0.85);

      for (let i = 0; i < barCount; i++) {
        const val = logData[i] || 0;
        const percent = isSounding ? val / 255 : 0;
        const barHeight = isSounding ? Math.max(2, percent * (h - 4)) : 0;
        const x = i * (barWidth + gap);
        const y = h - barHeight;

        // Peak drop falloff
        if (barHeight > peaksRef.current[i]) {
          peaksRef.current[i] = barHeight;
        } else {
          peaksRef.current[i] = Math.max(0, peaksRef.current[i] - (isSounding ? 0.6 : 1.2));
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
        if (peaksRef.current[i] > 1) {
          const peakY = h - peaksRef.current[i] - 1;
          c.fillStyle = peakColor;
          c.fillRect(x, Math.max(0, peakY), barWidth, 1.5);
        }
      }
    };

    // Helper: Spectrum Wave (Logarithmic Scale curve with area gradient fill)
    const renderSpectrumWave = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      isSounding: boolean
    ) => {
      const samplePoints = 56;
      const logData = isSounding ? getLogFrequencyData(data, samplePoints, len) : new Array(samplePoints).fill(0);
      const points: { x: number; y: number }[] = [];

      // Smooth with previous frame for fluid animation
      if (prevDataRef.current.length !== samplePoints) {
        prevDataRef.current = new Array(samplePoints).fill(0);
      }

      for (let i = 0; i < samplePoints; i++) {
        const raw = logData[i] || 0;
        // Interpolate for buttery smoothness (fast decay if sound stopped)
        const decayFactor = isSounding ? 0.35 : 0.7;
        const smoothed = prevDataRef.current[i] * decayFactor + (isSounding ? (raw / 255) * (1 - decayFactor) : 0);
        prevDataRef.current[i] = smoothed;

        const x = (i / (samplePoints - 1)) * w;
        // If sound is playing, use magnitude; if idle/silent, sit flat at bottom baseline
        const y = isSounding
          ? h - Math.max(2, smoothed * (h - 4)) - 2
          : h - 2;

        points.push({ x, y });
      }

      if (isSounding) {
        // Draw Gradient Area Fill
        const grad = c.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, roleColor(0.45));
        grad.addColorStop(0.5, roleColor(0.2));
        grad.addColorStop(1, roleColor(0));

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
      c.shadowColor = roleColor();
      c.strokeStyle = isSounding
        ? roleColor()
        : tokenColor('--color-base-content', 0.35);
      c.lineWidth = isSounding ? 2 : 1;
      c.stroke();
      c.shadowBlur = 0; // reset
    };

    // Helper: Oscilloscope (Time-Domain Wave with Centered X-Axis, Positive Up & Negative Down)
    const renderOscilloscope = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      isSounding: boolean
    ) => {
      const centerY = h / 2;
      // An inline scope is a couple of dozen CSS pixels tall, so the axis
      // furniture below is dropped there and the trace gets the height back —
      // labels and a dashed grid at that size crowd out the wave they annotate.
      const showAxes = variant !== 'inline';
      // Full half-height either way: +1 reaches the top edge and -1 the bottom,
      // with 0 on centerY. Leaving 4px of slack made a small scope look like it
      // only had a positive half.
      const amplitudeLimit = Math.max(2, (h / 2) - (showAxes ? 3 : 1));

      if (showAxes) {
        // 1. Axis reference grid: +1 top, 0 centre, -1 bottom.
        c.beginPath();
        c.strokeStyle = tokenColor('--color-base-content', 0.25);
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
        c.fillStyle = tokenColor('--color-base-content', 0.6);
        c.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
        c.fillText('+1', 3, 9);
        c.fillText(' 0', 3, centerY + 3);
        c.fillText('-1', 3, h - 5);
      }

      const points: { x: number; y: number }[] = [];

      if (!isSounding) {
        // When completely idle / silent, render a clean resting flat line at centerY
        points.push({ x: 0, y: centerY });
        points.push({ x: w, y: centerY });
      } else {
        // Trigger detection, anchored at the CENTRE of the display the way a
        // hardware scope does it: the rising zero-crossing is placed at w/2 and
        // the samples before it fill the left half. Drawing from the trigger at
        // x=0 (what this did before) throws away every pre-trigger sample and
        // pins the waveform to the left edge.
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
        const activeSamples = span;
        const sliceWidth = w / (activeSamples - 1);

        for (let i = 0; i < activeSamples; i++) {
          const idx = startIndex + i;
          // 128 is the byte value of silence, so out-of-range reads rest on the
          // centre line rather than snapping the trace to a corner.
          const rawByte = idx >= 0 && idx < len && data[idx] !== undefined ? data[idx] : 128;
          // Normalized from -1.0 (negative trough) to +1.0 (positive crest), centered at 0
          const normalized = (rawByte - 128) / 128.0;
          const x = i * sliceWidth;
          // Positive goes UP (y decreases), Negative goes DOWN (y increases), Zero stays at centerY
          const y = centerY - (normalized * amplitudeLimit);
          points.push({ x, y });
        }
      }

      if (points.length === 0) return;

      const beamColor = roleColor();

      // 3. Draw subtle dual-sided center glow fill when sounding
      if (isSounding) {
        c.beginPath();
        c.moveTo(points[0].x, centerY);
        for (let i = 0; i < points.length; i++) {
          c.lineTo(points[i].x, points[i].y);
        }
        c.lineTo(points[points.length - 1].x, centerY);
        c.closePath();
        c.fillStyle = roleColor(0.14);
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
      c.strokeStyle = isSounding
        ? beamColor
        : tokenColor('--color-base-content', 0.4);
      c.lineWidth = isSounding ? 2.2 : 1.2;
      c.stroke();
      c.shadowBlur = 0;
    };

    // Resize handling with devicePixelRatio for sharp rendering
    const handleResize = () => {
      if (!containerRef.current || !canvas) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      // setTransform, not scale: ResizeObserver fires this on every layout
      // change and scale() multiplies onto whatever transform is already
      // there, so repeated resizes compounded to dpr^n.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // App.tsx keeps every tab's view mounted (block/hidden), so a hidden
    // view's visualizer must never schedule a frame — skipping draw work
    // inside a still-running loop would still burn rAF callbacks forever.
    // Resize tracking stays live (cheap, and keeps the canvas correctly
    // sized for when the tab reappears); only the render loop is gated.
    if (paused) {
      return () => {
        resizeObserver.disconnect();
      };
    }

    throttleRef.current = initialSilenceThrottle();
    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
    };
  }, [mode, colorTheme, paused, source, variant]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        className={`w-full h-full block transition-opacity ${
          variant === 'inline' ? '' : 'cursor-pointer'
        }`}
        title={variant === 'inline' ? undefined : 'Click to toggle visualizer mode'}
        onClick={
          variant === 'inline'
            ? undefined
            : () => {
                // Quick toggle through modes on canvas click
                const nextIndex = (VISUALIZER_MODES.indexOf(mode) + 1) % VISUALIZER_MODES.length;
                setMode(VISUALIZER_MODES[nextIndex]);
              }
        }
      />

      {/* Subtle Live Signal Indicator. An inline trace is only a few dozen
          pixels tall and its caller already labels it, so the legend would sit
          on top of the waveform saying nothing new. */}
      <div
        className={`absolute bottom-1 left-2 items-center gap-1 pointer-events-none opacity-60 ${
          variant === 'inline' ? 'hidden' : 'flex'
        }`}
      >
        <span
          ref={indicatorRef}
          className="w-1.5 h-1.5 rounded-full bg-base-content/30"
        />
        <span className="text-[9px] text-base-content/60 uppercase tracking-wider">
          {VISUALIZER_MODE_LABEL[mode]}
        </span>
      </div>
    </div>
  );
});
