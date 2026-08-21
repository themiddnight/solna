import type { NoteEditOp } from '@jam-band/shared';

export interface AiTurn {
  role: 'user' | 'model';
  content: string;
}

export interface AiGenerationRequest {
  prompt: string;
  context: unknown; // Context about the room/tracks (BPM, Scale, Instrument, etc.)
  maxTokens?: number;
  model?: string;
  mode?: 'generate' | 'edit';
  history?: AiTurn[];
  /**
   * Generate-mode range length in BARS (DEV-46), capped at
   * AI_GENERATION_CONSTANTS.MAX_RANGE_BARS by the route. Bars rather than beats
   * because the bar→beat conversion is time-signature-dependent and is done on
   * the frontend (TR-23).
   */
  rangeBars?: number;
  indexedNotes?: Array<{
    index: number;
    pitch: number;
    start: number;
    duration: number;
    velocity: number;
  }>;
}

export interface AiGenerationResponse {
  notes: unknown[]; // The generated notes/regions
  ops?: NoteEditOp[]; // Edit operations (present in edit mode)
  rawResponse?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AiProvider {
  /**
   * Unique identifier for the provider (e.g., 'openai', 'gemini')
   */
  readonly id: string;

  /**
   * Generate content based on prompt and context
   */
  generate(
    apiKey: string,
    request: AiGenerationRequest,
    signal?: AbortSignal
  ): Promise<AiGenerationResponse>;
}
