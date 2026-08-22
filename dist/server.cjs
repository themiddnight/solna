var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_http = __toESM(require("http"), 1);
var import_path = __toESM(require("path"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_socket = require("socket.io");
var import_genai = require("@google/genai");

// shared/src/index.ts
var import_zod = require("zod");
var RoomType = /* @__PURE__ */ ((RoomType2) => {
  RoomType2["PERFORM"] = "perform";
  RoomType2["ARRANGE"] = "arrange";
  return RoomType2;
})(RoomType || {});
var SHARED_EVENTS = {
  PING: "shared:ping",
  PONG: "shared:pong",
  USER_JOINED: "shared:user_joined",
  USER_LEFT: "shared:user_left",
  USER_UPDATE: "shared:user_update",
  ERROR: "shared:error",
  IDENTITY_SWAP: "shared:identity_swap",
  ROOM_EXPIRED: "shared:room_expired"
};
var PERFORM_EVENTS = {
  NOTE_ON: "perform:note_on",
  NOTE_OFF: "perform:note_off",
  PARAM_CHANGE: "perform:param_change",
  COMPANION_UPDATE: "perform:companion_update",
  COMPANION_NOTE: "perform:companion_note",
  STATE_SYNC: "perform:state_sync",
  EPHEMERAL_PARAM: "perform:ephemeral_param",
  AUDIO_ROUTE: "perform:audio_route"
};
var ARRANGE_EVENTS = {
  REGION_ADD: "arrange:region_add",
  REGION_UPDATE: "arrange:region_update",
  REGION_REMOVE: "arrange:region_remove",
  TRACK_ADD: "arrange:track_add",
  TRACK_UPDATE: "arrange:track_update",
  TRACK_REMOVE: "arrange:track_remove",
  CHORD_UPDATE: "arrange:chord_update",
  TIMELINE_SEEK: "arrange:timeline_seek",
  COMPANION_UPDATE: "arrange:companion_update"
};
var METRONOME_CONSTANTS = {
  MIN_BPM: 40,
  MAX_BPM: 240,
  DEFAULT_BPM: 120,
  DEFAULT_TIME_SIGNATURE: "4/4"
};
var DEFAULT_COMPANION_CHORD_PROGRESSION = [
  { root: "C", quality: "maj", bars: 1 },
  { root: "G", quality: "maj", bars: 1 },
  { root: "A", quality: "min", bars: 1 },
  { root: "F", quality: "maj", bars: 1 }
];
var createRoomSchema = import_zod.z.object({
  name: import_zod.z.string().min(1).max(100).optional(),
  type: import_zod.z.nativeEnum(RoomType).default("perform" /* PERFORM */),
  isPrivate: import_zod.z.boolean().default(false),
  maxMembers: import_zod.z.number().int().min(2).max(16).default(8),
  bpm: import_zod.z.number().min(40).max(240).default(120),
  timeSignature: import_zod.z.string().default("4/4"),
  scale: import_zod.z.string().default("C Major")
});
var updateRoomSettingsSchema = import_zod.z.object({
  name: import_zod.z.string().min(1).max(100).optional(),
  isPrivate: import_zod.z.boolean().optional(),
  bpm: import_zod.z.number().min(40).max(240).optional(),
  timeSignature: import_zod.z.string().optional(),
  scale: import_zod.z.string().optional()
});
var joinRoomSchema = import_zod.z.object({
  roomId: import_zod.z.string().min(1),
  username: import_zod.z.string().min(1).max(50).optional(),
  role: import_zod.z.string().optional()
});
var updateMetronomeSchema = import_zod.z.object({
  bpm: import_zod.z.number().min(40).max(240).optional(),
  isPlaying: import_zod.z.boolean().optional(),
  timeSignature: import_zod.z.string().optional()
});

// server.ts
import_dotenv.default.config();
var PORT = 3e3;
var inMemoryRooms = /* @__PURE__ */ new Map();
var inMemoryProjects = /* @__PURE__ */ new Map();
inMemoryRooms.set("jam-lounge-1", {
  id: "jam-lounge-1",
  name: "Midnight Funk Lounge",
  type: "perform" /* PERFORM */,
  bpm: 110,
  timeSignature: "4/4",
  scale: "D Dorian",
  isPrivate: false,
  maxMembers: 8,
  createdAt: Date.now() - 1e5,
  users: [
    { id: "user-1", name: "Cosmic Bassist", instrument: "bass", isHost: true },
    { id: "user-2", name: "Neon Keys", instrument: "synthesizer", isHost: false }
  ],
  chordProgression: [
    { root: "D", quality: "min7", bars: 2 },
    { root: "G", quality: "7", bars: 2 }
  ]
});
inMemoryRooms.set("studio-arrange-1", {
  id: "studio-arrange-1",
  name: "Cyberpunk Lo-Fi Beat Lab",
  type: "arrange" /* ARRANGE */,
  bpm: 85,
  timeSignature: "4/4",
  scale: "A Minor",
  isPrivate: false,
  maxMembers: 6,
  createdAt: Date.now() - 5e4,
  users: [
    { id: "user-3", name: "SynthMaster", instrument: "synthesizer", isHost: true }
  ],
  chordProgression: [
    { root: "A", quality: "min", bars: 1 },
    { root: "F", quality: "maj", bars: 1 },
    { root: "C", quality: "maj", bars: 1 },
    { root: "G", quality: "maj", bars: 1 }
  ]
});
async function startServer() {
  const app = (0, import_express.default)();
  const server = import_http.default.createServer(app);
  app.use((0, import_cors.default)());
  app.use(import_express.default.json());
  const io = new import_socket.Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  io.on("connection", (socket) => {
    let currentRoomId = null;
    let currentUserId = socket.id;
    let currentUsername = `Musician_${socket.id.slice(0, 4)}`;
    socket.on("join_room", (data) => {
      currentRoomId = data.roomId;
      if (data.username) currentUsername = data.username;
      socket.join(data.roomId);
      const room = inMemoryRooms.get(data.roomId);
      if (room) {
        const existingIdx = room.users.findIndex((u) => u.id === currentUserId);
        if (existingIdx === -1) {
          room.users.push({
            id: currentUserId,
            name: currentUsername,
            instrument: data.instrument || "synthesizer",
            isHost: room.users.length === 0
          });
        }
        io.to(data.roomId).emit("room_users", room.users);
      }
      socket.to(data.roomId).emit(SHARED_EVENTS.USER_JOINED, {
        userId: currentUserId,
        username: currentUsername,
        instrument: data.instrument || "synthesizer"
      });
    });
    socket.on(PERFORM_EVENTS.NOTE_ON, (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit(PERFORM_EVENTS.NOTE_ON, {
          ...payload,
          senderId: currentUserId,
          senderName: currentUsername
        });
      }
    });
    socket.on(PERFORM_EVENTS.NOTE_OFF, (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit(PERFORM_EVENTS.NOTE_OFF, {
          ...payload,
          senderId: currentUserId
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
    socket.on("metronome_update", (payload) => {
      if (currentRoomId) {
        const room = inMemoryRooms.get(currentRoomId);
        if (room && payload.bpm) {
          room.bpm = payload.bpm;
        }
        io.to(currentRoomId).emit("metronome_update", payload);
      }
    });
    socket.on("voice_activity", (payload) => {
      if (currentRoomId) {
        socket.to(currentRoomId).emit("voice_activity", {
          userId: currentUserId,
          isSpeaking: payload.isSpeaking,
          level: payload.level
        });
      }
    });
    socket.on("disconnect", () => {
      if (currentRoomId) {
        const room = inMemoryRooms.get(currentRoomId);
        if (room) {
          room.users = room.users.filter((u) => u.id !== currentUserId);
          io.to(currentRoomId).emit("room_users", room.users);
        }
        socket.to(currentRoomId).emit(SHARED_EVENTS.USER_LEFT, {
          userId: currentUserId
        });
      }
    });
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: Date.now(), service: "murva-core" });
  });
  app.get("/api/rooms", (_req, res) => {
    const list = Array.from(inMemoryRooms.values());
    res.json(list);
  });
  app.post("/api/rooms", (req, res) => {
    const { name, type, bpm, timeSignature, scale, isPrivate, maxMembers } = req.body;
    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newRoom = {
      id,
      name: name || "Untitled Jam Room",
      type: type || "perform" /* PERFORM */,
      bpm: Number(bpm) || METRONOME_CONSTANTS.DEFAULT_BPM,
      timeSignature: timeSignature || "4/4",
      scale: scale || "C Major",
      isPrivate: Boolean(isPrivate),
      maxMembers: Number(maxMembers) || 8,
      createdAt: Date.now(),
      users: [],
      chordProgression: DEFAULT_COMPANION_CHORD_PROGRESSION
    };
    inMemoryRooms.set(id, newRoom);
    res.status(201).json(newRoom);
  });
  app.get("/api/rooms/:id", (req, res) => {
    const room = inMemoryRooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json(room);
  });
  app.get("/api/projects", (_req, res) => {
    res.json(Array.from(inMemoryProjects.values()));
  });
  app.post("/api/projects", (req, res) => {
    const { id, title, data } = req.body;
    const projectId = id || `proj-${Date.now().toString(36)}`;
    const project = {
      id: projectId,
      title: title || "New Track",
      updatedAt: Date.now(),
      data
    };
    inMemoryProjects.set(projectId, project);
    res.status(201).json(project);
  });
  app.post("/api/ai/generate", async (req, res) => {
    const { type, prompt, genre, key, bpm } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new import_genai.GoogleGenAI({ apiKey });
        let systemPrompt = "";
        if (type === "chords") {
          systemPrompt = `You are a professional music producer and music theorist in a modern DAW studio.
The user wants a chord progression for:
Genre: ${genre || "Lo-Fi / Neo-Soul"}
Key: ${key || "C Major"}
BPM: ${bpm || 120}
Custom prompt: ${prompt || "Groovy, emotionally engaging harmonic progression"}

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Progression Name",
  "description": "Short 1-sentence theory description",
  "scale": "${key || "C Major"}",
  "progression": [
    { "root": "C", "quality": "maj7", "bars": 1 },
    { "root": "A", "quality": "min7", "bars": 1 },
    { "root": "D", "quality": "min7", "bars": 1 },
    { "root": "G", "quality": "7", "bars": 1 }
  ],
  "tips": ["Tip 1", "Tip 2"]
}`;
        } else if (type === "melody") {
          systemPrompt = `You are an expert synthesizer programmer and composer.
Generate a melodic pattern (16 steps) for:
Key: ${key || "C Major"}
BPM: ${bpm || 120}
Prompt: ${prompt || "Catchy lead hook"}

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
        } else if (type === "drum_groove") {
          systemPrompt = `You are a rhythm master and drum machine programmer.
Generate a 16-step drum pattern for:
Genre: ${genre || "House / Synthwave"}
BPM: ${bpm || 120}
Prompt: ${prompt || "Driving, dynamic beat with swing"}

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
          model: "gemini-2.5-flash",
          contents: systemPrompt,
          config: {
            responseMimeType: "application/json"
          }
        });
        const text = response.text?.trim() || "{}";
        const parsed = JSON.parse(text);
        return res.json(parsed);
      }
    } catch (err) {
      console.warn("Gemini API call error (falling back to built-in generator):", err);
    }
    if (type === "chords") {
      const progressionsByGenre = {
        "Lo-Fi": {
          title: "Lo-Fi Nostalgia Loop",
          description: "Lush minor 9th and dominant altered voicings with smooth voice leading.",
          scale: key || "C Major",
          progression: [
            { root: "D", quality: "min7", bars: 1 },
            { root: "G", quality: "7", bars: 1 },
            { root: "C", quality: "maj7", bars: 1 },
            { root: "A", quality: "min7", bars: 1 }
          ],
          tips: ["Add gentle vinyl wobble and subtle lowpass filter cutoff around 800Hz.", "Keep velocity around 60-75 for a laid-back human feel."]
        },
        "Synthwave": {
          title: "Neon Midnight Drive",
          description: "Classic 80s cinematic minor progression with energetic forward drive.",
          scale: key || "A Minor",
          progression: [
            { root: "A", quality: "min", bars: 1 },
            { root: "F", quality: "maj", bars: 1 },
            { root: "C", quality: "maj", bars: 1 },
            { root: "G", quality: "maj", bars: 1 }
          ],
          tips: ["Layer with a rolling 16th-note arpeggiator on a sawtooth wave.", "Add sidechain ducking against the four-on-the-floor kick."]
        }
      };
      const selected = progressionsByGenre[genre || "Lo-Fi"] || progressionsByGenre["Lo-Fi"];
      return res.json(selected);
    }
    if (type === "melody") {
      return res.json({
        title: "Cyber Lead Hook",
        description: "Syncopated pentatonic riff with strong resolution on step 12.",
        notes: [
          { step: 0, note: "C4", duration: 1, velocity: 0.85 },
          { step: 3, note: "D#4", duration: 1, velocity: 0.7 },
          { step: 6, note: "F4", duration: 2, velocity: 0.9 },
          { step: 8, note: "G4", duration: 1, velocity: 0.75 },
          { step: 10, note: "A#4", duration: 1, velocity: 0.8 },
          { step: 12, note: "C5", duration: 3, velocity: 1 }
        ],
        soundDesignPreset: {
          oscType: "sawtooth",
          filterCutoff: 2400,
          resonance: 4,
          attack: 0.01,
          release: 0.35
        }
      });
    }
    return res.json({
      title: "Dynamic Groove Beat",
      bpm: bpm || 120,
      pattern: {
        kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        tom: [false, false, false, false, false, false, false, false, false, false, true, false, false, true, false, false]
      },
      tips: "Tight punchy kick with crisp 808 clap and dynamic velocity ghost notes."
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`murva collaborative music studio running on http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
//# sourceMappingURL=server.cjs.map
