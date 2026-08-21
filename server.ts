import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { GoogleGenAI } from '@google/genai';
import {
  RoomType,
  UserType,
  CORE_NAMESPACES,
  SHARED_EVENTS,
  PERFORM_EVENTS,
  ARRANGE_EVENTS,
  ROOM_STATE_EVENTS,
  METRONOME_CONSTANTS,
  DEFAULT_COMPANION_CHORD_PROGRESSION,
} from './shared/src/index';

dotenv.config();

const PORT = 3000;

interface InMemRoom {
  id: string;
  name: string;
  type: RoomType;
  bpm: number;
  timeSignature: string;
  scale: string;
  isPrivate: boolean;
  maxMembers: number;
  createdAt: number;
  users: Array<{ id: string; name: string; instrument: string; isHost: boolean }>;
  chordProgression: Array<{ root: string; quality: string; bars: number }>;
}

const inMemoryRooms = new Map<string, InMemRoom>();
const inMemoryProjects = new Map<string, unknown>();

// Seed default demo rooms
inMemoryRooms.set('jam-lounge-1', {
  id: 'jam-lounge-1',
  name: 'Midnight Funk Lounge',
  type: RoomType.PERFORM,
  bpm: 110,
  timeSignature: '4/4',
  scale: 'D Dorian',
  isPrivate: false,
  maxMembers: 8,
  createdAt: Date.now() - 100000,
  users: [
    { id: 'user-1', name: 'Cosmic Bassist', instrument: 'bass', isHost: true },
    { id: 'user-2', name: 'Neon Keys', instrument: 'synthesizer', isHost: false },
  ],
  chordProgression: [
    { root: 'D', quality: 'min7', bars: 2 },
    { root: 'G', quality: '7', bars: 2 },
  ],
});

