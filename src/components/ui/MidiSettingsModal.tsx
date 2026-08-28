import React, { useState, useEffect } from 'react';
import { Sliders, Radio, Trash2, Plus, RotateCcw, X } from 'lucide-react';
import { useAppStore } from '../../store/store';
import type { MidiMapping } from '../../store/types';
import { SECTION_HEADER } from './fieldClasses';

const AVAILABLE_TARGETS = [
  { key: 'masterVolume', label: 'Master Volume' },
  { key: 'filterCutoff', label: 'Filter Cutoff' },
  { key: 'filterResonance', label: 'Filter Resonance' },
  { key: 'oscType', label: 'Oscillator Type' },
  { key: 'attack', label: 'Attack Time' },
  { key: 'release', label: 'Release Time' },
  { key: 'notes', label: 'Keyboard Notes (Note On/Off)' },
];

export const MidiSettingsModal: React.FC = () => {
  const isOpen = useAppStore((s) => s.isMidiSettingsOpen);
  const setIsOpen = useAppStore((s) => s.setIsMidiSettingsOpen);
  const midiMappings = useAppStore((s) => s.midiMappings);
  const updateMidiMapping = useAppStore((s) => s.updateMidiMapping);
  const addMidiMapping = useAppStore((s) => s.addMidiMapping);
  const removeMidiMapping = useAppStore((s) => s.removeMidiMapping);
  const resetMidiMappings = useAppStore((s) => s.resetMidiMappings);
  const midiLearnTargetId = useAppStore((s) => s.midiLearnTargetId);
  const setMidiLearnTargetId = useAppStore((s) => s.setMidiLearnTargetId);

  const selectedMidiInputId = useAppStore((s) => s.selectedMidiInputId);
  const setSelectedMidiInputId = useAppStore((s) => s.setSelectedMidiInputId);

  const [inputs, setInputs] = useState<Array<{ id: string; name: string }>>([]);
  const [newTargetKey, setNewTargetKey] = useState('filterCutoff');
  const [newCcNumber, setNewCcNumber] = useState(20);

  useEffect(() => {
    if (!isOpen || typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      return;
    }
    (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> })
      .requestMIDIAccess?.()
      .then((access) => {
        if (!access) return;
        const updateDevices = () => {
          const list: Array<{ id: string; name: string }> = [];
          for (const input of access.inputs.values()) {
            list.push({ id: input.id, name: input.name || 'Unnamed MIDI Device' });
          }
          setInputs(list);
        };
        updateDevices();
        access.onstatechange = updateDevices;
      })
      .catch(() => {
        setInputs([]);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const targetObj = AVAILABLE_TARGETS.find((t) => t.key === newTargetKey);
    const isNote = newTargetKey === 'notes';
    const newMapping: MidiMapping = {
      id: `custom-${Date.now()}`,
      type: isNote ? 'note' : 'cc',
      ccNumber: isNote ? undefined : Number(newCcNumber),
      targetKey: newTargetKey,
      targetLabel: targetObj?.label || newTargetKey,
      enabled: true,
    };
    addMidiMapping(newMapping);
  };

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-base-300 pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">MIDI Controller & Mappings</h3>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="btn btn-sm btn-ghost btn-square"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Connected Devices & Input Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className={`${SECTION_HEADER}/60 flex items-center gap-1.5`}>
              <Radio className="w-3.5 h-3.5 text-primary" /> Connected MIDI Inputs ({inputs.length})
            </h4>
          </div>

          <div className="bg-base-200 border border-base-300 rounded-box p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold">Active Input Device:</span>
              <select
                value={selectedMidiInputId}
                onChange={(e) => setSelectedMidiInputId(e.target.value)}
                className="select select-sm select-bordered text-xs max-w-xs flex-1 font-mono"
              >
                <option value="all">All Connected Devices (Omni)</option>
                {inputs.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.name} ({input.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            {inputs.length > 0 ? (
              <ul className="space-y-1.5 border-t border-base-300 pt-2.5">
                {inputs.map((input) => {
                  const isActive = selectedMidiInputId === 'all' || selectedMidiInputId === input.id;
                  return (
                    <li key={input.id} className="flex items-center justify-between text-xs font-mono text-base-content">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-success animate-pulse' : 'bg-base-content/30'}`} />
                        <span>{input.name}</span>
                      </div>
                      <span className="badge badge-xs badge-ghost text-[10px]">
                        {isActive ? 'Listening' : 'Bypassed'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-base-content/60 italic">
                No MIDI input devices detected or Web MIDI permission not granted. Connect a USB MIDI keyboard or controller.
              </p>
            )}
          </div>
        </div>

        {/* MIDI Learn status alert */}
        {midiLearnTargetId && (
          <div className="alert alert-warning py-2 text-xs flex items-center justify-between">
            <span>🔴 <b>MIDI Learn Active:</b> Twist a knob or press a control on your MIDI device...</span>
            <button
              type="button"
              onClick={() => setMidiLearnTargetId(null)}
              className="btn btn-xs btn-ghost"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Mappings Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className={`${SECTION_HEADER}/60`}>
              Active Mappings ({midiMappings.length})
            </h4>
            <button
              type="button"
              onClick={resetMidiMappings}
              className="btn btn-xs btn-ghost gap-1 text-base-content/70 hover:text-base-content"
            >
              <RotateCcw className="w-3 h-3" /> Reset Defaults
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto border border-base-300 rounded-box divide-y divide-base-300">
            {midiMappings.map((mapping) => {
              const isLearning = midiLearnTargetId === mapping.id;
              return (
                <div
                  key={mapping.id}
                  className={`flex items-center justify-between p-3 gap-3 hover:bg-base-200/50 transition-colors ${
                    !mapping.enabled ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={mapping.enabled}
                      onChange={(e) => updateMidiMapping(mapping.id, { enabled: e.target.checked })}
                      className="checkbox checkbox-xs checkbox-primary"
                      title="Enable/Disable binding"
                    />
                    <div>
                      <div className="font-semibold text-xs text-base-content flex items-center gap-2">
                        {mapping.targetLabel}
                        <span className="badge badge-xs badge-ghost font-mono">
                          {mapping.type.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[10px] text-base-content/60 font-mono">
                        {mapping.type === 'cc' ? `CC #${mapping.ccNumber}` : 'Note On/Off (0-127)'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {mapping.type === 'cc' && (
                      <button
                        type="button"
                        onClick={() => setMidiLearnTargetId(isLearning ? null : mapping.id)}
                        className={`btn btn-xs ${isLearning ? 'btn-error animate-pulse' : 'btn-outline btn-primary'}`}
                      >
                        {isLearning ? 'Listening...' : 'Learn CC'}
                      </button>
                    )}
                    {mapping.type === 'cc' && (
                      <input
                        type="number"
                        min="0"
                        max="127"
                        value={mapping.ccNumber ?? 0}
                        onChange={(e) =>
                          updateMidiMapping(mapping.id, { ccNumber: parseInt(e.target.value) || 0 })
                        }
                        className="input input-xs input-bordered w-14 font-mono text-center"
                        title="Edit CC number"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMidiMapping(mapping.id)}
                      className="btn btn-xs btn-ghost btn-square text-error"
                      title="Clear binding"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add Custom Binding Form */}
        <form onSubmit={handleAddCustom} className="border-t border-base-300 pt-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
          <div className="form-control flex-1">
            <label className="label label-text text-xs">Target Parameter</label>
            <select
              value={newTargetKey}
              onChange={(e) => setNewTargetKey(e.target.value)}
              className="select select-sm select-bordered w-full text-xs"
            >
              {AVAILABLE_TARGETS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {newTargetKey !== 'notes' && (
            <div className="form-control w-full sm:w-24">
              <label className="label label-text text-xs">CC Number</label>
              <input
                type="number"
                min="0"
                max="127"
                value={newCcNumber}
                onChange={(e) => setNewCcNumber(parseInt(e.target.value) || 0)}
                className="input input-sm input-bordered w-full font-mono text-center text-xs"
              />
            </div>
          )}
          <button type="submit" className="btn btn-sm btn-primary gap-1 w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Add Mapping
          </button>
        </form>

        {/* Footer Actions */}
        <div className="modal-action">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="btn btn-sm btn-primary"
          >
            Done
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={() => setIsOpen(false)}>close</button>
      </form>
    </dialog>
  );
};
