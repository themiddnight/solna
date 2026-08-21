import type { AiGenerationRequest, AiGenerationResponse } from '../../domain/providers/AiProvider';
import { aiJobQueue } from '../../domain/services/AiJobQueueService';
import { aiProviderFactory } from '../../infrastructure/providers/AiProviderFactory';
import { aiSettingsService } from '../../../user-management/domain/services/AiSettingsService';
import type { AiNote } from '../utils/AiContextBuilder';
import { convertAiNotesToMidiNotes } from '../utils/AiContextBuilder';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { systemPressureService } from '../../../../shared/infrastructure/resilience/SystemPressureService';

export class AiGenerationService {

  /**
   * Main entry point for generating AI content.
   * Handles queueing, key retrieval, and provider execution.
   * Respects global concurrency limits to prevent API overload.
   */
  async generate(userId: string, request: AiGenerationRequest): Promise<AiGenerationResponse & { processedNotes: AiNote[] }> {
    // Check if AI generation is enabled under current system pressure
    if (!systemPressureService.isFeatureEnabled('aiGenerationEnabled')) {
      const pressure = systemPressureService.getCurrentPressure();
      loggingService.logInfo('AI generation blocked due to system pressure', {
        userId,
        pressure,
      });
      throw new Error('AI generation is temporarily disabled due to high system load. Please try again in a few moments.');
    }

    // 1. Get User AI Settings & Decrypted Key
    const decrypted = await aiSettingsService.getDecryptedKey(userId);
    if (!decrypted) {
      throw new Error('AI features are disabled or API key is missing. Please check your account settings.');
    }

    const { key, provider: providerId, settings } = decrypted;

    // Inject model from settings if available
    if (typeof settings.model === 'string') {
      request.model = settings.model;
    }

    // 2. Validate Provider
    const provider = aiProviderFactory.getProvider(providerId);

    // 3. Create Job in Queue (may fail if user has active job or queue is full)
    const job = aiJobQueue.createJob(userId, providerId);

    loggingService.logUserActivity('ai_generation_started', userId, {
      provider: providerId,
      jobId: job.id,
      promptLength: request.prompt.length,
      queuePosition: aiJobQueue.getQueuePosition(job.id),
    });

    // 4. Wait for processing slot (respects global concurrency limit)
    try {
      await aiJobQueue.waitForSlot(job.id);
    } catch (error) {
      // Job was canceled while waiting
      if (error instanceof Error && error.message.includes('canceled')) {
        throw new Error('Job canceled');
      }
      throw error;
    }

    // 5. Start processing (move from waiting queue to processing queue)
    aiJobQueue.startProcessing(job.id);

    const startTime = Date.now();
    try {
      // 5. Call Provider
      const result = await provider.generate(key, request, job.abortController?.signal);
      const duration = Date.now() - startTime;

      // 6. Post-process: Convert to MidiNotes (with IDs) — skip in edit mode, which
      // returns `ops` instead of `notes` (there is nothing to convert).
      const isEdit = request.mode === 'edit';
      const processedNotes = isEdit ? [] : convertAiNotesToMidiNotes(result.notes as AiNote[]);

      // 7. Complete Job with enriched result
      const finalResult = { ...result, processedNotes };
      aiJobQueue.completeJob(job.id, finalResult);

      loggingService.logUserActivity('ai_generation_completed', userId, {
        provider: providerId,
        jobId: job.id,
        duration,
        noteCount: processedNotes.length,
        tokenUsage: result.usage
      });


      return finalResult;
    } catch (error: unknown) {
      // 8. Handle Failure
      // Check if it was aborted
      if (job.abortController?.signal.aborted) {
        aiJobQueue.failJob(job.id, 'Job canceled by user');
        loggingService.logUserActivity('ai_generation_canceled', userId, { jobId: job.id });
        throw new Error('Job canceled');
      }

      const errorMessage = error instanceof Error ? error.message : 'AI Generation Failed';
      aiJobQueue.failJob(job.id, errorMessage);

      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'AiGenerationService.generate',
        userId,
        jobId: job.id,
        provider: providerId
      });


      throw error;
    }
  }
}

// Singleton
export const aiGenerationService = new AiGenerationService();
