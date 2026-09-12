import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../audio/engine';
import {
  createThemePalette,
  subscribeToThemeChange,
  type Rgb,
  type ThemeToken,
} from '../utils/themeColor';
import {
  drawIdleLine,
  drawOscilloscope,
  drawSpectrumBars,
  drawSpectrumWave,
  visualizerColors,
  type VisualizerColors,
  type VisualizerFrame,
  type VisualizerFrameState,
} from './visualizerDraw';

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
   * Tap one source layer's bus (`'synth' | 'chord' | 'bass' | 'pad'`) instead of the
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

/**
 * The analyser scratch buffers. The render loop runs 60x/sec, so allocating
 * these per frame would hand the GC ~1.5KB every frame, per instance — they
 * are reused and only reallocated when the analyser's size changes. Held in a
 * ref by the component so their lifetime survives an effect re-run.
 */
interface AnalyserBuffers {
  freq: Uint8Array<ArrayBuffer>;
  time: Uint8Array<ArrayBuffer>;
}

/** One frame's worth of read analyser data, already classified. */
interface AnalyserFrame {
  /** Frequency bins for the spectrum modes, the waveform for the scope. */
  data: Uint8Array;
  bufferLength: number;
  isSounding: boolean;
}

/**
 * Whether this frame's audio is genuinely active, so silence can be throttled.
 *
 * `maxDeviation` filters out digital silence and DC bias. The spectrum modes
 * keep the original two-term test verbatim: maxDeviation alone would also
 * accept a sub-audio LFO sweep that avgEnergy rejects. The oscilloscope uses
 * the time-domain term only — it has no frequency data to consult, and a DC
 * offset is a steady deviation from 128 that maxDeviation catches on its own.
 */
function frameIsSounding(
  freqData: Uint8Array,
  timeData: Uint8Array,
  bufferLength: number,
  needsFrequencyData: boolean,
): boolean {
  let maxDeviation = 0;
  for (let i = 0; i < timeData.length; i++) {
    const dev = Math.abs(timeData[i] - 128);
    if (dev > maxDeviation) maxDeviation = dev;
  }

  if (!needsFrequencyData) return maxDeviation > 3;

  let energy = 0;
  for (let i = 0; i < bufferLength; i++) {
    energy += freqData[i];
  }
  return energy / bufferLength > 2.5 && maxDeviation > 3;
}

/**
 * Read one frame: grab the analyser, size the scratch buffers and classify
 * what came back. Null when there is no analyser at all — the engine has not
 * been initialised, or the caller named a source bus that does not exist.
 */
function readAnalyserFrame(
  source: string | undefined,
  mode: VisualizerMode,
  buffers: AnalyserBuffers,
): AnalyserFrame | null {
  const analyser =
    source === undefined ? audioEngine.getAnalyser() : audioEngine.getSourceAnalyser(source);
  if (!analyser) return null;

  const bufferLength = analyser.frequencyBinCount;
  if (buffers.freq.length !== bufferLength) {
    buffers.freq = new Uint8Array(bufferLength);
  }
  // Time-domain data is fftSize long, NOT frequencyBinCount (= fftSize/2).
  // Sizing this buffer off frequencyBinCount handed the scope half a window
  // and made its trigger search miss cycles it should have locked onto.
  if (buffers.time.length !== analyser.fftSize) {
    buffers.time = new Uint8Array(analyser.fftSize);
  }
  const freqData = buffers.freq;
  const timeData = buffers.time;

  // The oscilloscope draws from timeData alone, so neither the frequency
  // read nor the avgEnergy loop earns its keep there — and SoundView
  // keeps an inline scope alive alongside the panel visualizer.
  const needsFrequencyData = mode !== 'oscilloscope';
  if (needsFrequencyData) {
    analyser.getByteFrequencyData(freqData);
  }
  analyser.getByteTimeDomainData(timeData);

  return {
    data: needsFrequencyData ? freqData : timeData,
    bufferLength,
    isSounding: frameIsSounding(freqData, timeData, bufferLength, needsFrequencyData),
  };
}

/**
 * The sounding indicator is updated imperatively from the rAF loop — a React
 * state update here would re-render the component every frame. It is written
 * only on a CHANGE, so a steady trace costs no DOM work at all.
 */
function updateSoundingIndicator(indicator: HTMLSpanElement | null, isSounding: boolean): void {
  if (!indicator || indicator.dataset.sounding === String(isSounding)) return;
  indicator.dataset.sounding = String(isSounding);
  indicator.className = isSounding
    ? 'w-1.5 h-1.5 rounded-full bg-success animate-ping'
    : 'w-1.5 h-1.5 rounded-full bg-base-content/30';
}

