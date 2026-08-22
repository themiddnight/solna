import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const PORT = 3000;

const inMemoryProjects = new Map<string, unknown>();

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(cors());
  app.use(express.json());

  // REST API Routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: Date.now(), service: 'murva-core' });
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
          systemPrompt = `You are an AI music producer and assistant in the murva music app.
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
    console.log(`murva music studio running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
