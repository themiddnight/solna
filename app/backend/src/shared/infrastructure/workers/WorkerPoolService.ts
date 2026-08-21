/**
 * Worker Pool Service
 * Manages a pool of worker threads for CPU-intensive tasks like audio compression
 * Prevents blocking the main event loop during FFmpeg operations
 */
import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { loggingService } from "../logging/LoggingService";

export interface WorkerTask<TInput, TOutput> {
  input: TInput;
  resolve: (output: TOutput) => void;
  reject: (error: Error) => void;
}

export interface WorkerPoolConfig {
  maxWorkers: number;
  workerScript: string;
  taskTimeout: number; // milliseconds
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  taskCount: number;
}

/**
 * Generic Worker Pool for managing worker threads
 */
export class WorkerPoolService<TInput, TOutput> {
  private workers: PooledWorker[] = [];
  private readonly taskQueue: WorkerTask<TInput, TOutput>[] = [];
  private readonly config: WorkerPoolConfig;
  private isShuttingDown = false;

  // Metrics
  private totalTasksProcessed = 0;
  private totalTasksFailed = 0;
  private totalProcessingTime = 0;

  constructor(config: Partial<WorkerPoolConfig> & { workerScript: string }) {
    this.config = {
      maxWorkers: config.maxWorkers ?? Math.max(2, Math.floor(os.cpus().length / 2)),
      workerScript: config.workerScript,
      taskTimeout: config.taskTimeout ?? 60000, // 1 minute default
    };

    loggingService.logInfo('WorkerPoolService initialized', {
      maxWorkers: this.config.maxWorkers,
      workerScript: this.config.workerScript,
    });
  }

  /**
   * Execute a task in a worker thread
   */
  async execute(input: TInput): Promise<TOutput> {
    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    return new Promise<TOutput>((resolve, reject) => {
      const task: WorkerTask<TInput, TOutput> = { input, resolve, reject };
      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeAll(inputs: TInput[]): Promise<TOutput[]> {
    return Promise.all(inputs.map(input => this.execute(input)));
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    activeWorkers: number;
    busyWorkers: number;
    queuedTasks: number;
    totalProcessed: number;
    totalFailed: number;
    avgProcessingTime: number;
  } {
    return {
      activeWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queuedTasks: this.taskQueue.length,
      totalProcessed: this.totalTasksProcessed,
      totalFailed: this.totalTasksFailed,
      avgProcessingTime: this.totalTasksProcessed > 0
        ? this.totalProcessingTime / this.totalTasksProcessed
        : 0,
    };
  }

  /**
   * Gracefully shutdown the worker pool
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    loggingService.logInfo('WorkerPoolService shutting down', {
      activeWorkers: this.workers.length,
      queuedTasks: this.taskQueue.length,
    });

    // Reject all queued tasks
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        task.reject(new Error('Worker pool is shutting down'));
      }
    }

    // Terminate all workers
    await Promise.all(
      this.workers.map(w => w.worker.terminate())
    );

    this.workers = [];
  }

  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    // Try to find an available worker
    let worker = this.workers.find(w => !w.busy);

    // If no available worker and we can create more, create one
    if (!worker && this.workers.length < this.config.maxWorkers) {
      worker = this.createWorker();
      if (worker) {
        this.workers.push(worker);
      }
    }

    // If we have an available worker, assign the next task
    if (worker && !worker.busy) {
      const task = this.taskQueue.shift();
      if (task) {
        this.runTask(worker, task);
      }
    }
  }

  private createWorker(): PooledWorker | undefined {
    try {
      // Use JavaScript worker file for maximum compatibility
      const worker = new Worker(this.config.workerScript);

      const pooledWorker: PooledWorker = {
        worker,
        busy: false,
        taskCount: 0,
      };

      worker.on('error', (error) => {
        loggingService.logError(error, { context: 'WorkerPoolService', event: 'worker_error' });
        this.removeWorker(pooledWorker);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          loggingService.logInfo('Worker exited with error code', { code });
        }
        this.removeWorker(pooledWorker);
      });

      return pooledWorker;
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'WorkerPoolService',
        event: 'worker_creation_failed',
      });
      return undefined;
    }
  }

  private runTask(pooledWorker: PooledWorker, task: WorkerTask<TInput, TOutput>): void {
    pooledWorker.busy = true;
    pooledWorker.taskCount++;
    const startTime = Date.now();

    // Set up timeout
    const timeoutId = setTimeout(() => {
      void pooledWorker.worker.terminate();
      this.totalTasksFailed++;
      task.reject(new Error(`Task timed out after ${this.config.taskTimeout}ms`));
    }, this.config.taskTimeout);

    // Handle message from worker
    const messageHandler = (result: TOutput) => {
      clearTimeout(timeoutId);
      pooledWorker.busy = false;

      const processingTime = Date.now() - startTime;
      this.totalProcessingTime += processingTime;
      this.totalTasksProcessed++;

      task.resolve(result);

      // Process next task in queue
      this.processQueue();
    };

    // Handle error from worker
    const errorHandler = (error: Error) => {
      clearTimeout(timeoutId);
      pooledWorker.busy = false;
      this.totalTasksFailed++;

      task.reject(error);

      // Process next task in queue
      this.processQueue();
    };

    // Set up one-time listeners
    pooledWorker.worker.once('message', messageHandler);
    pooledWorker.worker.once('error', errorHandler);

    // Send task to worker
    pooledWorker.worker.postMessage(task.input);
  }

  private removeWorker(pooledWorker: PooledWorker): void {
    const index = this.workers.indexOf(pooledWorker);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }
  }
}

// Singleton instance for audio compression
let audioCompressionPool: WorkerPoolService<unknown, unknown> | null = null;

export function getAudioCompressionPool(): WorkerPoolService<unknown, unknown> {
  if (!audioCompressionPool) {
    // Use JavaScript worker file for better Worker Threads compatibility
    // Worker is in src/workers/, not src/shared/infrastructure/workers/
    const workerPath = path.join(__dirname, '../../../workers/audioCompressionWorker.js');

    audioCompressionPool = new WorkerPoolService({
      workerScript: workerPath,
      maxWorkers: Math.max(2, Math.floor(os.cpus().length / 2)),
      taskTimeout: 120000, // 2 minutes for audio processing
    });
  }
  return audioCompressionPool;
}

export function shutdownAudioCompressionPool(): Promise<void> {
  if (audioCompressionPool) {
    return audioCompressionPool.shutdown();
  }
  return Promise.resolve();
}
