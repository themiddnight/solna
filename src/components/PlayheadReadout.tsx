import { useAppStore } from '../store/store';
import { formatChordLabel } from '../utils/musicTheory';
import { beatsPerBarFor, resolveBeatCounter, resolveNowNext } from '../utils/playhead';
import { BeatDots } from './ui/BeatDots';
import { NowNextChord } from './ui/NowNextChord';

/**
 * Header readout: which chord is sounding, which one is queued, and where the
 * transport sits inside the current chord.
 */
export function PlayheadReadout({ className = '' }: { className?: string }) {
  const chords = useAppStore((s) => s.chords);
  const playheadBeat = useAppStore((s) => s.playheadBeat);
  const playheadChordIndex = useAppStore((s) => s.playheadChordIndex);
  const playheadChordStartBeat = useAppStore((s) => s.playheadChordStartBeat);
  const meterId = useAppStore((s) => s.meterId);

  const { now, next } = resolveNowNext(chords, playheadChordIndex);
  if (!now) return null;

  const beatsPerBar = beatsPerBarFor(meterId);

  // The counter always spans the shown chord's full length. With the Chords
  // player stopped there is no trigger beat to measure from, so the global beat
  // stands in and the row still reads while only the Beat player runs.
  const counter = resolveBeatCounter({
    playheadBeat,
    chordStartBeat: playheadChordIndex === null ? 0 : playheadChordStartBeat,
    bars: now.bars,
    beatsPerBar,
  });

  return (
    <div className={`flex items-center justify-center gap-2 sm:gap-3 ${className}`}>
      <NowNextChord
        now={formatChordLabel(now.root, now.quality)}
        next={next ? formatChordLabel(next.root, next.quality) : null}
      />
      <BeatDots totalBeats={counter.totalBeats} activeBeat={counter.activeBeat} beatsPerBar={beatsPerBar} />
    </div>
  );
}