inMemoryRooms.set('studio-arrange-1', {
  id: 'studio-arrange-1',
  name: 'Cyberpunk Lo-Fi Beat Lab',
  type: RoomType.ARRANGE,
  bpm: 85,
  timeSignature: '4/4',
  scale: 'A Minor',
  isPrivate: false,
  maxMembers: 6,
  createdAt: Date.now() - 50000,
  users: [
    { id: 'user-3', name: 'SynthMaster', instrument: 'synthesizer', isHost: true },
  ],
  chordProgression: [
    { root: 'A', quality: 'min', bars: 1 },
    { root: 'F', quality: 'maj', bars: 1 },
    { root: 'C', quality: 'maj', bars: 1 },
    { root: 'G', quality: 'maj', bars: 1 },
  ],
});

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(cors());
  app.use(express.json());

  // Socket.IO Setup
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Socket connection handlers
  io.on('connection', (socket) => {
    let currentRoomId: string | null = null;
    let currentUserId = socket.id;
    let currentUsername = `Musician_${socket.id.slice(0, 4)}`;

    socket.on('join_room', (data: { roomId: string; username?: string; instrument?: string }) => {
      currentRoomId = data.roomId;
      if (data.username) currentUsername = data.username;
      
      socket.join(data.roomId);
      
      const room = inMemoryRooms.get(data.roomId);
      if (room) {
        const existingIdx = room.users.findIndex(u => u.id === currentUserId);
        if (existingIdx === -1) {
          room.users.push({
            id: currentUserId,
            name: currentUsername,
            instrument: data.instrument || 'synthesizer',
            isHost: room.users.length === 0,
          });
        }
        io.to(data.roomId).emit('room_users', room.users);
      }

      socket.to(data.roomId).emit(SHARED_EVENTS.USER_JOINED, {
        userId: currentUserId,
        username: currentUsername,
        instrument: data.instrument || 'synthesizer',
      });
    });

    socket.on(PERFORM_EVENTS.NOTE_ON, (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit(PERFORM_EVENTS.NOTE_ON, {
          ...payload,
          senderId: currentUserId,
          senderName: currentUsername,
        });
      }
    });

    socket.on(PERFORM_EVENTS.NOTE_OFF, (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit(PERFORM_EVENTS.NOTE_OFF, {
          ...payload,
          senderId: currentUserId,
        });
      }
    });

    socket.on(PERFORM_EVENTS.PARAM_CHANGE, (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit(PERFORM_EVENTS.PARAM_CHANGE, payload);
      }
    });

    socket.on(ARRANGE_EVENTS.CHORD_UPDATE, (payload) => {
      if (currentRoomId) {
        const room = inMemoryRooms.get(currentRoomId);
        if (room && payload.chords) {
          room.chordProgression = payload.chords;
        }
        socket.to(currentRoomId).emit(ARRANGE_EVENTS.CHORD_UPDATE, payload);
      }
    });

    socket.on('metronome_update', (payload) => {
      if (currentRoomId) {
        const room = inMemoryRooms.get(currentRoomId);
        if (room && payload.bpm) {
          room.bpm = payload.bpm;
        }
        io.to(currentRoomId).emit('metronome_update', payload);
      }
    });

    socket.on('voice_activity', (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit('voice_activity', {
          userId: currentUserId,
          isSpeaking: payload.isSpeaking,
          level: payload.level,
        });
      }
    });

    socket.on('disconnect', () => {
      if (currentRoomId) {
        const room = inMemoryRooms.get(currentRoomId);
        if (room) {
          room.users = room.users.filter(u => u.id !== currentUserId);
          io.to(currentRoomId).emit('room_users', room.users);
        }
        socket.to(currentRoomId).emit(SHARED_EVENTS.USER_LEFT, {
          userId: currentUserId,
        });
      }
    });
  });

  // REST API Routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: Date.now(), service: 'murva-core' });
  });

  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(inMemoryRooms.values());
    res.json(list);
  });

  app.post('/api/rooms', (req, res) => {
    const { name, type, bpm, timeSignature, scale, isPrivate, maxMembers } = req.body;
    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newRoom: InMemRoom = {
      id,
      name: name || 'Untitled Jam Room',
      type: type || RoomType.PERFORM,
      bpm: Number(bpm) || METRONOME_CONSTANTS.DEFAULT_BPM,
      timeSignature: timeSignature || '4/4',
      scale: scale || 'C Major',
      isPrivate: Boolean(isPrivate),
      maxMembers: Number(maxMembers) || 8,
      createdAt: Date.now(),
      users: [],
      chordProgression: DEFAULT_COMPANION_CHORD_PROGRESSION,
    };
    inMemoryRooms.set(id, newRoom);
    res.status(201).json(newRoom);
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = inMemoryRooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room);
  });

  app.get('/api/projects', (_req, res) => {
    res.json(Array.from(inMemoryProjects.values()));
  });

  app.post('/api/projects', (req, res) => {
    const { id, title, data } = req.body;
    const projectId = id || `proj-${Date.now().toString(36)}`;
    const project = {
      id: projectId,
      title: title || 'New Track',
      updatedAt: Date.now(),
      data,
    };
    inMemoryProjects.set(projectId, project);
    res.status(201).json(project);
  });

  // AI Generation Route using Gemini 2.5
  app.post('/api/ai/generate', async (req, res) => {
    const { type, prompt, genre, key, bpm } = req.body;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        
        let systemPrompt = '';
        if (type === 'chords') {
          systemPrompt = `You are a professional music producer and music theorist in a modern DAW studio.
The user wants a chord progression for:
Genre: ${genre || 'Lo-Fi / Neo-Soul'}
Key: ${key || 'C Major'}
BPM: ${bpm || 120}
Custom prompt: ${prompt || 'Groovy, emotionally engaging harmonic progression'}

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Progression Name",
  "description": "Short 1-sentence theory description",
  "scale": "${key || 'C Major'}",
  "progression": [
    { "root": "C", "quality": "maj7", "bars": 1 },
    { "root": "A", "quality": "min7", "bars": 1 },
    { "root": "D", "quality": "min7", "bars": 1 },
    { "root": "G", "quality": "7", "bars": 1 }
  ],
  "tips": ["Tip 1", "Tip 2"]
}`;
        } else if (type === 'melody') {
          systemPrompt = `You are an expert synthesizer programmer and composer.
Generate a melodic pattern (16 steps) for:
Key: ${key || 'C Major'}
BPM: ${bpm || 120}
Prompt: ${prompt || 'Catchy lead hook'}

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Melody Hook",
  "description": "Short explanation",
  "notes": [
    { "step": 0, "note": "C4", "duration": 1, "velocity": 0.8 },
    { "step": 2, "note": "E4", "duration": 1, "velocity": 0.7 },
    { "step": 4, "note": "G4", "duration": 2, "velocity": 0.9 },
    { "step": 7, "note": "B4", "duration": 1, "velocity": 0.6 },
    { "step": 8, "note": "C5", "duration": 2, "velocity": 1.0 },
    { "step": 12, "note": "A4", "duration": 2, "velocity": 0.75 }
  ],
  "soundDesignPreset": {
    "oscType": "sawtooth",
    "filterCutoff": 1800,
    "resonance": 3,
    "attack": 0.02,
    "release": 0.4
  }
}`;
        } else if (type === 'drum_groove') {
          systemPrompt = `You are a rhythm master and drum machine programmer.
Generate a 16-step drum pattern for:
Genre: ${genre || 'House / Synthwave'}
BPM: ${bpm || 120}
Prompt: ${prompt || 'Driving, dynamic beat with swing'}

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Drum Pattern Name",
  "bpm": ${bpm || 120},
  "pattern": {
    "kick": [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    "snare": [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    "hihat": [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    "openhat": [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    "clap": [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    "tom": [false, false, false, false, false, false, false, false, false, false, true, false, false, true, false, false]
  },
  "tips": "Tips on layering and groove"
}`;
        } else {
          systemPrompt = `You are an AI music producer and assistant in the murva collaborative music app.
User request: ${prompt}
Provide creative musical advice, chord substitutions, and arrangement ideas in concise, highly structured JSON format:
{
  "title": "Creative Music Companion Suggestion",
  "summary": "Short 2-sentence summary",
  "suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"]
}`;
        }

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: systemPrompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const text = response.text?.trim() || '{}';
        const parsed = JSON.parse(text);
        return res.json(parsed);
      }
    } catch (err) {
      console.warn('Gemini API call error (falling back to built-in generator):', err);
    }

    // Built-in intelligent fallback
    if (type === 'chords') {
      const progressionsByGenre: Record<string, unknown> = {
        'Lo-Fi': {
          title: 'Lo-Fi Nostalgia Loop',
          description: 'Lush minor 9th and dominant altered voicings with smooth voice leading.',
          scale: key || 'C Major',
          progression: [
            { root: 'D', quality: 'min7', bars: 1 },
            { root: 'G', quality: '7', bars: 1 },
            { root: 'C', quality: 'maj7', bars: 1 },
            { root: 'A', quality: 'min7', bars: 1 },
          ],
          tips: ['Add gentle vinyl wobble and subtle lowpass filter cutoff around 800Hz.', 'Keep velocity around 60-75 for a laid-back human feel.'],
        },
        'Synthwave': {
          title: 'Neon Midnight Drive',
          description: 'Classic 80s cinematic minor progression with energetic forward drive.',
          scale: key || 'A Minor',
          progression: [
            { root: 'A', quality: 'min', bars: 1 },
            { root: 'F', quality: 'maj', bars: 1 },
            { root: 'C', quality: 'maj', bars: 1 },
            { root: 'G', quality: 'maj', bars: 1 },
          ],
          tips: ['Layer with a rolling 16th-note arpeggiator on a sawtooth wave.', 'Add sidechain ducking against the four-on-the-floor kick.'],
        },
      };

      const selected = progressionsByGenre[genre || 'Lo-Fi'] || progressionsByGenre['Lo-Fi'];
      return res.json(selected);
    }

    if (type === 'melody') {
      return res.json({
        title: 'Cyber Lead Hook',
        description: 'Syncopated pentatonic riff with strong resolution on step 12.',
        notes: [
          { step: 0, note: 'C4', duration: 1, velocity: 0.85 },
          { step: 3, note: 'D#4', duration: 1, velocity: 0.7 },
          { step: 6, note: 'F4', duration: 2, velocity: 0.9 },
          { step: 8, note: 'G4', duration: 1, velocity: 0.75 },
          { step: 10, note: 'A#4', duration: 1, velocity: 0.8 },
          { step: 12, note: 'C5', duration: 3, velocity: 1.0 },
        ],
        soundDesignPreset: {
          oscType: 'sawtooth',
          filterCutoff: 2400,
          resonance: 4,
          attack: 0.01,
          release: 0.35,
        },
      });
    }

    return res.json({
      title: 'Dynamic Groove Beat',
      bpm: bpm || 120,
      pattern: {
        kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        tom: [false, false, false, false, false, false, false, false, false, false, true, false, false, true, false, false],
      },
      tips: 'Tight punchy kick with crisp 808 clap and dynamic velocity ghost notes.',
    });
  });

  // Vite Middleware in Development, Static Serving in Production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`murva collaborative music studio running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
