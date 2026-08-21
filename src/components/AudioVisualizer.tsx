import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../audio/engine';
import { Activity, BarChart2, Waves, Sparkles } from 'lucide-react';

export type VisualizerMode = 'wave' | 'bars' | 'oscilloscope' | 'ambient-bg';

interface AudioVisualizerProps {
  mode?: VisualizerMode;
  className?: string;
  height?: number | string;
  showControls?: boolean;
  colorTheme?: 'indigo' | 'emerald' | 'amber' | 'cyberpunk';
  ambientOpacity?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  mode: initialMode = 'wave',
  className = '',
  height = 40,
  showControls = false,
  colorTheme = 'indigo',
  ambientOpacity = 0.15,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<VisualizerMode>(initialMode);
  const [isActive, setIsActive] = useState<boolean>(false);

  // Peak hold data for spectrum bars
  const peaksRef = useRef<number[]>([]);
  const prevDataRef = useRef<number[]>([]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const analyser = audioEngine.getAnalyser();
      const width = canvas.width;
      const height = canvas.height;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      if (!analyser) {
        // Idle placeholder line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        animationId = requestAnimationFrame(render);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const freqData = new Uint8Array(bufferLength);
      const timeData = new Uint8Array(bufferLength);

      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      // Check if there is actual audio activity (filter out digital silence & DC bias)
      let energy = 0;
      for (let i = 0; i < bufferLength; i++) {
        energy += freqData[i];
      }
      const avgEnergy = energy / bufferLength;

      let maxDeviation = 0;
      for (let i = 0; i < bufferLength; i++) {
        const dev = Math.abs(timeData[i] - 128);
        if (dev > maxDeviation) maxDeviation = dev;
      }

      // Strictly consider sounding only if audio is genuinely active
      const isSounding = avgEnergy > 2.5 && maxDeviation > 3;
      setIsActive(isSounding);

      if (mode === 'bars') {
        renderBars(ctx, width, height, freqData, bufferLength, colorTheme, isSounding);
      } else if (mode === 'oscilloscope') {
        renderOscilloscope(ctx, width, height, timeData, bufferLength, colorTheme, isSounding);
      } else if (mode === 'ambient-bg') {
        renderAmbientBg(ctx, width, height, freqData, bufferLength, colorTheme, ambientOpacity, isSounding);
      } else {
        // 'wave' spectrum wave
        renderSpectrumWave(ctx, width, height, freqData, bufferLength, colorTheme, isSounding);
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
      theme: string,
      isSounding: boolean
    ) => {
      const barCount = Math.min(36, Math.max(12, Math.floor(w / 5)));
      const gap = 1.5;
      const barWidth = Math.max(2, (w - (barCount - 1) * gap) / barCount);
      const logData = isSounding ? getLogFrequencyData(data, barCount, len) : new Array(barCount).fill(0);

      if (peaksRef.current.length !== barCount) {
        peaksRef.current = new Array(barCount).fill(0);
      }

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
          // Gradient for bars
          const grad = c.createLinearGradient(0, h, 0, 0);
          if (theme === 'emerald') {
            grad.addColorStop(0, '#059669');
            grad.addColorStop(0.7, '#10b981');
            grad.addColorStop(1, '#6ee7b7');
          } else if (theme === 'amber') {
            grad.addColorStop(0, '#d97706');
            grad.addColorStop(0.7, '#f59e0b');
            grad.addColorStop(1, '#fde68a');
          } else if (theme === 'cyberpunk') {
            grad.addColorStop(0, '#ec4899');
            grad.addColorStop(0.5, '#a855f7');
            grad.addColorStop(1, '#38bdf8');
          } else {
            // Default Indigo
            grad.addColorStop(0, '#4338ca');
            grad.addColorStop(0.6, '#6366f1');
            grad.addColorStop(1, '#a5b4fc');
          }

          c.fillStyle = grad;
          c.beginPath();
          c.roundRect ? c.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]) : c.rect(x, y, barWidth, barHeight);
          c.fill();
        }

