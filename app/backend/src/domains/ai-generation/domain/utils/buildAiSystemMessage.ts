interface TrackInfo {
  category: string;
}

interface InstrumentInfo {
  category: string;
  name?: string;
}

interface ContextWithTracks {
  tracks?: TrackInfo[];
  instrument?: InstrumentInfo;
}

function hasDrumTrack(context: unknown): boolean {
  if (typeof context !== 'object' || context === null) return false;
  const ctx = context as ContextWithTracks;
  if (Array.isArray(ctx.tracks)) {
    if (ctx.tracks.some((t) => t.category === 'drum_beat')) return true;
  }
  if (ctx.instrument?.category === 'drum_beat') return true;
  if (ctx.instrument?.name === 'drum_beat') return true;
  return false;
}

export function buildDrumMapSection(context: unknown): string {
  const isDrumTrack = hasDrumTrack(context);

  return isDrumTrack ? `
IMPORTANT - General MIDI Drum Mapping:
When generating drum patterns, use this EXACT mapping based on General MIDI Standard:
- B0 (MIDI pitch 35) = Acoustic Bass Drum
- C1 (MIDI pitch 36) = Bass Drum 1 (Kick)
- C#1 (MIDI pitch 37) = Side Stick / Rimshot
- D1 (MIDI pitch 38) = Acoustic Snare
- D#1 (MIDI pitch 39) = Hand Clap
- E1 (MIDI pitch 40) = Electric Snare
- F1 (MIDI pitch 41) = Low Floor Tom
- F#1 (MIDI pitch 42) = Closed Hi-Hat
- G1 (MIDI pitch 43) = High Floor Tom
- G#1 (MIDI pitch 44) = Pedal Hi-Hat
- A1 (MIDI pitch 45) = Low Tom
- A#1 (MIDI pitch 46) = Open Hi-Hat
- B1 (MIDI pitch 47) = Low-Mid Tom
- C2 (MIDI pitch 48) = Hi-Mid Tom
- C#2 (MIDI pitch 49) = Crash Cymbal
- D2 (MIDI pitch 50) = High Tom
- D#2 (MIDI pitch 51) = Ride Cymbal
- G#2 (MIDI pitch 56) = Cowbell

CRITICAL: Always use these exact MIDI pitches for drums (General MIDI Standard).
Common pattern: Kick at C1 (36), Snare at D1 (38), Closed Hi-Hat at F#1 (42), Open Hi-Hat at A#1 (46).
` : '';
}

/**
 * Generate-mode length instruction (DEV-46). The value is in BARS — the bar→beat
 * conversion is time-signature-dependent and done on the frontend (TR-23), so the
 * model is told the bar count and the context's timeSignature, not a beat total.
 */
function buildRangeSection(rangeBars: number | undefined): string {
  if (rangeBars === undefined) return '';
  return `Length: generate approximately ${rangeBars} bars of music. Use the time signature in the context to place notes; do not exceed the requested length.`;
}

export function buildAiSystemMessage(context: unknown, rangeBars?: number): string {
  const isDrumTrack = hasDrumTrack(context);

  return `You are a music composition AI assistant for a web-based collaborative music production studio.
Your goal is to generate musical notes or patterns based on the user's request and the provided context.
Output MUST be valid JSON matching the specified schema. Do not include markdown formatting like \`\`\`json.

Context:
${JSON.stringify(context, null, 2)}

${buildDrumMapSection(context)}

${buildRangeSection(rangeBars)}

Output MUST be valid JSON matching this schema:
{
  "notes": [
    {
      "pitch": number (MIDI pitch, 0-127${isDrumTrack ? ', use EXACT drum mapping above' : ''}),
      "start": number (beat position),
      "duration": number (duration in beats),
      "velocity": number (0-127)
    }
  ]
}
Do not include markdown formatting. Just the JSON object.
`;
}
