import React from "react";
import {
  Sliders,
  Grid,
  Sparkles,
  FolderOpen,
  Music,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { ViewMode } from "../types";
import { ROOTS, SCALES } from "../utils/musicTheory";

interface HeaderProps {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  isSequencerPlaying?: boolean;
  isChordsPlaying?: boolean;
  onOpenAi: () => void;
  onOpenProjects: () => void;
  projectTitle: string;
  scaleRoot: string;
  onChangeScaleRoot: (root: string) => void;
  scaleType: string;
  onChangeScaleType: (type: string) => void;
}

const NAV_TABS: Array<
  | { view: ViewMode; label: string; icon: LucideIcon; playingKey?: "sequencer" | "chords" }
  | "divider"
> = [
  { view: "synth", label: "Synth", icon: Sliders },
  "divider",
  { view: "sequencer", label: "Step Matrix", icon: Grid, playingKey: "sequencer" },
  { view: "chords", label: "Chords", icon: Music, playingKey: "chords" },
  "divider",
  { view: "effects", label: "Master FX", icon: Sliders },
];

export const Header: React.FC<HeaderProps> = React.memo(({
  currentView,
  onSelectView,
  isSequencerPlaying = false,
  isChordsPlaying = false,
  onOpenAi,
  onOpenProjects,
  projectTitle,
  scaleRoot,
  onChangeScaleRoot,
  scaleType,
  onChangeScaleType,
}) => {
  return (
    <header className="bg-[#12152A] border-b border-[#252B48] px-4 py-2.5 flex flex-col gap-2.5 text-sm select-none sticky top-0 z-40">
      {/* Row 1: Brand & Room Info + Primary Navigation Tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Radio className="w-4 h-4 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                  murva
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                  Studio
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="truncate max-w-[140px] font-medium text-slate-300">
                  {projectTitle}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Primary Navigation Tabs with Playing Status Indicators */}
        <nav className="flex items-center p-1 rounded-lg bg-[#0B0D19] border border-[#252B48] overflow-x-auto max-w-full gap-1">
          {NAV_TABS.map((tab, index) => {
            if (tab === "divider") {
              return (
                <div
                  key={`divider-${index}`}
                  className="w-px h-5 bg-[#252B48] mx-1 shrink-0"
                />
              );
            }

            const isTabPlaying =
              tab.playingKey === "sequencer"
                ? isSequencerPlaying
                : tab.playingKey === "chords"
                  ? isChordsPlaying
                  : false;

            return (
              <button
                key={tab.view}
                id={`tab-${tab.view}`}
                onClick={() => onSelectView(tab.view)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap relative ${
                  currentView === tab.view
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#1C213E]/60"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {isTabPlaying && (
                  <span className="flex h-2 w-2 relative ml-0.5" title="Playing">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Row 2: Master Key, Scale Selector & Global Actions */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-[#0B0D19] border border-[#252B48] rounded-xl flex-wrap">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Studio Key:
          </span>
          {/* Key & Scale Pickers */}
          <div className="flex items-center gap-1.5 bg-[#12152A] border border-[#2D355A] px-2.5 py-1 rounded-lg">
            <span className="text-xs text-slate-400 font-mono">Root:</span>
            <select
              id="select-master-scale-root"
              value={scaleRoot}
              onChange={(e) => onChangeScaleRoot(e.target.value)}
              className="bg-transparent text-xs font-bold text-indigo-300 focus:outline-none cursor-pointer"
            >
              {ROOTS.map((r) => (
                <option key={r} value={r} className="bg-[#12152A]">
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5 bg-[#12152A] border border-[#2D355A] px-2.5 py-1 rounded-lg">
            <span className="text-xs text-slate-400 font-mono">Scale:</span>
            <select
              id="select-master-scale-type"
              value={scaleType}
              onChange={(e) => onChangeScaleType(e.target.value)}
              className="bg-transparent text-xs font-bold text-indigo-300 focus:outline-none cursor-pointer"
            >
              {Object.keys(SCALES).map((s) => (
                <option key={s} value={s} className="bg-[#12152A]">
                  {SCALES[s].name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Global Action Modals */}
        <div className="flex items-center gap-2">
          <button
            id="btn-open-ai"
            onClick={onOpenAi}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 text-white font-medium text-xs shadow-md shadow-purple-600/20 hover:brightness-110 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Companion</span>
          </button>
          <button
            id="btn-open-projects"
            onClick={onOpenProjects}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer text-xs font-medium"
            title="Save / Load / Export Track"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Projects</span>
          </button>
        </div>
      </div>
    </header>
  );
});