        // Peak line
        if (peaksRef.current[i] > 1) {
          const peakY = h - peaksRef.current[i] - 1;
          c.fillStyle = theme === 'cyberpunk' ? '#f43f5e' : '#e0e7ff';
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
      theme: string,
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
        if (theme === 'emerald') {
          grad.addColorStop(0, 'rgba(16, 185, 129, 0.45)');
          grad.addColorStop(0.5, 'rgba(5, 150, 105, 0.2)');
          grad.addColorStop(1, 'rgba(4, 120, 87, 0.0)');
        } else if (theme === 'amber') {
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.45)');
          grad.addColorStop(0.5, 'rgba(217, 119, 6, 0.2)');
          grad.addColorStop(1, 'rgba(180, 83, 9, 0.0)');
        } else if (theme === 'cyberpunk') {
          grad.addColorStop(0, 'rgba(236, 72, 153, 0.5)');
          grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.25)');
          grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
        } else {
          // Indigo
          grad.addColorStop(0, 'rgba(99, 102, 241, 0.45)');
          grad.addColorStop(0.5, 'rgba(79, 70, 229, 0.2)');
          grad.addColorStop(1, 'rgba(49, 46, 129, 0.0)');
        }

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
      c.shadowColor =
        theme === 'emerald'
          ? '#34d399'
          : theme === 'amber'
          ? '#fbbf24'
          : theme === 'cyberpunk'
          ? '#f472b6'
          : '#818cf8';
      c.strokeStyle = isSounding
        ? (theme === 'emerald'
          ? '#6ee7b7'
          : theme === 'amber'
          ? '#fde68a'
          : theme === 'cyberpunk'
          ? '#f9a8d4'
          : '#c7d2fe')
        : 'rgba(99, 102, 241, 0.25)';
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
      theme: string,
      isSounding: boolean
    ) => {
      const centerY = h / 2;
      const amplitudeLimit = Math.max(4, (h / 2) - 4); // Max distance from center to top (+1) or bottom (-1)

      // 1. Draw Axis Reference Grid Lines (+1 Top, 0 Center, -1 Bottom)
      c.beginPath();
      c.strokeStyle = 'rgba(99, 102, 241, 0.2)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      
      // Top +1 boundary reference
      c.moveTo(0, 3);
      c.lineTo(w, 3);

      // Center 0V zero-crossing line
      c.moveTo(0, centerY);
      c.lineTo(w, centerY);

      // Bottom -1 boundary reference
      c.moveTo(0, h - 3);
      c.lineTo(w, h - 3);
      c.stroke();
      c.setLineDash([]); // Reset dash

      // 2. Axis Scale Labels (+1 at Top, 0 at Center, -1 at Bottom)
      c.fillStyle = 'rgba(148, 163, 184, 0.45)';
      c.font = '8px monospace';
      c.fillText('+1', 3, 9);
      c.fillText(' 0', 3, centerY + 3);
      c.fillText('-1', 3, h - 5);

      const points: { x: number; y: number }[] = [];

      if (!isSounding) {
        // When completely idle / silent, render a clean resting flat line at centerY
        points.push({ x: 0, y: centerY });
        points.push({ x: w, y: centerY });
      } else {
        // Trigger detection to stabilize waveform display
        let triggerOffset = 0;
        for (let i = 0; i < Math.min(len / 2, 256); i++) {
          if (data[i] < 128 && data[i + 1] >= 128) {
            triggerOffset = i;
            break;
          }
        }

        const activeSamples = Math.min(len - triggerOffset, 512);
        const sliceWidth = w / (activeSamples - 1);

        for (let i = 0; i < activeSamples; i++) {
          const rawByte = data[triggerOffset + i] !== undefined ? data[triggerOffset + i] : 128;
          // Normalized from -1.0 (negative trough) to +1.0 (positive crest), centered at 0
          const normalized = (rawByte - 128) / 128.0;
          const x = i * sliceWidth;
          // Positive goes UP (y decreases), Negative goes DOWN (y increases), Zero stays at centerY
          const y = centerY - (normalized * amplitudeLimit);
          points.push({ x, y });
        }
      }

      if (points.length === 0) return;

      const themeColor =
        theme === 'emerald'
          ? '#10b981'
          : theme === 'amber'
          ? '#f59e0b'
          : theme === 'cyberpunk'
          ? '#38bdf8'
          : '#6366f1';

      // 3. Draw subtle dual-sided center glow fill when sounding
      if (isSounding) {
        c.beginPath();
        c.moveTo(points[0].x, centerY);
        for (let i = 0; i < points.length; i++) {
          c.lineTo(points[i].x, points[i].y);
        }
        c.lineTo(points[points.length - 1].x, centerY);
        c.closePath();
        c.fillStyle =
          theme === 'cyberpunk'
            ? 'rgba(56, 189, 248, 0.14)'
            : theme === 'emerald'
            ? 'rgba(16, 185, 129, 0.14)'
            : 'rgba(99, 102, 241, 0.14)';
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
      c.shadowColor = themeColor;
      c.strokeStyle = isSounding
        ? (theme === 'emerald'
          ? '#6ee7b7'
          : theme === 'amber'
          ? '#fde68a'
          : theme === 'cyberpunk'
          ? '#7dd3fc'
          : '#c7d2fe')
        : 'rgba(99, 102, 241, 0.35)';
      c.lineWidth = isSounding ? 2.2 : 1.2;
      c.stroke();
      c.shadowBlur = 0;
    };

    // Helper: Ambient Background Visualizer (Logarithmic frequency response)
    const renderAmbientBg = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      theme: string,
      alpha: number,
      isSounding: boolean
    ) => {
      const time = Date.now() * 0.0015;
      const numWaves = 3;
      const logData = getLogFrequencyData(data, 32, len);

      for (let waveIdx = 0; waveIdx < numWaves; waveIdx++) {
        c.beginPath();
        const baseOffset = (waveIdx / numWaves) * Math.PI;
        c.moveTo(0, h);

        for (let x = 0; x <= w; x += 15) {
          const binIdx = Math.min(31, Math.floor((x / w) * 32));
          const freqMag = isSounding ? (logData[binIdx] || 0) / 255 : 0.05;
          const sine1 = Math.sin(time + x * 0.005 + baseOffset) * 20;
          const sine2 = Math.cos(time * 0.8 + x * 0.008) * 15;
          const y = h * 0.65 - (freqMag * h * 0.45 + sine1 + sine2) * (1 - waveIdx * 0.2);

          c.lineTo(x, y);
        }

        c.lineTo(w, h);
        c.closePath();

        const grad = c.createLinearGradient(0, 0, 0, h);
        const waveAlpha = alpha * (1 - waveIdx * 0.25);

        if (theme === 'cyberpunk') {
          grad.addColorStop(0, `rgba(236, 72, 153, ${waveAlpha})`);
          grad.addColorStop(1, `rgba(56, 189, 248, 0.01)`);
        } else if (theme === 'emerald') {
          grad.addColorStop(0, `rgba(16, 185, 129, ${waveAlpha})`);
          grad.addColorStop(1, `rgba(6, 78, 59, 0.01)`);
        } else {
          grad.addColorStop(0, `rgba(99, 102, 241, ${waveAlpha})`);
          grad.addColorStop(1, `rgba(30, 27, 75, 0.01)`);
        }

        c.fillStyle = grad;
        c.fill();
      }
    };

    // Resize handling with devicePixelRatio for sharp rendering
    const handleResize = () => {
      if (!containerRef.current || !canvas) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
    };
  }, [mode, colorTheme, ambientOpacity]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-pointer transition-opacity"
        title="Click to toggle visualizer mode"
        onClick={() => {
          if (showControls) return;
          // Quick toggle through modes on canvas click
          const modes: VisualizerMode[] = ['wave', 'bars', 'oscilloscope'];
          const nextIndex = (modes.indexOf(mode) + 1) % modes.length;
          setMode(modes[nextIndex]);
        }}
      />

      {/* Optional Mode Switch Buttons */}
      {showControls && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-[#0B0D19]/80 backdrop-blur-xs p-1 rounded-md border border-[#252B48] z-10">
          <button
            onClick={() => setMode('wave')}
            className={`p-1 rounded text-xs transition-colors ${
              mode === 'wave'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Frequency Spectrum Wave"
          >
            <Waves className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMode('bars')}
            className={`p-1 rounded text-xs transition-colors ${
              mode === 'bars'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Spectrum Bars"
          >
            <BarChart2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMode('oscilloscope')}
            className={`p-1 rounded text-xs transition-colors ${
              mode === 'oscilloscope'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Oscilloscope Waveform"
          >
            <Activity className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Subtle Live Signal Indicator */}
      <div className="absolute bottom-1 left-2 flex items-center gap-1 pointer-events-none opacity-60">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
          }`}
        />
        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
          {mode === 'wave' ? 'Spectrum Wave' : mode === 'bars' ? 'Spectrum Bars' : 'Waveform'}
        </span>
      </div>
    </div>
  );
};
