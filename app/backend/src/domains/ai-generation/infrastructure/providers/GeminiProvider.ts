import type { AiProvider, AiGenerationRequest, AiGenerationResponse } from '../../domain/providers/AiProvider';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { InvalidAiResponseError } from '../../domain/errors/InvalidAiResponseError';
import { extractValidNotes } from '../../domain/utils/AiResponseValidator';
import { extractValidOps } from '../../domain/utils/AiOpsValidator';
import { buildAiSystemMessage } from '../../domain/utils/buildAiSystemMessage';
import { buildAiEditSystemMessage } from '../../domain/utils/buildAiEditSystemMessage';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { PROVIDER_DEFAULT_MODELS } from '../../domain/providerDefaults';

// Lazy singleton: cache Gemini clients per API key to avoid creating new clients per request
let geminiClientCache: { apiKey: string; client: GoogleGenAI } | null = null;

function getGeminiClient(apiKey: string): GoogleGenAI {
  if (geminiClientCache?.apiKey === apiKey) return geminiClientCache.client;
  geminiClientCache = { apiKey, client: new GoogleGenAI({ apiKey }) };
  return geminiClientCache.client;
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';

  async generate(
    apiKey: string,
    request: AiGenerationRequest,
    signal?: AbortSignal
  ): Promise<AiGenerationResponse> {
    const ai = getGeminiClient(apiKey);

    const isEdit = request.mode === 'edit' && Array.isArray(request.indexedNotes);
    const systemMessage = isEdit
      ? buildAiEditSystemMessage(request.context, request.indexedNotes ?? [])
      : buildAiSystemMessage(request.context, request.rangeBars);
    const MAX_CONTINUATION_ATTEMPTS = 3;

    // Resolve the actual model to use and save it back to request
    const actualModel = request.model || process.env.GEMINI_DEFAULT_MODEL || PROVIDER_DEFAULT_MODELS.gemini;
    request.model = actualModel;

    const historyContents = (request.history ?? []).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.content }],
    }));

    try {
      // Initial request
      let result = await ai.models.generateContent({
        model: actualModel,
        config: {
          systemInstruction: { parts: [{ text: systemMessage }] },
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
          ...(signal ? { abortSignal: signal } : {}),
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
        },
        contents: [
          ...historyContents,
          { role: 'user', parts: [{ text: request.prompt }] }
        ]
      });

      let fullText = result.text || '';
      let totalPromptTokens = result.usageMetadata?.promptTokenCount ?? 0;
      let totalCompletionTokens = result.usageMetadata?.candidatesTokenCount ?? 0;
      let continuationAttempts = 0;

      // Check if response was truncated due to MAX_TOKENS (generate mode only; edit-mode
      // responses are small ops arrays and don't need continuation)
      while (
        !isEdit &&
        result.candidates?.[0]?.finishReason === 'MAX_TOKENS' &&
        continuationAttempts < MAX_CONTINUATION_ATTEMPTS
      ) {
        continuationAttempts++;
        loggingService.logWarn('Gemini response truncated; requesting continuation', {
          continuationAttempts,
          maxContinuationAttempts: MAX_CONTINUATION_ATTEMPTS,
        });

        // Send continuation request
        const continuationResult = await ai.models.generateContent({
          model: actualModel,
          config: {
            systemInstruction: { parts: [{ text: systemMessage }] },
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
            ...(signal ? { abortSignal: signal } : {}),
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          },
          contents: [
            { role: 'user', parts: [{ text: request.prompt }] },
            { role: 'model', parts: [{ text: fullText }] },
            { role: 'user', parts: [{ text: 'Continue the JSON from where you stopped. Output only the remaining part that was cut off. Do not repeat what was already generated.' }] }
          ]
        });

        const continuationText = continuationResult.text || '';

        // Merge the continuation with the previous text
        fullText = this.mergeJsonContinuation(fullText, continuationText);

        // Update token counts
        totalPromptTokens += continuationResult.usageMetadata?.promptTokenCount ?? 0;
        totalCompletionTokens += continuationResult.usageMetadata?.candidatesTokenCount ?? 0;

        result = continuationResult;
      }

      if (fullText.length === 0) {
        throw new InvalidAiResponseError('Gemini returned empty content');
      }

      // Parse the complete JSON
      let parsed: unknown;
      if (isEdit) {
        // Edit-mode responses are small, well-formed ops arrays — a plain parse (after
        // stripping markdown fences) avoids the generate-mode repair regexes below, which
        // are tuned for large truncated note payloads and can corrupt valid nested
        // braces (e.g. collapsing legitimate `}}` sequences).
        try {
          const cleaned = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          const parseError = e instanceof Error ? e : new Error(String(e));
          loggingService.logError(parseError, {
            context: 'GeminiProvider.parseResponse',
            fullText,
            continuationAttempts,
          });
          throw new InvalidAiResponseError('Failed to parse Gemini response: ' + parseError.message, fullText);
        }
      } else {
        try {
          let cleaned = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();

          // Find JSON boundaries
          const firstBrace = cleaned.indexOf('{');
          const firstBracket = cleaned.indexOf('[');
          let start = -1;
          if (firstBrace !== -1 && firstBracket !== -1) start = Math.min(firstBrace, firstBracket);
          else if (firstBrace !== -1) start = firstBrace;
          else if (firstBracket !== -1) start = firstBracket;

          if (start !== -1) cleaned = cleaned.substring(start);

          const lastBrace = cleaned.lastIndexOf('}');
          const lastBracket = cleaned.lastIndexOf(']');
          let end = -1;
          if (lastBrace !== -1 && lastBracket !== -1) end = Math.max(lastBrace, lastBracket);
          else if (lastBrace !== -1) end = lastBrace;
          else if (lastBracket !== -1) end = lastBracket;

          if (end !== -1) cleaned = cleaned.substring(0, end + 1);

          // Fix common JSON syntax errors from Gemini
          // Fix: "duration,0.25, -> "duration": 0.25,
          cleaned = cleaned.replace(/"(\w+),(\d+\.?\d*),/g, '"$1": $2,');
          // Fix: "duration,0.25 -> "duration": 0.25
          cleaned = cleaned.replace(/"(\w+),(\d+\.?\d*)/g, '"$1": $2');
          // Fix: double closing braces/brackets
          cleaned = cleaned.replace(/}}/g, '}').replace(/]]/g, ']');
          // Fix: control characters in strings
          // eslint-disable-next-line no-control-regex
          cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '');

          parsed = JSON.parse(cleaned);
        } catch (e) {
          const parseError = e instanceof Error ? e : new Error(String(e));
          loggingService.logError(parseError, {
            context: 'GeminiProvider.parseResponse',
            fullText,
            continuationAttempts,
          });
          throw new InvalidAiResponseError('Failed to parse Gemini response: ' + parseError.message, fullText);
        }
      }

      const usage = {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
      };

      if (isEdit) {
        const ops = extractValidOps(this.id, parsed, (request.indexedNotes ?? []).length);
        return { notes: [], ops, rawResponse: fullText, usage };
      }

      const notes = extractValidNotes(this.id, parsed);

      return {
        notes,
        rawResponse: fullText,
        usage,
      };

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('API key') || String(error).includes('API key')) {
        throw new Error('Invalid Gemini API Key');
      }
      // @google/genai throws ApiError with a numeric HTTP `status`; also match
      // on message text in case the status is lost through a wrapper/retry
      // layer (e.g. "RESOURCE_EXHAUSTED" is Gemini's gRPC-style quota code).
      const status = (error as { status?: number }).status;
      if (status === 429 || /rate limit|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
        throw new Error('Gemini Rate Limit Exceeded');
      }
      if (status === 404 || /model.*not.*(found|support)|is not found for api|not_found|not supported/i.test(msg)) {
        throw new Error(`The AI model "${actualModel}" is unavailable for Gemini. Please choose a different model in AI Settings.`);
      }
      throw error;
    }
  }

  /**
   * Merge continuation text with the previous partial JSON
   */
  private mergeJsonContinuation(partial: string, continuation: string): string {
    // Remove markdown code blocks
    let cleanedContinuation = continuation.replace(/```json/gi, '').replace(/```/g, '').trim();

    // If continuation starts with array/object bracket, it's a new response - extract the content
    if (cleanedContinuation.startsWith('[') || cleanedContinuation.startsWith('{')) {
      // Try to extract just the inner content
      const firstBracket = cleanedContinuation.indexOf('[');
      const firstBrace = cleanedContinuation.indexOf('{');

      if (firstBracket === 0) {
        // It's an array, extract elements
        cleanedContinuation = cleanedContinuation.substring(1); // Remove opening [
        const lastBracket = cleanedContinuation.lastIndexOf(']');
        if (lastBracket !== -1) {
          cleanedContinuation = cleanedContinuation.substring(0, lastBracket); // Remove closing ]
        }
      } else if (firstBrace === 0) {
        // It's an object, keep as is for now
        // This case is less common for note generation
      }
    }

    // Remove leading comma if exists
    cleanedContinuation = cleanedContinuation.replace(/^\s*,\s*/, '');

    // Merge: remove trailing ] or } from partial, add continuation, then close
    let merged = partial.trim();

    // Remove trailing closing brackets
    merged = merged.replace(/[\]}]\s*$/, '');

    // Add comma if needed
    if (!merged.endsWith(',') && cleanedContinuation.length > 0) {
      merged += ',';
    }

    // Add continuation
    merged += cleanedContinuation;

    // Close the JSON structure
    if (partial.trim().startsWith('[')) {
      merged += ']';
    } else if (partial.trim().startsWith('{')) {
      merged += '}';
    }

    return merged;
  }
}
