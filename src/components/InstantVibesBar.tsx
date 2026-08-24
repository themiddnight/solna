import React, { useState } from 'react';
import { Sparkles, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { INSTANT_VIBES, InstantVibe, applyInstantVibeToStore } from '../store/instantVibes';
import { useAppStore } from '../store/store';

export function selectVibe(
  vibe: InstantVibe,
  deps: { onSelect: (id: string) => void; onToast: (text: string) => void }
): void {
  applyInstantVibeToStore(vibe);
  deps.onSelect(vibe.id);
  deps.onToast(`Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${vibe.scaleRoot} ${vibe.scaleType})`);
}

export const InstantVibesBar: React.FC = React.memo(() => {
  const projectTitle = useAppStore((s) => s.projectTitle);

  const [activeVibeId, setActiveVibeId] = useState<string | null>('synthwave-80s');
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const handleSelectVibe = (vibe: InstantVibe) => {
    selectVibe(vibe, { onSelect: setActiveVibeId, onToast: setFeedbackToast });
    setTimeout(() => {
      setFeedbackToast(null);
    }, 3000);
  };

  return (
    <div className="bg-[#0E1122] border-b border-[#252B48] px-3 py-1.5 select-none relative z-30 transition-all">
      <div className="flex items-center justify-between gap-2 max-w-full">
        {/* Left Label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-bold tracking-wide uppercase text-slate-300">
            Vibes
          </span>
        </div>

        {/* Horizontal Scrolling Vibe Buttons */}
        {!isCollapsed && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 no-scrollbar scroll-smooth flex-1 max-w-full">
            {INSTANT_VIBES.map((vibe) => {
              const isSelected = activeVibeId === vibe.id || projectTitle === vibe.projectTitle;

              return (
                <button
                  key={vibe.id}
                  id={`btn-vibe-${vibe.id}`}
                  onClick={() => handleSelectVibe(vibe)}
                  title={`${vibe.name} (${vibe.bpm} BPM · ${vibe.scaleRoot} ${vibe.scaleType})`}
                  className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer shrink-0 ${
                    isSelected
                      ? `bg-gradient-to-r ${vibe.bgGradient} ${vibe.borderColor} ${vibe.textColor} shadow-sm ring-1 ring-white/10`
                      : 'bg-[#14182E] border-[#252B48] text-slate-300 hover:text-white hover:bg-[#1C213E]'
                  }`}
                >
                  <span className="text-xs leading-none">{vibe.emoji}</span>
                  <span className="font-medium">{vibe.name}</span>
                  <span className="text-[9px] font-mono opacity-70">
                    {vibe.bpm}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Collapse toggle & Feedback banner */}
        <div className="flex items-center gap-1.5 shrink-0">
          {feedbackToast && (
            <div className="flex items-center gap-1 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[10px] px-2 py-0.5 rounded-md animate-in fade-in">
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="hidden md:inline">{feedbackToast}</span>
              <span className="md:hidden">Loaded</span>
            </div>
          )}

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-[#1C213E] transition-colors cursor-pointer"
            title={isCollapsed ? 'Show Vibes' : 'Hide Vibes'}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
});
