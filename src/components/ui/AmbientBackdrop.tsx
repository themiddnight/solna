import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/audio/engine';
import { useAppStore } from '@/store/store';
import { aggregatePlayerState } from '@/store/transportSlice';
import { attachMeter, nextMeterId } from '@/utils/meterAttach';
import { dbfsToPercent } from '@/utils/meterScale';
import {
  createThemePalette,
  rgbToCss,
  subscribeToThemeChange,
  type Rgb,
  type ThemeToken,
} from '@/utils/themeColor';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Pure decision, exported so it is testable without a DOM — the same shape
 *  `resolveInitialTheme` in Header.tsx uses for the theme preference. */
export function shouldAnimateBackdrop(isPlaying: boolean, prefersReducedMotion: boolean): boolean {
  return isPlaying && !prefersReducedMotion;
}

/**
 * Three large, slow-drifting blobs. Frequencies are in radians/ms so each
 * blob's centre traces a slow independent Lissajous path; phases keep them
 * from ever aligning. This is decoration, not a meter, so there is no
 * per-bin detail here — only the analyser's average level modulates size
 * and opacity.
 */
const BLOBS: ReadonlyArray<{
  token: ThemeToken;
  xFreq: number;
  yFreq: number;
  xPhase: number;
  yPhase: number;
}> = [
  { token: '--color-primary', xFreq: 0.00013, yFreq: 0.00009, xPhase: 0, yPhase: 1.3 },
  { token: '--color-accent', xFreq: 0.0001, yFreq: 0.00015, xPhase: 2.1, yPhase: 0.4 },
  { token: '--color-secondary', xFreq: 0.00017, yFreq: 0.00011, xPhase: 4.2, yPhase: 2.6 },
];

/**
 * Maps an RMS dBFS reading onto the 0..1 the blob geometry expects.
 *
 * RMS, not peak: the backdrop answers "how much is going on", which is an energy question, and a
 * peak reading would make the blobs flicker on every transient. Through `dbfsToPercent` rather
 * than a raw normalisation, so the backdrop and the meters agree about where a given level sits.
 * NaN reads as silence rather than propagating into a canvas gradient, which would throw.
 */
export function backdropLevel(rmsDbfs: number): number {
  if (Number.isNaN(rmsDbfs)) return 0;
  return dbfsToPercent(rmsDbfs) / 100;
}

/**
 * Full-bleed, analyser-driven ambient field mounted behind the whole
 * workspace (see src/App.tsx — first child of the root div). Gives every
 * tab continuous "audio is live" feedback without a meter's per-bin detail.
 *
 * The root's `bg-canvas` is opaque and `position: relative` with
 * `z-index: auto` creates no stacking context, so this canvas must stay a
 * `absolute inset-0 z-0` FIRST child (paints above the root background,
 * below every later sibling by DOM order) rather than `fixed` / a negative
 * z-index, which would paint behind that opaque background and never show.
 */
export function AmbientBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const leadPlayer = useAppStore((s) => s.leadPlayer);
  const isPlaying = aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer) !== 'stopped';

  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const animate = shouldAnimateBackdrop(isPlaying, reducedMotion);

  // Resolved theme colours, cached across frames — getComputedStyle is a
  // layout-flushing call and must never run inside the rAF loop. Built only
  // here: a lazy init in the render body as well would build the palette
  // twice at mount and discard the first before a frame ever drew it.
  const paletteRef = useRef<Record<ThemeToken, Rgb> | null>(null);
  useEffect(() => {
    const refresh = () => {
      paletteRef.current = createThemePalette();
    };
    refresh();
    return subscribeToThemeChange(refresh);
  }, []);

  // Written by the meter scheduler, read by the draw loop below. A ref, not state: the backdrop
  // redraws every frame for its own blob motion, so a state update per tick would re-render the
  // component and restart the draw effect. Nothing here reaches a zustand slice.
  const levelRef = useRef(0);

  // Sizing owns its own effect so that starting and stopping playback — which
  // flips `animate` below — does not tear down and rebuild the ResizeObserver
  // and re-measure the canvas (a layout flush) each time.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // `absolute inset-0` alone does not stretch a replaced element like
    // <canvas> (its intrinsic 300x150 box wins unless width/height are
    // explicitly set), so the pixel buffer is sized from the box's own
    // rendered rect on every resize.
    //
    // Deliberately NOT scaled by devicePixelRatio, unlike AudioVisualizer:
    // this is three full-viewport radial gradients at `opacity-30`, redrawn
    // every frame. A retina buffer quadruples that fill cost — ~15M pixel
    // writes per frame on a 1440x900 display — to add detail that a blurred,
    // near-transparent blob has none of. CSS stretches the 1x buffer.
    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
    };
    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!animate) {
      levelRef.current = 0;
      return;
    }
    const analyser = audioEngine.getMasterLevelAnalyser();
    if (!analyser) return;

    // `attachMeter` owns the level tracker, the tier's tick interval and the clock, so the tier
    // is stated ONCE here. Hand-rolling that body wrote it twice — as `'track'` and again as the
    // `TIER_INTERVAL_MS.track` the tracker was sized from — and a re-tier of the backdrop would
    // have left the RMS window sized for the old cadence with nothing failing.
    //
    // `visibilityElement` is omitted, not passed `null`: it is optional on this path precisely
    // because the backdrop is mounted once outside the tab views and has genuinely nothing to
    // gate on. (`attachTickMeter` makes it required, for callers that render their own element.)
    return attachMeter(analyser, {
      id: nextMeterId('backdrop'),
      tier: 'track',
      onLevel: (level) => {
        levelRef.current = backdropLevel(level.rmsDbfs);
      },
    });
  }, [animate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (!animate) {
      // Clear rather than leaving a stale frame frozen on screen.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let animationId = 0;
    const start = performance.now();

    const render = (now: number) => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Fed by the scheduler registration above at the track tier, so the backdrop reads the
      // analyser 30 times a second rather than once per drawn frame. `getAudioLevel` used to
      // live here and averaged frequency bins — that moved with a patch's brightness, not its
      // loudness.
      const level = levelRef.current;
      const palette = paletteRef.current;

      if (palette) {
        const elapsed = now - start;
        const radius = Math.max(width, height) * (0.35 + level * 0.25);
        const alpha = 0.08 + level * 0.22;

        BLOBS.forEach((blob) => {
          const cx = width * (0.5 + 0.35 * Math.sin(elapsed * blob.xFreq + blob.xPhase));
          const cy = height * (0.5 + 0.35 * Math.cos(elapsed * blob.yFreq + blob.yPhase));
          const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          gradient.addColorStop(0, rgbToCss(palette[blob.token], alpha));
          gradient.addColorStop(1, rgbToCss(palette[blob.token], 0));
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);
        });
      }

      animationId = requestAnimationFrame(render);
    };
    animationId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationId);
  }, [animate]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 z-0 pointer-events-none opacity-30 w-full h-full"
    />
  );
}
