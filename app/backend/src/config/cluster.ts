/**
 * Cluster Entry Point
 * 
 * This module enables multi-process clustering for better CPU utilization.
 * Each worker process runs a separate instance of the application.
 * 
 * Features:
 * - Automatic worker restart on crash
 * - Graceful shutdown handling
 * - Load distribution across CPU cores
 * 
 * Note: Requires Redis for Socket.IO adapter when clustering is enabled!
 */
import cluster from 'cluster';
import os from 'os';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';

export interface ClusterConfig {
  enabled: boolean;
  workers: number;
  restartOnCrash: boolean;
  maxRestarts: number;
  restartWindow: number; // milliseconds
}

// Get cluster configuration from environment
export function getClusterConfig(): ClusterConfig {
  const numCPUs = os.cpus().length;

  return {
    enabled: process.env.CLUSTER_ENABLED === 'true',
    workers: parseInt(process.env.CLUSTER_WORKERS || String(numCPUs)),
    restartOnCrash: process.env.CLUSTER_RESTART_ON_CRASH !== 'false',
    maxRestarts: parseInt(process.env.CLUSTER_MAX_RESTARTS || '10'),
    restartWindow: parseInt(process.env.CLUSTER_RESTART_WINDOW || '60000'),
  };
}

// Track worker restarts for crash loop detection
const workerRestarts: Map<number, number[]> = new Map();

/**
 * Start the cluster if clustering is enabled
 * Returns true if this is the primary process and clustering was started
 * Returns false if this is a worker process or clustering is disabled
 */
export function startCluster(): boolean {
  const config = getClusterConfig();

  // If clustering is disabled, return false to indicate we should run normally
  if (!config.enabled) {
    loggingService.logInfo('Clustering disabled, running in single-process mode');
    return false;
  }

  // If this is a worker process, return false to run the app
  if (cluster.isWorker) {
    loggingService.logInfo(`Worker ${process.pid} started`);
    return false;
  }

  // This is the primary process - fork workers
  loggingService.logInfo('Primary process starting cluster', {
    pid: process.pid,
    workers: config.workers,
    cpus: os.cpus().length,
  });

  // Fork workers
  for (let i = 0; i < config.workers; i++) {
    forkWorker(config);
  }

  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    loggingService.logInfo(`Worker ${worker.process.pid} died`, {
      code,
      signal,
      willRestart: config.restartOnCrash,
    });

    if (config.restartOnCrash && !worker.exitedAfterDisconnect) {
      // Check for crash loop
      if (shouldRestartWorker(worker.id, config)) {
        loggingService.logInfo('Restarting worker after crash');
        forkWorker(config);
      } else {
        loggingService.logError(new Error('Worker in crash loop, not restarting'), {
          workerId: worker.id,
        });
      }
    }
  });

  // Handle graceful shutdown
  const shutdown = (signal: string) => {
    loggingService.logInfo(`Primary received ${signal}, shutting down workers`);

    // Disconnect all workers
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker) {
        worker.disconnect();
      }
    }

    // Force exit after timeout
    setTimeout(() => {
      loggingService.logInfo('Force exiting primary process');
      process.exit(0);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Return true to indicate primary process should not run the app
  return true;
}

function forkWorker(_config: ClusterConfig): void {
  const worker = cluster.fork();

  loggingService.logInfo(`Forked worker ${worker.id}`, {
    pid: worker.process.pid,
  });

  // Initialize restart tracking
  workerRestarts.set(worker.id, []);
}

function shouldRestartWorker(workerId: number, config: ClusterConfig): boolean {
  const now = Date.now();
  const restarts = workerRestarts.get(workerId) || [];

  // Remove restarts outside the window
  const recentRestarts = restarts.filter(time => now - time < config.restartWindow);

  // Add this restart
  recentRestarts.push(now);
  workerRestarts.set(workerId, recentRestarts);

  // Check if we've exceeded max restarts
  return recentRestarts.length <= config.maxRestarts;
}

/**
 * Check if this process is a cluster worker
 */
export function isClusterWorker(): boolean {
  return cluster.isWorker;
}

/**
 * Get worker ID (or 0 if not in cluster mode)
 */
export function getWorkerId(): number {
  return cluster.isWorker ? (cluster.worker?.id ?? 0) : 0;
}
