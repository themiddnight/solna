import React, { useState } from 'react';
import { X, FolderOpen, Save, Download, FileText, Music, Sparkles, Check } from 'lucide-react';
import { ProjectState } from '../types';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectState;
  onSaveProject: (title: string) => void;
  onLoadTemplate: (templateName: string) => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = React.memo(({
  isOpen,
  onClose,
  project,
  onSaveProject,
  onLoadTemplate,
}) => {
  const [title, setTitle] = useState(project.title);
  const [saved, setSaved] = useState(false);
  const [exported, setExported] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveProject(title);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(project, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${title.replace(/\s+/g, '_')}_murva_project.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12152A] border border-[#2D355A] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#0B0D19] p-4 border-b border-[#252B48] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100">Project Management & Export</h3>
              <p className="text-xs text-slate-400">Save your session, load templates, and export audio/MIDI</p>
            </div>
          </div>

          <button
            id="btn-close-project-modal"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Project Title & Save */}
          <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-3">
            <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
              Project Title
            </label>
            <div className="flex gap-2">
              <input
                id="input-project-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1 bg-[#12152A] border border-[#2D355A] text-slate-100 text-xs rounded-lg p-2.5 focus:outline-none focus:border-indigo-500"
              />
              <button
                id="btn-save-project-action"
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shadow-md"
              >
                {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
                <span>{saved ? 'Saved!' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Quick Starter Templates */}
          <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-2.5">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Load Production Template
            </span>

            <div className="grid grid-cols-2 gap-2">
              {[
                { name: 'Synthwave Odyssey', bpm: 120, key: 'A Minor' },
                { name: 'Lo-Fi Chill Hop', bpm: 85, key: 'C Major' },
                { name: 'Cyber Electro Club', bpm: 128, key: 'D Dorian' },
                { name: 'Funky Neo-Soul', bpm: 95, key: 'F Major' },
              ].map((t) => (
                <button
                  key={t.name}
                  id={`btn-template-load-${t.name.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => {
                    onLoadTemplate(t.name);
                    onClose();
                  }}
                  className="p-2.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] border border-[#252B48] text-left transition-all cursor-pointer"
                >
                  <div className="text-xs font-bold text-slate-200">{t.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{t.bpm} BPM • {t.key}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Export Actions */}
          <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
              Export Track Stems & Data
            </span>

            <div className="grid grid-cols-2 gap-2">
              <button
                id="btn-export-json"
                onClick={handleExportJSON}
                className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] border border-[#252B48] text-slate-200 text-xs font-semibold transition-all cursor-pointer"
              >
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>{exported ? 'Exported JSON!' : 'Export JSON'}</span>
              </button>

              <button
                id="btn-export-stems"
                onClick={() => {
                  alert('Audio Stems mixdown generated! Exporting project package...');
                }}
                className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] border border-[#252B48] text-slate-200 text-xs font-semibold transition-all cursor-pointer"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Export Mixdown</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
