/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Unit Tests for AiJobQueueService
 * Tests the AI request queue with concurrency control
 */
import { AiJobQueueService } from '@/domains/ai-generation/domain/services/AiJobQueueService';

// Mock LoggingService
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

describe('AiJobQueueService', () => {
  let queue: AiJobQueueService;

  beforeEach(() => {
    queue = new AiJobQueueService({
      maxConcurrentJobs: 2,
      maxQueueSize: 5,
      jobTimeout: 5000,
    });
  });

  describe('createJob', () => {
    it('should create a new job for a user', () => {
      const job = queue.createJob('user1', 'gemini');

      expect(job).toBeDefined();
      expect(job.userId).toBe('user1');
      expect(job.provider).toBe('gemini');
      expect(job.status).toBe('queued');
      expect(job.id).toBeDefined();
    });

    it('should throw if user already has an active job', () => {
      queue.createJob('user1', 'gemini');

      expect(() => queue.createJob('user1', 'gemini')).toThrow(
        'You already have a generation in progress'
      );
    });

    it('should allow different users to create jobs', () => {
      const job1 = queue.createJob('user1', 'gemini');
      const job2 = queue.createJob('user2', 'gemini');

      expect(job1.userId).toBe('user1');
      expect(job2.userId).toBe('user2');
    });

    it('should throw if queue is full', () => {
      // Fill up the queue
      for (let i = 0; i < 5; i++) {
        queue.createJob(`user${i}`, 'gemini');
      }

      expect(() => queue.createJob('user99', 'gemini')).toThrow(
        'AI generation queue is full'
      );
    });
  });

  describe('startProcessing', () => {
    it('should start processing a job', () => {
      const job = queue.createJob('user1', 'gemini');
      const hasStarted = queue.startProcessing(job.id);

      expect(hasStarted).toBe(true);
      expect(queue.getJob('user1')?.status).toBe('processing');
    });

    it('should respect concurrency limit', () => {
      const job1 = queue.createJob('user1', 'gemini');
      const job2 = queue.createJob('user2', 'gemini');
      const job3 = queue.createJob('user3', 'gemini');

      queue.startProcessing(job1.id);
      queue.startProcessing(job2.id);
      const started3 = queue.startProcessing(job3.id);

      expect(started3).toBe(false); // Should fail due to limit
    });
  });

  describe('completeJob', () => {
    it('should complete a job and remove from queue', () => {
      const job = queue.createJob('user1', 'gemini');
      queue.startProcessing(job.id);
      queue.completeJob(job.id, { notes: [] });

      expect(queue.getJob('user1')).toBeUndefined();
    });
  });

  describe('cancelJob', () => {
    it('should cancel an active job', () => {
      queue.createJob('user1', 'gemini');
      const wasCanceled = queue.cancelJob('user1');

      expect(wasCanceled).toBe(true);
      expect(queue.getJob('user1')).toBeUndefined();
    });

    it('should return false if no active job exists', () => {
      const wasCanceled = queue.cancelJob('nonexistent');
      expect(wasCanceled).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      queue.createJob('user1', 'gemini');
      queue.createJob('user2', 'gemini');

      const stats = queue.getStats();

      expect(stats.totalJobs).toBe(2);
      expect(stats.queuedJobs).toBe(2);
      expect(stats.processingJobs).toBe(0);
      expect(stats.maxConcurrent).toBe(2);
    });
  });

  describe('getQueuePosition', () => {
    it('should return correct queue position', () => {
      const job1 = queue.createJob('user1', 'gemini');
      const job2 = queue.createJob('user2', 'gemini');

      expect(queue.getQueuePosition(job1.id)).toBe(1);
      expect(queue.getQueuePosition(job2.id)).toBe(2);
    });

    it('should return 0 for non-queued jobs', () => {
      const job = queue.createJob('user1', 'gemini');
      queue.startProcessing(job.id);

      expect(queue.getQueuePosition(job.id)).toBe(0);
    });
  });

  describe('priority queue', () => {
    it('should process higher priority jobs first', () => {
      // Create jobs with different priorities
      const lowPriority = queue.createJob('user1', 'gemini', 10);
      const highPriority = queue.createJob('user2', 'gemini', 1);

      // High priority should be first in queue
      expect(queue.getQueuePosition(highPriority.id)).toBe(1);
      expect(queue.getQueuePosition(lowPriority.id)).toBe(2);
    });
  });
});
