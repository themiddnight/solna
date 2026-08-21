import crypto from 'crypto';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";

export type AiJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface AiJob {
  id: string;
  userId: string;
  status: AiJobStatus;
  provider: string;
  createdAt: number;
  startedAt?: number;
  result?: unknown;
  error?: string;
  abortController?: AbortController;
  priority: number; // Lower number = higher priority
}

export interface QueueStats {
  totalJobs: number;
  processingJobs: number;
  queuedJobs: number;
  maxConcurrent: number;
  avgWaitTime: number;
  avgProcessingTime: number;
}

/**
 * ⚠️ SINGLE-INSTANCE ASSUMPTION: the queue, active-job map, and concurrency
 * caps are in-process. With multiple backend instances, per-user and global
 * concurrency limits are enforced per-instance only (N instances → N× the
 * intended cap). Move the queue to Redis before scaling horizontally.
 *
 * AI Job Queue Service with Concurrency Control
 *
 * Features:
 * 1. Only one active job per user
 * 2. Global concurrency limit to prevent API overload
 * 3. Priority queue for fair scheduling
 * 4. Metrics tracking for monitoring
 */
export class AiJobQueueService {
  private readonly jobs: Map<string, AiJob> = new Map();
  private readonly userActiveJobs: Map<string, string> = new Map();
  private readonly processingQueue: string[] = []; // Job IDs currently being processed
  private readonly waitingQueue: string[] = []; // Job IDs waiting to be processed

  // Configuration
  private readonly maxConcurrentJobs: number;
  private readonly maxQueueSize: number;
  private readonly jobTimeout: number;

  // Metrics
  private totalJobsCreated = 0;
  private totalJobsCompleted = 0;
  private totalJobsFailed = 0;
  private totalWaitTime = 0;
  private totalProcessingTime = 0;

  constructor(config?: {
    maxConcurrentJobs?: number;
    maxQueueSize?: number;
    jobTimeout?: number;
  }) {
    this.maxConcurrentJobs = config?.maxConcurrentJobs ?? 5;
    this.maxQueueSize = config?.maxQueueSize ?? 50;
    this.jobTimeout = config?.jobTimeout ?? 120000; // 2 minutes default

    loggingService.logInfo('AiJobQueueService initialized', {
      maxConcurrentJobs: this.maxConcurrentJobs,
      maxQueueSize: this.maxQueueSize,
      jobTimeout: this.jobTimeout,
    });
  }

  /**
   * Create a new job for user.
   * Fails if user already has an active job or queue is full.
   */
  createJob(userId: string, provider: string, priority: number = 5): AiJob {
    // Check if user already has an active job
    if (this.userActiveJobs.has(userId)) {
      throw new Error('You already have a generation in progress. Please wait or cancel it.');
    }

    // Check queue capacity
    if (this.waitingQueue.length >= this.maxQueueSize) {
      throw new Error('AI generation queue is full. Please try again later.');
    }

    const id = crypto.randomUUID();
    const job: AiJob = {
      id,
      userId,
      provider,
      status: 'queued',
      createdAt: Date.now(),
      priority,
      abortController: new AbortController(),
    };

    this.jobs.set(id, job);
    this.userActiveJobs.set(userId, id);
    this.waitingQueue.push(id);
    this.totalJobsCreated++;

    // Sort waiting queue by priority (lower number = higher priority)
    this.sortWaitingQueue();

    loggingService.logInfo('AI job created', {
      jobId: id,
      userId,
      provider,
      priority,
      queuePosition: this.waitingQueue.indexOf(id) + 1,
      totalQueued: this.waitingQueue.length,
    });

    return job;
  }

  /**
   * Check if a job can start processing
   */
  canStartProcessing(): boolean {
    return this.processingQueue.length < this.maxConcurrentJobs && this.waitingQueue.length > 0;
  }

  /**
   * Get next job to process (respects priority)
   */
  getNextJob(): AiJob | null {
    if (!this.canStartProcessing()) {
      return null;
    }

    const jobId = this.waitingQueue.shift();
    if (!jobId) return null;

    return this.jobs.get(jobId) || null;
  }

  /**
   * Start processing a job
   */
  startProcessing(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Check concurrency limit
    if (this.processingQueue.length >= this.maxConcurrentJobs) {
      loggingService.logInfo('AI job waiting - concurrency limit reached', {
        jobId,
        processing: this.processingQueue.length,
        maxConcurrent: this.maxConcurrentJobs,
      });
      return false;
    }

    // Remove from waiting queue if present
    const waitingIndex = this.waitingQueue.indexOf(jobId);
    if (waitingIndex !== -1) {
      this.waitingQueue.splice(waitingIndex, 1);
    }

    // Add to processing queue
    this.processingQueue.push(jobId);
    job.status = 'processing';
    job.startedAt = Date.now();

    // Track wait time
    const waitTime = job.startedAt - job.createdAt;
    this.totalWaitTime += waitTime;

    loggingService.logInfo('AI job started processing', {
      jobId,
      userId: job.userId,
      waitTimeMs: waitTime,
      currentlyProcessing: this.processingQueue.length,
    });

    // Set up timeout
    setTimeout(() => {
      const currentJob = this.jobs.get(jobId);
      if (currentJob && currentJob.status === 'processing') {
        this.failJob(jobId, 'Job timed out');
        loggingService.logInfo('AI job timed out', { jobId });
      }
    }, this.jobTimeout);

    return true;
  }

