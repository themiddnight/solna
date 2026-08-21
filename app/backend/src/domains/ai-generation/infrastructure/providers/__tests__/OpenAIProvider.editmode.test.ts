/* eslint-disable @typescript-eslint/naming-convention */
// Mock the 'openai' default export so no network call happens.
interface MockCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
type CreateCallArgs = Record<string, unknown>;
const createMock = jest.fn<Promise<MockCompletionResponse>, [CreateCallArgs, { signal?: AbortSignal }]>();
jest.mock('openai', () => ({
  __esModule: true,
  default: class { chat = { completions: { create: createMock } }; },
}));
import { OpenAIProvider } from '../OpenAIProvider';

// Mirrors the OpenAI SDK's real APIError shape (extends Error, adds a numeric
// HTTP `status`) without importing the SDK class directly.
class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

describe('OpenAIProvider edit mode', () => {
  beforeEach(() => createMock.mockReset());

  it('returns validated ops in edit mode', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [{ op: 'modify', target: 0, set: { duration: 0.25 } }, { op: 'remove', target: 9 }] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new OpenAIProvider();
    const res = await provider.generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });
    expect(res.ops).toEqual([{ op: 'modify', target: 0, set: { duration: 0.25 } }]);
    expect(res.notes).toEqual([]);
  });

  it('uses max_completion_tokens (not max_tokens) for gpt-5.x models', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new OpenAIProvider();
    await provider.generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      model: 'gpt-5.4-nano',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.max_completion_tokens).toBe(8192);
    expect(callArgs.max_tokens).toBeUndefined();
    expect(callArgs.model).toBe('gpt-5.4-nano');
  });

  it('still uses max_tokens for non-gpt-5 models', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new OpenAIProvider();
    await provider.generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      model: 'gpt-4o-mini',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.max_tokens).toBe(8192);
    expect(callArgs.max_completion_tokens).toBeUndefined();
  });
});

describe('OpenAIProvider error mapping', () => {
  beforeEach(() => createMock.mockReset());

  it('maps a 404 model_not_found error to a friendly "unavailable" message naming the model', async () => {
    createMock.mockRejectedValue(
      new FakeApiError(404, "The model `gpt-6-nonexistent` does not exist or you do not have access to it."),
    );

    const provider = new OpenAIProvider();
    await expect(
      provider.generate('key', {
        prompt: 'shorten note 0',
        context: { bpm: 120 },
        mode: 'edit',
        model: 'gpt-6-nonexistent',
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
      }),
    ).rejects.toThrow('The AI model "gpt-6-nonexistent" is unavailable for OpenAI. Please choose a different model in AI Settings.');
  });

  it('maps a 400 "model does not exist" message (no 404 status) to the same friendly message', async () => {
    createMock.mockRejectedValue(new FakeApiError(400, 'The model `gpt-6-renamed` does not exist'));

    const provider = new OpenAIProvider();
    await expect(
      provider.generate('key', {
        prompt: 'shorten note 0',
        context: { bpm: 120 },
        mode: 'edit',
        model: 'gpt-6-renamed',
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
      }),
    ).rejects.toThrow('The AI model "gpt-6-renamed" is unavailable for OpenAI. Please choose a different model in AI Settings.');
  });

  it('still maps a 429 to the rate-limit message (no regression)', async () => {
    createMock.mockRejectedValue(new FakeApiError(429, 'Too Many Requests'));

    const provider = new OpenAIProvider();
    await expect(
      provider.generate('key', {
        prompt: 'shorten note 0',
        context: { bpm: 120 },
        mode: 'edit',
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
      }),
    ).rejects.toThrow('OpenAI Rate Limit Exceeded');
  });

  it('still maps a 401 to the invalid-key message (no regression)', async () => {
    createMock.mockRejectedValue(new FakeApiError(401, 'Incorrect API key provided'));

    const provider = new OpenAIProvider();
    await expect(
      provider.generate('key', {
        prompt: 'shorten note 0',
        context: { bpm: 120 },
        mode: 'edit',
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
      }),
    ).rejects.toThrow('Invalid OpenAI API Key');
  });

  it('rethrows unrelated errors unchanged', async () => {
    createMock.mockRejectedValue(new FakeApiError(500, 'internal server error'));

    const provider = new OpenAIProvider();
    await expect(
      provider.generate('key', {
        prompt: 'shorten note 0',
        context: { bpm: 120 },
        mode: 'edit',
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
      }),
    ).rejects.toThrow('internal server error');
  });
});
