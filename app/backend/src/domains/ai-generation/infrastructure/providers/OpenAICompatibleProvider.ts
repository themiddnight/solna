import type { AiProvider, AiGenerationRequest, AiGenerationResponse } from '../../domain/providers/AiProvider';
import OpenAI from 'openai';
import { InvalidAiResponseError } from '../../domain/errors/InvalidAiResponseError';
import { extractValidNotes } from '../../domain/utils/AiResponseValidator';
import { extractValidOps } from '../../domain/utils/AiOpsValidator';
import { buildAiSystemMessage } from '../../domain/utils/buildAiSystemMessage';
import { buildAiEditSystemMessage } from '../../domain/utils/buildAiEditSystemMessage';

export interface OpenAICompatibleProviderOptions {
  /** Unique provider id (e.g. 'openai', 'deepseek', 'glm') */
  id: string;
  /** Human-readable name for user-facing error messages (e.g. 'OpenAI', 'DeepSeek'); defaults to `id` */
  displayName?: string;
  /** Custom base URL for OpenAI-compatible endpoints; omit for the real OpenAI API */
  baseURL?: string;
  /** Fallback model when the request and env default are both unset */
  defaultModel: string;
  /** Resolves the token-limit param(s) to send for a given model (e.g. max_tokens vs max_completion_tokens) */
  tokenParam: (model: string) => Record<string, number>;
}

// Lazy singleton: cache OpenAI-compatible clients per (apiKey + baseURL) to avoid
// creating new HTTP clients per request.
let clientCache: { key: string; client: OpenAI } | null = null;

function getClient(apiKey: string, baseURL: string | undefined): OpenAI {
  const cacheKey = apiKey + (baseURL ?? '');
  if (clientCache?.key === cacheKey) return clientCache.client;
  clientCache = {
    key: cacheKey,
    client: new OpenAI({
      apiKey,
      baseURL,
      timeout: 30000,
      maxRetries: 3,
      dangerouslyAllowBrowser: false,
    }),
  };
  return clientCache.client;
}

/**
 * Base provider for any OpenAI-API-compatible backend (OpenAI itself, DeepSeek, GLM/Z.ai, ...).
 * Holds the full generate + edit logic; concrete providers just supply id/baseURL/defaultModel/tokenParam.
 */
export class OpenAICompatibleProvider implements AiProvider {
  readonly id: string;
  private readonly displayName: string;
  private readonly baseURL: string | undefined;
  private readonly defaultModel: string;
  private readonly tokenParam: (model: string) => Record<string, number>;

  constructor(opts: OpenAICompatibleProviderOptions) {
    this.id = opts.id;
    this.displayName = opts.displayName ?? opts.id;
    this.baseURL = opts.baseURL;
    this.defaultModel = opts.defaultModel;
    this.tokenParam = opts.tokenParam;
  }

  async generate(
    apiKey: string,
    request: AiGenerationRequest,
    signal?: AbortSignal
  ): Promise<AiGenerationResponse> {
    const openai = getClient(apiKey, this.baseURL);

    const envDefaultModel = process.env[`${this.id.toUpperCase()}_DEFAULT_MODEL`];
    const model = request.model || envDefaultModel || this.defaultModel;

    try {
      const isEdit = request.mode === 'edit' && Array.isArray(request.indexedNotes);
      const systemMessage = isEdit
        ? buildAiEditSystemMessage(request.context, request.indexedNotes ?? [])
        : buildAiSystemMessage(request.context, request.rangeBars);

      const historyMessages = (request.history ?? []).map((turn) => ({
        role: turn.role === 'model' ? ('assistant' as const) : ('user' as const),
        content: turn.content,
      }));

      const tokenParam = this.tokenParam(model);

      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemMessage },
          ...historyMessages,
          { role: 'user', content: request.prompt },
        ],
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'response_format': { type: 'json_object' },
        ...tokenParam,
      }, { signal });

      const content = completion.choices[0]?.message.content;
      if (!content) {
        throw new InvalidAiResponseError(`${this.displayName} returned empty content`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        const parseError = error instanceof Error ? error : new Error(String(error));
        throw new InvalidAiResponseError(`Failed to parse ${this.displayName} response: ` + parseError.message, content);
      }

      const usage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      };

      if (isEdit) {
        const ops = extractValidOps(this.id, parsed, (request.indexedNotes ?? []).length);
        return { notes: [], ops, rawResponse: content, usage };
      }

      const notes = extractValidNotes(this.id, parsed);

      return {
        notes,
        rawResponse: content,
        usage,
      };
    } catch (error: unknown) {
        // Map OpenAI-compatible errors to user friendly messages
        const msg = error as { status?: number; message?: string };
        if (msg.status === 401) throw new Error(`Invalid ${this.displayName} API Key`);
        if (msg.status === 429) throw new Error(`${this.displayName} Rate Limit Exceeded`);
        const errMsg = msg.message ?? String(error);
        if (
          msg.status === 404 ||
          /model.*(not found|does not exist|not exist|no access|do not have access)|no such model|unknown model/i.test(errMsg)
        ) {
          throw new Error(`The AI model "${model}" is unavailable for ${this.displayName}. Please choose a different model in AI Settings.`);
        }
        throw error;
    }
  }
}
