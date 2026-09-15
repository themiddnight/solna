import { AudioVisualizer } from '../AudioVisualizer';

/**
 * The oscilloscope well that rides a Sound section's band, the way a hardware
 * synth puts a scope beside the section you are editing.
 *
 * It taps the named layer's own PRE-FADER tap — after the VCA, before that
 * layer's bus gain and the sends — so it shows the instrument being edited
 * rather than the finished mix the transport bar's master meter reads, and a
 * fader move does not resize a wave that has not changed. The trace is raw
 * -1..+1 mapped straight onto the box height: no normalisation, no AGC, no dB
 * curve, which is only legible because the tap is ahead of the bus default.
 *
 * ONE component for both editors, not one per section. Synth and Beat draw the
 * identical well and differ only in which bus they name, what they label it and
 * which hue they trace it in — and the well's class string encodes a decision
 * (`h-8`, to square with `ACTION_CLUSTER`'s `min-h-8` across the band) that a
 * second copy would drift away from with nothing failing.
 *
 * `paused` is not optional. App keeps every view mounted (block/hidden) so
 * audio survives a tab switch, which means this rAF loop would otherwise run
 * forever behind a hidden tab.
 */
export function SoundScope({
  source,
  label,
  colorTheme,
  paused,
}: {
  /**
   * The engine's name for the bus to tap — a `SourceBusId`, spelled as a
   * string because `src/components/` may not import `audio/engine` and the
   * visualizer takes it as one. Beat's is `'sequencer'`, which is the drum
   * bus under the name the engine has always called it.
   */
  source: string;
  /** What the well says it is showing — a layer name, not a mode name. */
  label: string;
  /** The trace hue. Follows whatever the section is already tinted with. */
  colorTheme: 'primary' | 'secondary' | 'accent';
  paused: boolean;
}) {
  return (
    <div
      /* `h-8`, not whatever height the label happens to produce: this rides
         the section band opposite the action cluster, whose `ACTION_CLUSTER`
         token sets `min-h-8`, and a well several pixels shorter than the
         buttons across from it reads as a misalignment rather than as a
         quieter element. The visualizer inside keeps `self-stretch`, so the
         height it gains goes to the waveform. */
      className="hidden sm:flex items-center gap-2 h-8 bg-base-200 border border-base-300 rounded px-2 py-1"
      title={`Oscilloscope — ${label} layer`}
    >
      <span className="text-[10px] uppercase tracking-wider font-semibold text-base-content/50">
        {label}
      </span>
      <AudioVisualizer
        mode="oscilloscope"
        variant="inline"
        source={source}
        paused={paused}
        height="auto"
        className="w-28 lg:w-40 rounded self-stretch"
        colorTheme={colorTheme}
      />
    </div>
  );
}
