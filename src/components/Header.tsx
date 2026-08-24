import React from "react";
import {
  Sliders,
  Grid,
  FolderOpen,
  Music,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { ViewMode } from "../types";
import { ROOTS, SCALES } from "../utils/musicTheory";
import { useAppStore } from "../store/store";

const NAV_TABS: Array<
  | {
      view: ViewMode;
      label: string;
      icon: LucideIcon;
      playingKey?: "sequencer" | "chords";
    }
  | "divider"
> = [
  { view: "synth", label: "Synth", icon: Sliders },
  {
    view: "sequencer",
    label: "Step Matrix",
    icon: Grid,
    playingKey: "sequencer",
  },
  { view: "chords", label: "Chords", icon: Music, playingKey: "chords" },
];

const MASTER_TABS: Array<{
  view: ViewMode;
  label: string;
  icon: LucideIcon;
}> = [{ view: "effects", label: "Master FX", icon: Sliders }];

export const Header: React.FC = React.memo(() => {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const isSequencerPlaying = useAppStore((s) => s.isSequencerPlaying);
  const isChordsPlaying = useAppStore((s) => s.isChordsPlaying);
  const openProjectsModal = useAppStore((s) => s.openProjectsModal);
  const projectTitle = useAppStore((s) => s.projectTitle);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const setScaleRoot = useAppStore((s) => s.setScaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);

  return (
    <header className="bg-[#12152A] border-b border-[#252B48] px-3 py-2 flex items-center justify-between gap-2 text-sm select-none sticky top-0 z-40">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
          <Radio className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-sm tracking-tight text-white">
            murva
          </span>
          <span className="hidden sm:inline-block text-[11px] text-slate-400 font-medium truncate max-w-[120px] md:max-w-[160px]">
            · {projectTitle}
          </span>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="flex items-center gap-2">
        <div className="flex items-center p-0.5 rounded-lg bg-[#0B0D19] border border-[#252B48] overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
          {NAV_TABS.map((tab, index) => {
            if (tab === "divider") {
              return (
                <div
                  key={`divider-${index}`}
                  className="w-px h-4 bg-[#252B48] mx-0.5 shrink-0 hidden sm:block"
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
                onClick={() => setActiveTab(tab.view)}
                className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap relative ${
                  activeTab === tab.view
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#1C213E]/60"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">{tab.label}</span>
                {isTabPlaying && (
                  <span
                    className="flex h-1.5 w-1.5 relative ml-0.5"
                    title="Playing"
                  >
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center p-0.5 rounded-lg bg-[#0B0D19] border border-[#252B48] overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
          {MASTER_TABS.map((tab) => {
            return (
              <button
                key={tab.view}
                id={`tab-${tab.view}`}
                onClick={() => setActiveTab(tab.view)}
                className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap relative ${
                  activeTab === tab.view
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#1C213E]/60"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Key, Scale & Global Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Scale Picker Compact */}
        <div className="hidden sm:flex items-center gap-1 bg-[#0B0D19] border border-[#252B48] px-2 py-1 rounded-lg">
          <select
            id="select-master-scale-root"
            value={scaleRoot}
            onChange={(e) => setScaleRoot(e.target.value)}
            className="bg-transparent text-xs font-bold text-indigo-300 focus:outline-none cursor-pointer"
            title="Root Note"
          >
            {ROOTS.map((r) => (
              <option key={r} value={r} className="bg-[#12152A]">
                {r}
              </option>
            ))}
          </select>
          <select
            id="select-master-scale-type"
            value={scaleType}
            onChange={(e) => setScaleType(e.target.value)}
            className="bg-transparent text-xs font-bold text-slate-300 focus:outline-none cursor-pointer max-w-[90px] truncate"
            title="Scale Type"
          >
            {Object.keys(SCALES).map((s) => (
              <option key={s} value={s} className="bg-[#12152A]">
                {SCALES[s].name}
              </option>
            ))}
          </select>
        </div>

        {/* Projects Action */}
        <button
          id="btn-open-projects"
          onClick={openProjectsModal}
          className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer text-xs font-medium"
          title="Projects (Save / Export)"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Projects</span>
        </button>
      </div>
    </header>
  );
});
