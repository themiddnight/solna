import type { MeterId } from '@/utils/timeSignature';
import { BottomSheet } from './ui/BottomSheet';
import { MidiIndicator } from './ui/MidiIndicator';
import { VuMeter } from './ui/VuMeter';
import { MasterFader, MeterField, MetronomeToggle, TempoField } from './TransportFields';

/** The sheet's dialog id: the bar's toggles point `aria-controls` at it. */
export const TRANSPORT_SHEET_ID = 'sheet-transport';

export interface TransportSheetProps {
  open: boolean;
  onClose: () => void;
  bpm: number;
  setBpm: (bpm: number) => void;
  meterId: MeterId;
  setMeter: (id: MeterId) => void;
  metronomeActive: boolean;
  onToggleMetronome: () => void;
  masterVolume: number;
  setMasterVolume: (db: number) => void;
  isPlaying: boolean;
}

/**
 * The mobile transport sheet (R332): everything the one-row bar gives up —
 * tempo, meter, metronome, MIDI, the level meter and the master fader with its
 * dB readout. A NON-modal `BottomSheet` (R326), rendered inside the bar so it
 * anchors to the bar's top edge, and so Play/Stop on the bar stay tappable
 * while it is open. The level meter runs only while the sheet is open: closed,
 * it is display:none and its analyser reads would be for nobody.
 */
export function TransportSheet({
  open,
  onClose,
  bpm,
  setBpm,
  meterId,
  setMeter,
  metronomeActive,
  onToggleMetronome,
  masterVolume,
  setMasterVolume,
  isPlaying,
}: TransportSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Transport"
      modal={false}
      id={TRANSPORT_SHEET_ID}
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <TempoField bpm={bpm} setBpm={setBpm} place="sheet" />
        <MeterField meterId={meterId} setMeter={setMeter} place="sheet" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MetronomeToggle active={metronomeActive} onToggle={onToggleMetronome} place="sheet" />
        <MidiIndicator showLabel />
      </div>
      <div className="flex items-center gap-2">
        <VuMeter isPlaying={isPlaying && open} alwaysShown />
        <MasterFader valueDb={masterVolume} onChangeDb={setMasterVolume} place="sheet" />
      </div>
    </BottomSheet>
  );
}