  /**
   * Wait for a slot to become available (for queued jobs)
   */
  async waitForSlot(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Job not found');

    // If we can start immediately, do so
    if (this.processingQueue.length < this.maxConcurrentJobs) {
      return;
    }

    // Otherwise, wait for a slot
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const currentJob = this.jobs.get(jobId);

        // Job was canceled or removed
        if (!currentJob || currentJob.status === 'canceled') {
          clearInterval(checkInterval);
          reject(new Error('Job canceled'));
          return;
        }

        // Slot available
        if (this.processingQueue.length < this.maxConcurrentJobs) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Timeout after 30 seconds of waiting
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timed out waiting for processing slot'));
      }, 30000);
    });
  }

  getJob(userId: string): AiJob | undefined {
    const jobId = this.userActiveJobs.get(userId);
    if (!jobId) return undefined;
    return this.jobs.get(jobId);
  }

  getJobById(jobId: string): AiJob | undefined {
    return this.jobs.get(jobId);
  }

  completeJob(jobId: string, result: unknown): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.result = result;

    // Track processing time
    if (job.startedAt !== undefined) {
      const processingTime = Date.now() - job.startedAt;
      this.totalProcessingTime += processingTime;
    }
    this.totalJobsCompleted++;

    // Remove from queues
    this.removeFromQueues(jobId, job.userId);

    loggingService.logInfo('AI job completed', {
      jobId,
      userId: job.userId,
      processingTimeMs: job.startedAt !== undefined ? Date.now() - job.startedAt : 0,
    });
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.error = error;
    this.totalJobsFailed++;

    // Remove from queues
    this.removeFromQueues(jobId, job.userId);

    loggingService.logInfo('AI job failed', {
      jobId,
      userId: job.userId,
      error,
    });
  }

  cancelJob(userId: string): boolean {
    const jobId = this.userActiveJobs.get(userId);
    if (!jobId) return false;

    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.status = 'canceled';
    job.abortController?.abort();

    // Remove from queues
    this.removeFromQueues(jobId, userId);

    loggingService.logInfo('AI job canceled', {
      jobId,
      userId,
    });

    return true;
  }

  /**
   * Get queue statistics for monitoring
   */
  getStats(): QueueStats {
    const completedJobs = this.totalJobsCompleted;

    return {
      totalJobs: this.totalJobsCreated,
      processingJobs: this.processingQueue.length,
      queuedJobs: this.waitingQueue.length,
      maxConcurrent: this.maxConcurrentJobs,
      avgWaitTime: completedJobs > 0 ? this.totalWaitTime / completedJobs : 0,
      avgProcessingTime: completedJobs > 0 ? this.totalProcessingTime / completedJobs : 0,
    };
  }

  /**
   * Get current queue position for a job
   */
  getQueuePosition(jobId: string): number {
    const index = this.waitingQueue.indexOf(jobId);
    return index === -1 ? 0 : index + 1;
  }

  private removeFromQueues(jobId: string, userId: string): void {
    // Remove from processing queue
    const processingIndex = this.processingQueue.indexOf(jobId);
    if (processingIndex !== -1) {
      this.processingQueue.splice(processingIndex, 1);
    }

    // Remove from waiting queue
    const waitingIndex = this.waitingQueue.indexOf(jobId);
    if (waitingIndex !== -1) {
      this.waitingQueue.splice(waitingIndex, 1);
    }

    // Remove from user active jobs
    this.userActiveJobs.delete(userId);

    // Remove job data
    this.jobs.delete(jobId);
  }

  private sortWaitingQueue(): void {
    this.waitingQueue.sort((a, b) => {
      const jobA = this.jobs.get(a);
      const jobB = this.jobs.get(b);
      if (!jobA || !jobB) return 0;

      // Sort by priority first (lower = higher priority)
      if (jobA.priority !== jobB.priority) {
        return jobA.priority - jobB.priority;
      }

      // Then by creation time (FIFO within same priority)
      return jobA.createdAt - jobB.createdAt;
    });
  }
}

// Singleton with default configuration
export const aiJobQueue = new AiJobQueueService({
  maxConcurrentJobs: 5,
  maxQueueSize: 50,
  jobTimeout: 120000,
});
