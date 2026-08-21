import type { AiNote } from './AiContextBuilder';
import { InvalidAiResponseError } from '../errors/InvalidAiResponseError';

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function extractValidNotes(providerId: string, payload: unknown): AiNote[] {
  const notesCandidate = Array.isArray(payload) ? payload : (payload != null && typeof payload === 'object' && 'notes' in payload ? (payload as Record<string, unknown>).notes : undefined);

  if (!Array.isArray(notesCandidate)) {
    throw new InvalidAiResponseError(
      `${providerId} response did not include a notes array`,
      safeStringify(payload)
    );
  }

  notesCandidate.forEach((note: unknown, index: number) => {
    if (
      note == null || typeof note !== 'object' ||
      typeof (note as Record<string, unknown>).pitch !== 'number' ||
      typeof (note as Record<string, unknown>).start !== 'number' ||
      typeof (note as Record<string, unknown>).duration !== 'number' ||
      typeof (note as Record<string, unknown>).velocity !== 'number'
    ) {
      throw new InvalidAiResponseError(
        `${providerId} response note[${index}] is missing required numeric fields`,
        safeStringify(note)
      );
    }
  });

  return notesCandidate as AiNote[];
}
