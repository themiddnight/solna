/* eslint-disable @typescript-eslint/naming-convention */
// Mock the 'openai' default export so no network call happens.
interface MockCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
type CreateCallArgs = Record<string, unknown>;
const createCompletionMock = jest.fn<Promise<MockCompletionResponse>, [CreateCallArgs, { signal?: AbortSignal }]>();
jest.mock('openai', () => ({
  __esModule: true,
  default: class { chat = { completions: { create: createCompletionMock } }; },
}));
import { OpenAIProvider } from '../OpenAIProvider';

describe('OpenAIProvider rangeBars', () => {
  beforeEach(() => createCompletionMock.mockReset());

  it('includes the requested bar count in the system message', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ notes: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new OpenAIProvider();
    await provider.generate('key', {
      prompt: 'A bassline',
      context: { bpm: 120 },
      rangeBars: 8,
    });

    const call = createCompletionMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMessage = call.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(systemMessage).toContain('8 bars');
  });

  it('does not include a range line in edit mode even if rangeBars is set', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ops: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new OpenAIProvider();
    await provider.generate('key', {
      prompt: 'shorten note 0',
      context: { bpm: 120 },
      mode: 'edit',
      rangeBars: 8,
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 1, velocity: 100 }],
    });

    const call = createCompletionMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMessage = call.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(systemMessage).not.toContain('bars of music');
  });
});
