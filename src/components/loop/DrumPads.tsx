import React, { useState, useCallback, useEffect } from 'react';
import { ensureDrumEngine, triggerPad as triggerDrumPad } from '../../audio/playback/drumPlayback';
import { isTypingTarget } from '../../utils/keyboard';
import type { DrumPad } from '../../types';
import { DrumPadGrid, DEFAULT_PADS } from '../ui/DrumPadGrid';

export const DrumPads: React.FC = React.memo(() => {
  const [pads, setPads] = useState<DrumPad[]>(DEFAULT_PADS);
  const [activePadId, setActivePadId] = useState<string | null>(null);

  const triggerPad = useCallback((pad: DrumPad) => {
    ensureDrumEngine();
    triggerDrumPad(pad.note, pad.volume);
    setActivePadId(pad.id);
    setTimeout(() => setActivePadId(null), 150);
  }, []);

  const handlePadVolumeChange = useCallback((padId: string, volume: number) => {
    setPads((prev) => prev.map((p) => (p.id === padId ? { ...p, volume } : p)));
  }, []);

  // QWERTY drum shortcuts — kept in-page until Task 5 moves this listener
  // into useInputDeck (listener body verbatim from the pre-extraction DrumPads).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.repeat) return;
      const pad = pads.find((p) => p.shortcut === e.code);
      if (pad) {
        triggerPad(pad);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pads, triggerPad]);

  return (
    <div className="card bg-panel border border-base-300 shadow-md">
      <div className="card-body p-3 sm:p-4">
        <DrumPadGrid
          pads={pads}
          activePadId={activePadId}
          onTriggerPad={triggerPad}
          onPadVolumeChange={handlePadVolumeChange}
        />
      </div>
    </div>
  );
});
