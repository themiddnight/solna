import React, { useState, useEffect } from "react";
import { Radio } from "lucide-react";
import { useAppStore } from "../../store/store";

export const MidiIndicator: React.FC = React.memo(() => {
  const midiActivityTimestamp = useAppStore((s) => s.midiActivityTimestamp);
  const setIsMidiSettingsOpen = useAppStore((s) => s.setIsMidiSettingsOpen);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!midiActivityTimestamp) return;
    setActive(true);
    const timer = setTimeout(() => {
      setActive(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [midiActivityTimestamp]);

  return (
    <button
      type="button"
      onClick={() => setIsMidiSettingsOpen(true)}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-box border text-[11px] transition-all duration-150 cursor-pointer hover:border-primary/60 hover:bg-base-300 ${
        active
          ? "bg-primary/20 border-primary text-primary font-bold shadow-[0_0_12px_rgba(255,179,71,0.4)]"
          : "bg-base-200 border-base-300 text-base-content/60"
      }`}
      title={active ? "MIDI Event Received! Click to configure mappings" : "MIDI Connected. Click to open MIDI settings & mappings"}
    >
      <Radio className={`w-3.5 h-3.5 ${active ? "animate-pulse text-primary" : "opacity-70"}`} />
      <span className="hidden sm:inline font-mono text-[10px]">MIDI</span>
      <span
        className={`w-2 h-2 rounded-full transition-all ${
          active ? "bg-primary scale-125" : "bg-base-content/30"
        }`}
      />
    </button>
  );
});
