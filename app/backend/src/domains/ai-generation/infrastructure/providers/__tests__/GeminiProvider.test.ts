/* eslint-disable @typescript-eslint/naming-convention */
// Mock '@google/genai' so no network call happens.
interface MockGenerateContentResponse {
  text: string;
  candidates?: Array<{ finishReason: string }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
}
interface GenerateContentCallArgs {
  model: string;
  config: { systemInstruction: { parts: Array<{ text: string }> } };
  contents: unknown;
}
const generateContentMock = jest.fn<Promise<MockGenerateContentResponse>, [GenerateContentCallArgs]>();
jest.mock('@google/genai', () => ({
  __esModule: true,
  GoogleGenAI: class { models = { generateContent: generateContentMock }; },
  HarmBlockThreshold: { BLOCK_NONE: 'BLOCK_NONE' },
  HarmCategory: {
    HARM_CATEGORY_HATE_SPEECH: 'h', HARM_CATEGORY_SEXUALLY_EXPLICIT: 's',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'd', HARM_CATEGORY_HARASSMENT: 'ha',
  },
}));
import { GeminiProvider } from '../GeminiProvider';

describe('GeminiProvider edit mode', () => {
  beforeEach(() => generateContentMock.mockReset());

  it('returns validated ops', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ ops: [{ op: 'add', note: { pitch: 42, start: 1, duration: 0.25, velocity: 90 } }] }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
    const res = await new GeminiProvider().generate('key', {
      prompt: 'add a hat', context: { bpm: 120 }, mode: 'edit',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });
    expect(res.ops).toEqual([{ op: 'add', note: { pitch: 42, start: 1, duration: 0.25, velocity: 90 } }]);
    expect(res.notes).toEqual([]);
  });
});

describe('GeminiProvider rangeBars', () => {
  beforeEach(() => generateContentMock.mockReset());

  it('includes the requested bar count in the system instruction', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ notes: [] }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
    await new GeminiProvider().generate('key', {
      prompt: 'A bassline',
      context: { bpm: 120 },
      rangeBars: 8,
    });

    const call = generateContentMock.mock.calls[0]?.[0];
    const systemMessage = call?.config.systemInstruction.parts[0]?.text ?? '';
    expect(systemMessage).toContain('8 bars');
  });

  it('does not include a range line in edit mode even if rangeBars is set', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ ops: [] }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
    await new GeminiProvider().generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      rangeBars: 8,
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });

    const call = generateContentMock.mock.calls[0]?.[0];
    const systemMessage = call?.config.systemInstruction.parts[0]?.text ?? '';
    expect(systemMessage).not.toContain('bars of music');
  });
});

// Mirrors @google/genai's real ApiError shape (extends Error, adds a numeric
// HTTP `status`) without importing the SDK class directly.
class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

describe('GeminiProvider error mapping', () => {
  beforeEach(() => generateContentMock.mockReset());

  it('maps a 429 ApiError to a friendly rate-limit message', async () => {
    generateContentMock.mockRejectedValue(new FakeApiError(429, 'Too Many Requests'));

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 } }),
    ).rejects.toThrow('Gemini Rate Limit Exceeded');
  });

  it('maps a RESOURCE_EXHAUSTED message (no status) to the rate-limit message', async () => {
    generateContentMock.mockRejectedValue(
      new Error('[429 RESOURCE_EXHAUSTED] Quota exceeded for quota metric'),
    );

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 } }),
    ).rejects.toThrow('Gemini Rate Limit Exceeded');
  });

  it('still maps an API-key error distinctly from rate limiting', async () => {
    generateContentMock.mockRejectedValue(new Error('API key not valid'));

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 } }),
    ).rejects.toThrow('Invalid Gemini API Key');
  });

  it('rethrows unrelated errors unchanged', async () => {
    generateContentMock.mockRejectedValue(new Error('network hiccup'));

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 } }),
    ).rejects.toThrow('network hiccup');
  });

  it('maps a 404 ApiError to a friendly "unavailable" message naming the model', async () => {
    generateContentMock.mockRejectedValue(new FakeApiError(404, 'models/gemini-9-retired is not found for API version v1beta'));

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 }, model: 'gemini-9-retired' }),
    ).rejects.toThrow('The AI model "gemini-9-retired" is unavailable for Gemini. Please choose a different model in AI Settings.');
  });

  it('maps a NOT_FOUND message (no status) to the same friendly message', async () => {
    generateContentMock.mockRejectedValue(new Error('[404 NOT_FOUND] model not found or not supported'));

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 }, model: 'gemini-9-retired' }),
    ).rejects.toThrow('The AI model "gemini-9-retired" is unavailable for Gemini. Please choose a different model in AI Settings.');
  });

  it('still maps a 429 to the rate-limit message rather than the model-not-found message (no regression)', async () => {
    generateContentMock.mockRejectedValue(new FakeApiError(429, 'Too Many Requests'));

    await expect(
      new GeminiProvider().generate('key', { prompt: 'p', context: { bpm: 120 }, model: 'gemini-2.5-flash-lite' }),
    ).rejects.toThrow('Gemini Rate Limit Exceeded');
  });
});
