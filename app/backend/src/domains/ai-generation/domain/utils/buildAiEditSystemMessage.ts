import type { AiNoteShape } from '@jam-band/shared';
import { buildDrumMapSection } from './buildAiSystemMessage';

export function buildAiEditSystemMessage(
  context: unknown,
  indexedNotes: Array<AiNoteShape & { index: number }>,
): string {
  return `You are a music composition AI assistant editing an EXISTING pattern in a collaborative music studio.
You are given the current notes, each with a stable "index". Return ONLY the edits needed to satisfy the user's request as a JSON object of operations. Do NOT return the whole pattern. Leave untouched notes alone.

Context:
${JSON.stringify(context, null, 2)}

Current notes (edit these by "index"):
${JSON.stringify(indexedNotes, null, 2)}
${buildDrumMapSection(context)}
Output MUST be valid JSON matching this schema (no markdown, no code fences):
{
  "ops": [
    { "op": "modify", "target": <index of an existing note>, "set": { "pitch"?: number, "start"?: number, "duration"?: number, "velocity"?: number } },
    { "op": "add", "note": { "pitch": number, "start": number, "duration": number, "velocity": number } },
    { "op": "remove", "target": <index of an existing note> }
  ]
}
Rules:
- "target" must be one of the indices shown above.
- "start"/"duration" are in beats; "pitch"/"velocity" are 0-127.
- Prefer the smallest set of ops that satisfies the request.
Just the JSON object.
`;
}
