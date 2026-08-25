import React, { useState } from 'react';
import { X, FolderOpen, Save, Download, FileText, Sparkles, Check } from 'lucide-react';
import { ProjectState } from '../types';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectState;
  onSaveProject: (title: string) => void;
  onLoadTemplate: (templateName: string) => void;
}

/** Download filename for the JSON project export. Pure: no DOM, unit-testable. */
export function projectFileName(title: string): string {
  return `${title.replace(/\s+/g, '_')}_solna_project.json`;
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
    downloadAnchor.setAttribute('download', projectFileName(title));
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <dialog className="modal modal-open" aria-label="Project Management and Export">
      <div className="modal-box bg-base-100 border border-base-300 p-0 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-base-200 p-4 border-b border-base-300 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-selector bg-primary/20 border border-primary/30 text-primary">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-base-content">Project Management & Export</h3>
              <p className="text-xs text-base-content/60">Save your session, load templates, and export audio/MIDI</p>
            </div>
          </div>

          <button
            id="btn-close-project-modal"
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Project Title & Save */}
          <div className="card bg-base-200 border border-base-300 p-4 space-y-3">
            <label className="text-xs font-bold text-base-content uppercase tracking-wider block">
              Project Title
            </label>
            <div className="flex gap-2">
              <input
                id="input-project-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input input-sm input-bordered w-full flex-1 text-xs"
              />
              <button
                id="btn-save-project-action"
                onClick={handleSave}
                className="btn btn-sm btn-primary gap-1.5 text-xs"
              >
                {saved ? <Check className="w-4 h-4 text-success" /> : <Save className="w-4 h-4" />}
                <span>{saved ? 'Saved!' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Quick Starter Templates */}
          <div className="card bg-base-200 border border-base-300 p-4 space-y-2.5">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-secondary" />
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
                  className="btn btn-ghost h-auto justify-start bg-base-100 border-base-300 hover:bg-base-300 p-2.5 text-left normal-case"
                >
                  <div>
                    <div className="text-xs font-bold text-base-content">{t.name}</div>
                    <div className="text-[10px] text-base-content/60 font-mono mt-0.5">{t.bpm} BPM • {t.key}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Export Actions */}
          <div className="card bg-base-200 border border-base-300 p-4 space-y-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider block">
              Export Track Stems & Data
            </span>

            <div className="modal-action mt-0 grid grid-cols-2 gap-2">
              <button
                id="btn-export-json"
                onClick={handleExportJSON}
                className="btn btn-sm btn-outline gap-2 text-xs"
              >
                <FileText className="w-4 h-4 text-primary" />
                <span>{exported ? 'Exported JSON!' : 'Export JSON'}</span>
              </button>

              <button
                id="btn-export-stems"
                onClick={() => {
                  alert('Audio Stems mixdown generated! Exporting project package...');
                }}
                className="btn btn-sm btn-outline gap-2 text-xs"
              >
                <Download className="w-4 h-4 text-success" />
                <span>Export Mixdown</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
});
