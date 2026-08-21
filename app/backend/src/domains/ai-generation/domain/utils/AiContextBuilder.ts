import type { MidiNote } from '../../../../domains/arrange-room/domain/models/ArrangeRoomState';

/**
 * Standard AI Note Output Schema
 */
export interface AiNote {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

/**
 * Context structure sent to AI
 */
export interface AiContext {
  bpm: number;
  timeSignature?: {
    numerator: number;   // e.g., 4
    denominator: number; // e.g., 4
  };
  scale?: {
    rootNote: string; // e.g., 'C'
    scale: string;    // e.g., 'Major'
  };
  instrument?: {
    name: string;
    category: string;
  };
  loopLength?: number; // Total beats
  existingNotes?: AiNote[]; // For continuation or modification tasks
}

/**
 * Convert raw AI JSON output to internal MidiNote format
 */
export function convertAiNotesToMidiNotes(aiNotes: AiNote[]): MidiNote[] {
  return aiNotes.map(note => ({
    id: crypto.randomUUID(), // Generate new ID
    pitch: Math.max(0, Math.min(127, Math.round(note.pitch))), // Clamp 0-127
    start: Math.max(0, Number(note.start.toFixed(4))), // Ensure positive
    duration: Math.max(0.0625, Number(note.duration.toFixed(4))), // Min 1/16th
    velocity: Math.max(1, Math.min(127, Math.round(note.velocity))), // Clamp 1-127
  }));
}

/**
 * Build context object for Perform/Arrange room
 */
export function buildAiContext(
  bpm: number, 
  scaleRoot: string = 'C', 
  scaleType: string = 'Major',
  instrumentName: string = 'Piano',
  instrumentCategory: string = 'Keys',
  loopLength: number = 4
): AiContext {
  return {
    bpm,
    scale: {
      rootNote: scaleRoot,
      scale: scaleType,
    },
    instrument: {
      name: instrumentName,
      category: instrumentCategory,
    },
    loopLength,
  };
}