/**
 * Size the canvas's backing store to its container, at the current device
 * pixel ratio, and scale the context by the same factor.
 *
 * Both attribute writes are GUARDED, because assigning either one reallocates
 * the backing bitmap and clears it — even when the value is identical. The
 * effect re-runs on every `source`/`mode`/`colorTheme` change (source is the
 * Sound tab's control target), so every target-chip click was dropping a frame
 * to redo work that changed nothing.
 */
function applyCanvasBackingStore(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  ctx: CanvasRenderingContext2D,
): void {
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  // setTransform, not scale: ResizeObserver fires this on every layout
  // change and scale() multiplies onto whatever transform is already
  // there, so repeated resizes compounded to dpr^n.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Resolved theme colours, cached across frames. The rAF loop runs 60x/sec,
 * and getComputedStyle is a layout-flushing call, so it must never be in it.
 * This effect runs before the first frame. A lazy init in the loop as well
 * would build the palette twice at mount — 12 getComputedStyle reads and up
 * to 12 probe elements — and throw the first one away unused.
 */
function useThemePalette(paletteRef: React.RefObject<Record<ThemeToken, Rgb> | null>): void {
  useEffect(() => {
    const refresh = () => {
      paletteRef.current = createThemePalette();
    };
    refresh();
    return subscribeToThemeChange(refresh);
  }, [paletteRef]);
}

interface VisualizerCanvasParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  indicatorRef: React.RefObject<HTMLSpanElement | null>;
  paletteRef: React.RefObject<Record<ThemeToken, Rgb> | null>;
  throttleRef: React.RefObject<SilenceThrottle>;
  buffersRef: React.RefObject<AnalyserBuffers>;
  frameStateRef: React.RefObject<VisualizerFrameState>;
  mode: VisualizerMode;
  colorTheme: 'primary' | 'secondary' | 'accent';
  source: string | undefined;
  variant: 'panel' | 'inline';
  paused: boolean;
}

/**
 * The render loop: read a frame, classify it, throttle it, draw it. Everything
 * it paints with comes from `visualizerDraw`, so this hook is only the loop —
 * which is also the only part of the visualizer that may touch `audioEngine`
 * (see the layering exemption in eslint.config.js).
 */
function useVisualizerCanvas(params: VisualizerCanvasParams): void {
  const {
    canvasRef,
    containerRef,
    indicatorRef,
    paletteRef,
    throttleRef,
    buffersRef,
    frameStateRef,
    mode,
    colorTheme,
    source,
    variant,
    paused,
  } = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const colors: VisualizerColors = visualizerColors(colorTheme, () => paletteRef.current);

    const render = () => {
      // The backing store is sized in device pixels and the context is scaled
      // by the same dpr, so the drawing math must be in CSS pixels or every
      // shape comes out dpr-times too big and its bottom half falls off the
      // canvas. That is what hid the oscilloscope's whole negative half: -1
      // was being drawn a full canvas-height below the visible area.
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const frame = readAnalyserFrame(source, mode, buffersRef.current);

      if (!frame) {
        // Idle placeholder line
        drawIdleLine(ctx, width, height, colors);
        animationId = requestAnimationFrame(render);
        return;
      }

      updateSoundingIndicator(indicatorRef.current, frame.isSounding);

      // Nothing is sounding and nothing has been for SILENT_FRAMES_BEFORE_
      // THROTTLE frames: keep reading the analyser (that is how sound is
      // detected) but stop repainting the canvas every frame. The canvas is
      // NOT cleared on a skipped frame, so the last drawn image simply stays.
      const throttle = nextSilenceThrottle(
        throttleRef.current,
        frame.isSounding,
        performance.now(),
      );
      throttleRef.current = throttle.state;

      if (throttle.shouldDraw) {
        ctx.clearRect(0, 0, width, height);
        const draw: VisualizerFrame = {
          ctx,
          width,
          height,
          data: frame.data,
          isSounding: frame.isSounding,
          colors,
          state: frameStateRef.current,
        };
        if (mode === 'bars') {
          drawSpectrumBars(draw);
        } else if (mode === 'oscilloscope') {
          drawOscilloscope(draw, variant !== 'inline');
        } else {
          // 'wave' spectrum wave
          drawSpectrumWave(draw);
        }
      }

      animationId = requestAnimationFrame(render);
    };

    // Resize handling with devicePixelRatio for sharp rendering
    const handleResize = () => {
      if (!containerRef.current) return;
      applyCanvasBackingStore(canvas, containerRef.current, ctx);
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
  }, [
    canvasRef,
    containerRef,
    indicatorRef,
    paletteRef,
    throttleRef,
    buffersRef,
    frameStateRef,
    mode,
    colorTheme,
    paused,
    source,
    variant,
  ]);
}

