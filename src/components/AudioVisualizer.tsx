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

      // Check if there is actual audio activity
      let energy = 0;
      for (let i = 0; i < bufferLength; i++) {
        energy += freqData[i];
      }
      const avgEnergy = energy / bufferLength;
      const isSounding = avgEnergy > 1.5;
      setIsActive(isSounding);

      if (mode === 'bars') {
        renderBars(ctx, width, height, freqData, bufferLength, colorTheme);
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

    // Helper: Spectrum Bars
    const renderBars = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      theme: string
    ) => {
      const barCount = Math.min(32, Math.floor(w / 4));
      const barWidth = Math.max(2, (w / barCount) - 1.5);
      const step = Math.floor(len / barCount);

      if (peaksRef.current.length !== barCount) {
        peaksRef.current = new Array(barCount).fill(0);
      }

      for (let i = 0; i < barCount; i++) {
        let val = 0;
        for (let j = 0; j < step; j++) {
          val += data[i * step + j] || 0;
        }
        val = val / step;

        const percent = val / 255;
        const barHeight = Math.max(2, percent * (h - 4));
        const x = i * (barWidth + 1.5);
        const y = h - barHeight;

        // Peak drop falloff
        if (barHeight > peaksRef.current[i]) {
          peaksRef.current[i] = barHeight;
        } else {
          peaksRef.current[i] = Math.max(0, peaksRef.current[i] - 0.5);
        }

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

        // Peak line
        const peakY = h - peaksRef.current[i] - 1;
        c.fillStyle = theme === 'cyberpunk' ? '#f43f5e' : '#e0e7ff';
        c.fillRect(x, Math.max(0, peakY), barWidth, 1.5);
      }
    };

    // Helper: Spectrum Wave (smooth curve with area gradient fill)
    const renderSpectrumWave = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      theme: string,
      isSounding: boolean
    ) => {
      const samplePoints = 48;
      const step = Math.floor(len / samplePoints);
      const points: { x: number; y: number }[] = [];

      // Smooth with previous frame for fluid animation
      if (prevDataRef.current.length !== samplePoints) {
        prevDataRef.current = new Array(samplePoints).fill(0);
      }

      for (let i = 0; i < samplePoints; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += data[i * step + j] || 0;
        }
        const raw = sum / step;
        // Interpolate for buttery smoothness
        const smoothed = prevDataRef.current[i] * 0.4 + (raw / 255) * 0.6;
        prevDataRef.current[i] = smoothed;

        const x = (i / (samplePoints - 1)) * w;
        // If sound is playing, use magnitude, otherwise slight resting ripple
        const idleWave = Math.sin(Date.now() * 0.003 + i * 0.2) * 2;
        const y = isSounding
          ? h - Math.max(3, smoothed * (h - 6)) - 3
          : h / 2 + idleWave;

        points.push({ x, y });
      }

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

      // Top glowing stroke line
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

      c.shadowBlur = isSounding ? 10 : 2;
      c.shadowColor =
        theme === 'emerald'
          ? '#34d399'
          : theme === 'amber'
          ? '#fbbf24'
          : theme === 'cyberpunk'
          ? '#f472b6'
          : '#818cf8';
      c.strokeStyle =
        theme === 'emerald'
          ? '#6ee7b7'
          : theme === 'amber'
          ? '#fde68a'
          : theme === 'cyberpunk'
          ? '#f9a8d4'
          : '#c7d2fe';
      c.lineWidth = isSounding ? 2 : 1.2;
      c.stroke();
      c.shadowBlur = 0; // reset
    };

    // Helper: Oscilloscope (Time-Domain Wave)
    const renderOscilloscope = (
      c: CanvasRenderingContext2D,
      w: number,
      h: number,
      data: Uint8Array,
      len: number,
      theme: string,
      isSounding: boolean
    ) => {
      c.lineWidth = isSounding ? 2 : 1.2;
      c.strokeStyle =
        theme === 'emerald'
          ? '#34d399'
          : theme === 'amber'
          ? '#fbbf24'
          : theme === 'cyberpunk'
          ? '#38bdf8'
          : '#818cf8';

      c.shadowBlur = isSounding ? 8 : 1;
      c.shadowColor = c.strokeStyle;

      c.beginPath();
      const sliceWidth = w / len;
      let x = 0;

      for (let i = 0; i < len; i++) {
        const v = data[i] / 128.0; // 0..2 centered at 1
        const y = (v * h) / 2;

        if (i === 0) {
          c.moveTo(x, y);
        } else {
          c.lineTo(x, y);
        }

        x += sliceWidth;
      }

      c.lineTo(w, h / 2);
      c.stroke();
      c.shadowBlur = 0;
    };

    // Helper: Ambient Background Visualizer
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

      for (let waveIdx = 0; waveIdx < numWaves; waveIdx++) {
        c.beginPath();
        const baseOffset = (waveIdx / numWaves) * Math.PI;
        c.moveTo(0, h);

        for (let x = 0; x <= w; x += 15) {
          const binIdx = Math.floor((x / w) * (len / 4));
          const freqMag = isSounding ? (data[binIdx] || 0) / 255 : 0.05;
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
