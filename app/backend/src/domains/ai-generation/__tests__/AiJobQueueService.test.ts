import { AiJobQueueService } from '../domain/services/AiJobQueueService';
import { loggingService } from '../../../shared/infrastructure/logging/LoggingService';

jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

describe('AiJobQueueService', () => {
  let queueService: AiJobQueueService;
  const mockUserId1 = 'user-1';
  const mockUserId2 = 'user-2';

  beforeEach(() => {
    jest.clearAllMocks();
    queueService = new AiJobQueueService({
      maxConcurrentJobs: 2,
      maxQueueSize: 10,
      jobTimeout: 5000,
    });
  });

  describe('createJob', () => {
    it('should create a new job successfully', () => {
      const job = queueService.createJob(mockUserId1, 'openai', 5);

      expect(job).toMatchObject({
        userId: mockUserId1,
        provider: 'openai',
        status: 'queued',
        priority: 5,
      });
      expect(job.id).toBeDefined();
      expect(job.abortController).toBeInstanceOf(AbortController);
      expect(loggingService.logInfo).toHaveBeenCalledWith(
        'AI job created',
        expect.any(Object)
      );
    });

    it('should throw error if user already has an active job', () => {
      queueService.createJob(mockUserId1, 'openai');

      expect(() => {
        queueService.createJob(mockUserId1, 'gemini');
      }).toThrow('You already have a generation in progress');
    });

    it('should throw error if queue is full', () => {
      // Fill the queue
      for (let i = 0; i < 10; i++) {
        queueService.createJob(`user-${i}`, 'openai');
      }

      expect(() => {
        queueService.createJob('user-11', 'openai');
      }).toThrow('AI generation queue is full');
    });

    it('should sort jobs by priority', () => {
      const job1 = queueService.createJob(mockUserId1, 'openai', 10);
      const job2 = queueService.createJob(mockUserId2, 'openai', 1);

      const stats = queueService.getStats();
      expect(stats.queuedJobs).toBe(2);

      // Higher priority job should be processed first
      expect(queueService.getQueuePosition(job2.id)).toBe(1);
      expect(queueService.getQueuePosition(job1.id)).toBe(2);
    });
  });

  describe('canStartProcessing', () => {
    it('should return true when under concurrency limit', () => {
      queueService.createJob(mockUserId1, 'openai');
      expect(queueService.canStartProcessing()).toBe(true);
    });

    it('should return false when at concurrency limit', () => {
      const job1 = queueService.createJob(mockUserId1, 'openai');
      const job2 = queueService.createJob(mockUserId2, 'openai');

      queueService.startProcessing(job1.id);
      queueService.startProcessing(job2.id);

      expect(queueService.canStartProcessing()).toBe(false);
    });

    it('should return false when no jobs in queue', () => {
      expect(queueService.canStartProcessing()).toBe(false);
    });
  });

  describe('startProcessing', () => {
    it('should start processing a job', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      const didStart = queueService.startProcessing(job.id);

      expect(didStart).toBe(true);
      expect(queueService.getJobById(job.id)?.status).toBe('processing');
      expect(queueService.getJobById(job.id)?.startedAt).toBeDefined();
      expect(loggingService.logInfo).toHaveBeenCalledWith(
        'AI job started processing',
        expect.any(Object)
      );
    });

    it('should not start processing when at concurrency limit', () => {
      const job1 = queueService.createJob(mockUserId1, 'openai');
      const job2 = queueService.createJob(mockUserId2, 'openai');
      const job3 = queueService.createJob('user-3', 'openai');

      queueService.startProcessing(job1.id);
      queueService.startProcessing(job2.id);
      const didStart = queueService.startProcessing(job3.id);

      expect(didStart).toBe(false);
      expect(queueService.getJobById(job3.id)?.status).toBe('queued');
    });

    it('should return false for non-existent job', () => {
      const didStart = queueService.startProcessing('non-existent-id');
      expect(didStart).toBe(false);
    });
  });

  describe('waitForSlot', () => {
    it('should resolve immediately when slot is available', async () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      await expect(queueService.waitForSlot(job.id)).resolves.toBeUndefined();
    });

    it('should wait for slot to become available', async () => {
      const job1 = queueService.createJob(mockUserId1, 'openai');
      const job2 = queueService.createJob(mockUserId2, 'openai');
      const job3 = queueService.createJob('user-3', 'openai');

      queueService.startProcessing(job1.id);
      queueService.startProcessing(job2.id);

      const waitPromise = queueService.waitForSlot(job3.id);

      // Complete job1 to free up a slot
      setTimeout(() => {
        queueService.completeJob(job1.id, { success: true });
      }, 200);

      await expect(waitPromise).resolves.toBeUndefined();
    }, 10000);

    it('should reject if job is canceled while waiting', async () => {
      const job1 = queueService.createJob(mockUserId1, 'openai');
      const job2 = queueService.createJob(mockUserId2, 'openai');
      const job3 = queueService.createJob('user-3', 'openai');

      queueService.startProcessing(job1.id);
      queueService.startProcessing(job2.id);

      const waitPromise = queueService.waitForSlot(job3.id);

      setTimeout(() => {
        queueService.cancelJob('user-3');
      }, 100);

      await expect(waitPromise).rejects.toThrow('Job canceled');
    });

    it('should reject for non-existent job', async () => {
      await expect(queueService.waitForSlot('non-existent')).rejects.toThrow('Job not found');
    });
  });

  describe('completeJob', () => {
    it('should mark job as completed and remove from queues', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      queueService.startProcessing(job.id);

      const result = { notes: [], usage: {} };
      queueService.completeJob(job.id, result);

      expect(queueService.getJobById(job.id)).toBeUndefined();
      expect(queueService.getJob(mockUserId1)).toBeUndefined();
      expect(loggingService.logInfo).toHaveBeenCalledWith(
        'AI job completed',
        expect.any(Object)
      );
    });

    it('should update statistics', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      queueService.startProcessing(job.id);
      queueService.completeJob(job.id, {});

      const stats = queueService.getStats();
      expect(stats.totalJobs).toBe(1);
    });
  });

  describe('failJob', () => {
    it('should mark job as failed and remove from queues', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      queueService.startProcessing(job.id);

      queueService.failJob(job.id, 'API error');

      expect(queueService.getJobById(job.id)).toBeUndefined();
      expect(queueService.getJob(mockUserId1)).toBeUndefined();
      expect(loggingService.logInfo).toHaveBeenCalledWith(
        'AI job failed',
        expect.objectContaining({ error: 'API error' })
      );
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job and abort controller', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      const abortSpy = jest.spyOn(job.abortController!, 'abort');

      const didCancel = queueService.cancelJob(mockUserId1);

      expect(didCancel).toBe(true);
      expect(abortSpy).toHaveBeenCalled();
      expect(queueService.getJob(mockUserId1)).toBeUndefined();
      expect(loggingService.logInfo).toHaveBeenCalledWith(
        'AI job canceled',
        expect.any(Object)
      );
    });

    it('should return false for non-existent user job', () => {
      const didCancel = queueService.cancelJob('non-existent-user');
      expect(didCancel).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return accurate queue statistics', () => {
      const job1 = queueService.createJob(mockUserId1, 'openai');
      const _job2 = queueService.createJob(mockUserId2, 'openai');

      queueService.startProcessing(job1.id);

      const stats = queueService.getStats();

      expect(stats).toMatchObject({
        totalJobs: 2,
        processingJobs: 1,
        queuedJobs: 1,
        maxConcurrent: 2,
      });
    });

    it('should calculate average times correctly', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      queueService.startProcessing(job.id);
      queueService.completeJob(job.id, {});

      const stats = queueService.getStats();

      expect(stats.avgWaitTime).toBeGreaterThanOrEqual(0);
      expect(stats.avgProcessingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getQueuePosition', () => {
    it('should return correct queue position', () => {
      const job1 = queueService.createJob(mockUserId1, 'openai', 10);
      const job2 = queueService.createJob(mockUserId2, 'openai', 1);

      expect(queueService.getQueuePosition(job2.id)).toBe(1);
      expect(queueService.getQueuePosition(job1.id)).toBe(2);
    });

    it('should return 0 for non-queued job', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      queueService.startProcessing(job.id);

      expect(queueService.getQueuePosition(job.id)).toBe(0);
    });
  });

  describe('getJob', () => {
    it('should return job for user', () => {
      const job = queueService.createJob(mockUserId1, 'openai');
      const retrieved = queueService.getJob(mockUserId1);

      expect(retrieved?.id).toBe(job.id);
    });

    it('should return undefined for user without job', () => {
      expect(queueService.getJob('non-existent-user')).toBeUndefined();
    });
  });

  describe('getNextJob', () => {
    it('should return next job respecting priority', () => {
      queueService.createJob(mockUserId1, 'openai', 10);
      const highPriorityJob = queueService.createJob(mockUserId2, 'openai', 1);

      const next = queueService.getNextJob();

      expect(next?.id).toBe(highPriorityJob.id);
    });

    it('should return null when at concurrency limit', () => {
      const job1 = queueService.createJob(mockUserId1, 'openai');
      const job2 = queueService.createJob(mockUserId2, 'openai');
      queueService.createJob('user-3', 'openai');

      queueService.startProcessing(job1.id);
      queueService.startProcessing(job2.id);

      expect(queueService.getNextJob()).toBeNull();
    });

    it('should return null when queue is empty', () => {
      expect(queueService.getNextJob()).toBeNull();
    });
  });
});
