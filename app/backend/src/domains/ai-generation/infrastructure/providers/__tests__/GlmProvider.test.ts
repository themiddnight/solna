/* eslint-disable @typescript-eslint/naming-convention */
// Mock the 'openai' default export so no network call happens.
interface MockCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
type CreateCallArgs = Record<string, unknown>;
type ConstructorArgs = { apiKey: string; baseURL?: string };
const createMock = jest.fn<Promise<MockCompletionResponse>, [CreateCallArgs, { signal?: AbortSignal }]>();
const constructorMock = jest.fn<void, [ConstructorArgs]>();
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: createMock } };
    constructor(args: ConstructorArgs) {
      constructorMock(args);
    }
  },
}));
import { GlmProvider } from '../GlmProvider';

describe('GlmProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
    constructorMock.mockReset();
  });

  it('returns validated ops in edit mode', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [{ op: 'modify', target: 0, set: { duration: 0.25 } }, { op: 'remove', target: 9 }] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new GlmProvider();
    const res = await provider.generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });
    expect(res.ops).toEqual([{ op: 'modify', target: 0, set: { duration: 0.25 } }]);
    expect(res.notes).toEqual([]);
  });

  it('constructs the OpenAI client with the GLM (Z.ai) baseURL', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new GlmProvider();
    await provider.generate('a-glm-key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });

    expect(constructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'a-glm-key', baseURL: 'https://api.z.ai/api/paas/v4/' })
    );
  });

  it('uses max_tokens (not max_completion_tokens)', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new GlmProvider();
    await provider.generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      model: 'glm-4.5-flash',
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.max_tokens).toBe(8192);
    expect(callArgs.max_completion_tokens).toBeUndefined();
    expect(callArgs.model).toBe('glm-4.5-flash');
  });
});