interface VisualizerSurfaceProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  variant: 'panel' | 'inline';
  onToggle: () => void;
}

/**
 * The canvas. `absolute`, not in flow: a canvas's WIDTH/HEIGHT ATTRIBUTES are
 * its intrinsic size, and handleResize writes rect.height * dpr into the
 * height attribute. In flow that closes a loop — attribute grows the canvas's
 * intrinsic height, which grows the container, which makes handleResize write
 * a bigger attribute — and it only bites when the container's height is not
 * already definite (a caller passing height="auto" and stretching), and only
 * at dpr > 1, so a 1x display never shows it. Taking the canvas out of flow
 * means the container is sized by its caller alone and the canvas can only
 * ever follow.
 */
function VisualizerSurface({ canvasRef, variant, onToggle }: VisualizerSurfaceProps) {
  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full block transition-opacity ${
        variant === 'inline' ? '' : 'cursor-pointer'
      }`}
      title={variant === 'inline' ? undefined : 'Click to toggle visualizer mode'}
      onClick={variant === 'inline' ? undefined : onToggle}
    />
  );
}

interface VisualizerLegendProps {
  indicatorRef: React.RefObject<HTMLSpanElement | null>;
  mode: VisualizerMode;
  variant: 'panel' | 'inline';
}

/**
 * Subtle Live Signal Indicator. An inline trace is only a few dozen pixels
 * tall and its caller already labels it, so the legend would sit on top of the
 * waveform saying nothing new.
 */
function VisualizerLegend({ indicatorRef, mode, variant }: VisualizerLegendProps) {
  return (
    <div
      className={`absolute bottom-1 left-2 items-center gap-1 pointer-events-none opacity-60 ${
        variant === 'inline' ? 'hidden' : 'flex'
      }`}
    >
      <span ref={indicatorRef} className="w-1.5 h-1.5 rounded-full bg-base-content/30" />
      <span className="text-[9px] text-base-content/60 uppercase tracking-wider">
        {VISUALIZER_MODE_LABEL[mode]}
      </span>
    </div>
  );
}

export const AudioVisualizer = React.memo(function AudioVisualizer({
  mode: initialMode = 'wave',
  className = '',
  height = 40,
  colorTheme = 'primary',
  paused = false,
  onModeChange,
  source,
  variant = 'panel',
}: AudioVisualizerProps) {
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
  const indicatorRef = useRef<HTMLSpanElement | null>(null);

  // Silence throttle state, in a ref: it is per-frame bookkeeping, so a
  // useState here would re-render the component 60 times a second — the same
  // reason indicatorRef exists.
  const throttleRef = useRef<SilenceThrottle>(initialSilenceThrottle());

  // Resolved theme colours, cached across frames — see useThemePalette.
  const paletteRef = useRef<Record<ThemeToken, Rgb> | null>(null);
  useThemePalette(paletteRef);

  // Analyser scratch buffers and the two per-frame draw accumulators, all in
  // refs so they outlive an effect re-run (see AnalyserBuffers).
  const buffersRef = useRef<AnalyserBuffers>({
    freq: new Uint8Array(0),
    time: new Uint8Array(0),
  });
  const frameStateRef = useRef<VisualizerFrameState>({ peaks: [], prevData: [] });

  useEffect(() => {
    // Controlled mode renders straight from `initialMode` already (see
    // `mode` above); re-deriving internal state here too would just be a
    // second, redundant write.
    if (isControlled) return;
    setInternalMode(initialMode);
  }, [initialMode, isControlled]);

  useVisualizerCanvas({
    canvasRef,
    containerRef,
    indicatorRef,
    paletteRef,
    throttleRef,
    buffersRef,
    frameStateRef,
    mode,
    colorTheme,
    source,
    variant,
    paused,
  });

  // Quick toggle through modes on canvas click
  const cycleMode = () => {
    const nextIndex = (VISUALIZER_MODES.indexOf(mode) + 1) % VISUALIZER_MODES.length;
    setMode(VISUALIZER_MODES[nextIndex]);
  };

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`} style={{ height }}>
      <VisualizerSurface canvasRef={canvasRef} variant={variant} onToggle={cycleMode} />
      <VisualizerLegend indicatorRef={indicatorRef} mode={mode} variant={variant} />
    </div>
  );
});
