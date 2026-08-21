import React, { useState, useEffect } from 'react';
import { X, Users, Radio, Plus, Copy, Check, Music, Clock } from 'lucide-react';
import { RoomUser } from '../types';

interface RoomCollaborationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoomId: string;
  onJoinRoom: (roomId: string, name: string) => void;
  users: RoomUser[];
}

export const RoomCollaborationModal: React.FC<RoomCollaborationModalProps> = ({
  isOpen,
  onClose,
  currentRoomId,
  onJoinRoom,
  users,
}) => {
  const [rooms, setRooms] = useState<any[]>([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomType, setNewRoomType] = useState<'perform' | 'arrange'>('perform');
  const [newRoomBpm, setNewRoomBpm] = useState(120);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/rooms')
      .then((res) => res.json())
      .then((data) => setRooms(data))
      .catch((err) => console.error('Failed to fetch rooms:', err));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoomName || 'New Jam Room',
          type: newRoomType,
          bpm: newRoomBpm,
        }),
      });
      const room = await res.json();
      onJoinRoom(room.id, room.name);
      onClose();
    } catch (err) {
      console.error('Failed to create room:', err);
    }
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12152A] border border-[#2D355A] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#0B0D19] p-4 border-b border-[#252B48] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100">Live Jam Band Collaboration</h3>
              <p className="text-xs text-slate-400">Join multi-user rooms or host a new live session</p>
            </div>
          </div>

          <button
            id="btn-close-rooms-modal"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Active Band Members in Current Room */}
          <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                Current Room Members ({users.length})
              </span>

              <button
                id="btn-copy-invite"
                onClick={copyInvite}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied Link!' : 'Copy Invite'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between bg-[#161A34] p-2.5 rounded-lg border border-[#252B48]"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                      {u.name[0]}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">{u.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono capitalize">{u.instrument}</div>
                    </div>
                  </div>

                  {u.isHost && (
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      HOST
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Join Existing Rooms */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Discover Open Jam Rooms
            </span>

            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#0B0D19] border border-[#252B48] hover:border-[#3B4371] transition-all"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                      {room.name}
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#1C213E] text-slate-300">
                        {room.type === 'perform' ? 'Live Perform' : 'Arrange DAW'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {room.bpm} BPM • {room.scale} • {room.users?.length || 1} online
                    </div>
                  </div>

                  <button
                    id={`btn-join-room-${room.id}`}
                    onClick={() => {
                      onJoinRoom(room.id, room.name);
                      onClose();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      currentRoomId === room.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {currentRoomId === room.id ? 'Active' : 'Join'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Create New Room Form */}
          <form onSubmit={handleCreateRoom} className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-3">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              Create New Room
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Room Name</label>
                <input
                  id="input-create-room-name"
                  type="text"
                  placeholder="e.g. Neo-Funk Jam Lounge"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full bg-[#12152A] border border-[#2D355A] text-slate-100 text-xs rounded-lg p-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Mode</label>
                <select
                  id="select-create-room-type"
                  value={newRoomType}
                  onChange={(e) => setNewRoomType(e.target.value as any)}
                  className="w-full bg-[#12152A] border border-[#2D355A] text-slate-100 text-xs rounded-lg p-2 focus:outline-none focus:border-indigo-500"
                >
                  <option value="perform">Live Perform Room</option>
                  <option value="arrange">Arrange Studio</option>
                </select>
              </div>
            </div>

            <button
              id="btn-submit-create-room"
              type="submit"
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors cursor-pointer shadow-md"
            >
              Create & Join Room
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
