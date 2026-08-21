/**
 * Redis Configuration for Clustering Support
 * 
 * This module provides Redis client configuration for:
 * - Socket.IO adapter (for multi-process message passing)
 * - Session storage (for shared state across workers)
 * - Caching (for room state)
 * 
 * Features robust error handling to prevent process crashes on connection issues (ECONNRESET, etc.)
 */
import { createClient } from 'redis';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { isRecoverableConnectionError } from '../shared/utils/errorUtils';

// Create a type alias for the Redis client
type RedisClient = ReturnType<typeof createClient>;

export interface RedisConfig {
  url: string;
  retryDelay: number;
  maxRetryDelay: number;
  // Sentinel configuration for High Availability.
  // NOTE: The 'redis' package does not support Sentinel natively.
  // For full Sentinel / High Availability support, consider migrating to 'ioredis'.
  sentinels?: Array<{ host: string; port: number }> | undefined;
  masterName?: string | undefined;
  password?: string | undefined;
}

// Track connection state for recovery
let isClientConnecting = false;
let isSubscriberConnecting = false;
let clientReconnectTimer: NodeJS.Timeout | null = null;
let subscriberReconnectTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

// Get Redis configuration from environment
export function getRedisConfig(): RedisConfig {
  // Parse Sentinel configuration if provided
  const sentinelsEnv = process.env.REDIS_SENTINELS;
  const sentinels = sentinelsEnv
    ? sentinelsEnv.split(',').map(s => {
        const [host, port] = s.trim().split(':');
        return { host: host || '', port: parseInt(port || '26379') };
      }).filter(s => s.host !== '')
    : undefined;

  return {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '1000'),
    maxRetryDelay: parseInt(process.env.REDIS_MAX_RETRY_DELAY || '30000'),
    sentinels: sentinels && sentinels.length > 0 ? sentinels : undefined,
    masterName: process.env.REDIS_MASTER_NAME,
    password: process.env.REDIS_PASSWORD,
  };
}

// Redis client singleton
let redisClient: RedisClient | null = null;
let redisSubscriber: RedisClient | null = null;


/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoff(retries: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, retries), maxDelay);
  // Add jitter (±20%) to prevent thundering herd
  const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5) * 2;
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Create a Redis client with robust error handling
 * Supports both standalone and Sentinel modes
 */
function createRobustClient(config: RedisConfig, clientName: string): RedisClient {
  // Determine if using Sentinel or standalone mode
  const shouldUseSentinel = config.sentinels != null && config.sentinels.length > 0 && config.masterName != null;

  if (shouldUseSentinel) {
    loggingService.logInfo(`${clientName}: Using Redis Sentinel mode`, {
      masterName: config.masterName,
      sentinelCount: config.sentinels!.length,
    });
  } else {
    loggingService.logInfo(`${clientName}: Using Redis standalone mode`);
  }

  const clientOptions: Record<string, unknown> = {
    socket: {
      reconnectStrategy: (retries: number) => {
        // Allow unlimited reconnection attempts for better resilience
        const delay = calculateBackoff(retries, config.retryDelay, config.maxRetryDelay);

        if (retries % 10 === 0) {
          loggingService.logInfo(`${clientName} reconnecting`, {
            retries,
            nextRetryInMs: delay,
          });
        }

        return delay;
      },
      connectTimeout: 10000, // 10 second connection timeout
    },
  };

  // Add Sentinel or standalone configuration
  if (shouldUseSentinel) {
    // Note: redis package doesn't support Sentinel directly
    // For production Sentinel support, consider using ioredis package
    // For now, we'll use standalone mode with a note
    loggingService.logInfo(
      `${clientName}: Sentinel config detected but using standalone. ` +
      `For full Sentinel support, consider migrating to ioredis package.`
    );
    clientOptions.url = config.url;
    if (config.password) {
      clientOptions.password = config.password;
    }
  } else {
    clientOptions.url = config.url;
    if (config.password) {
      clientOptions.password = config.password;
    }
  }

  const client = createClient(clientOptions);

  // Handle errors without throwing - prevents unhandled rejections
  client.on('error', (err: Error) => {
    if (isRecoverableConnectionError(err)) {
      loggingService.logInfo(`${clientName} connection issue (will auto-recover)`, {
        errorCode: (err as NodeJS.ErrnoException).code,
        message: err.message,
      });
    } else {
      loggingService.logError(err, { context: clientName });
    }
  });

  client.on('connect', () => {
    loggingService.logInfo(`${clientName} connected`);
  });

  client.on('ready', () => {
    loggingService.logInfo(`${clientName} ready for commands`);
  });

  client.on('reconnecting', () => {
    loggingService.logInfo(`${clientName} reconnecting`);
  });

  client.on('end', () => {
    loggingService.logInfo(`${clientName} connection ended`);
  });

  return client;
}

/**
 * Get or create Redis client for pub/sub
 */
export async function getRedisClient(): Promise<RedisClient> {
  const config = getRedisConfig();

  // Return existing open client
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // Prevent concurrent connection attempts
  if (isClientConnecting) {
    // Wait for ongoing connection to complete
    await new Promise<void>((resolve, reject) => {
      let checkInterval: NodeJS.Timeout | null = null;
      checkInterval = setInterval(() => {
        if (isShuttingDown) {
          if (checkInterval) clearInterval(checkInterval);
          reject(new Error('Redis client connection aborted: shutting down'));
          return;
        }
        if (!isClientConnecting && redisClient?.isOpen) {
          if (checkInterval) clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval!);
        resolve();
      }, 10000);
    });


    if (redisClient?.isOpen) {
      return redisClient;
    }
  }

  // Clear any pending reconnect timer
  if (clientReconnectTimer) {
    clearTimeout(clientReconnectTimer);
    clientReconnectTimer = null;
  }

  isClientConnecting = true;

  try {
    isShuttingDown = false;
    redisClient = createRobustClient(config, 'RedisClient');
    await redisClient.connect();
    return redisClient;
  } catch (error) {
    loggingService.logError(error as Error, { context: 'RedisClient connection failed' });
    throw error;
  } finally {
    isClientConnecting = false;
  }
}

/**
 * Get or create Redis subscriber client for Socket.IO adapter
 */
export async function getRedisSubscriber(): Promise<RedisClient> {
  const config = getRedisConfig();

  // Return existing open subscriber
  if (redisSubscriber && redisSubscriber.isOpen) {
    return redisSubscriber;
  }

  // Prevent concurrent connection attempts
  if (isSubscriberConnecting) {
    await new Promise<void>((resolve, reject) => {
      let checkInterval: NodeJS.Timeout | null = null;
      checkInterval = setInterval(() => {
        if (isShuttingDown) {
          if (checkInterval) clearInterval(checkInterval);
          reject(new Error('Redis subscriber connection aborted: shutting down'));
          return;
        }
        if (!isSubscriberConnecting && redisSubscriber?.isOpen) {
          if (checkInterval) clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval!);
        resolve();
      }, 10000);
    });


    if (redisSubscriber?.isOpen) {
      return redisSubscriber;
    }
  }

  // Clear any pending reconnect timer
  if (subscriberReconnectTimer) {
    clearTimeout(subscriberReconnectTimer);
    subscriberReconnectTimer = null;
  }

  isSubscriberConnecting = true;

  try {
    isShuttingDown = false;
    redisSubscriber = createRobustClient(config, 'RedisSubscriber');
    await redisSubscriber.connect();
    return redisSubscriber;
  } catch (error) {
    loggingService.logError(error as Error, { context: 'RedisSubscriber connection failed' });
    throw error;
  } finally {
    isSubscriberConnecting = false;
  }
}

/**
 * Check if Redis is configured and available
 */
export async function isRedisAvailable(): Promise<boolean> {
  if (process.env.REDIS_ENABLED === 'false') {
    return false;
  }
  try {
    const client = await getRedisClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset client references when they become disconnected
 * This allows getRedisClient/getRedisSubscriber to create new connections
 */
export function resetRedisClients(): void {
  if (redisClient && !redisClient.isOpen) {
    redisClient = null;
  }
  if (redisSubscriber && !redisSubscriber.isOpen) {
    redisSubscriber = null;
  }
}

/**
 * Gracefully close Redis connections
 */
export async function closeRedisConnections(): Promise<void> {
  isShuttingDown = true;
  // Clear any pending timers
  if (clientReconnectTimer) {
    clearTimeout(clientReconnectTimer);
    clientReconnectTimer = null;
  }
  if (subscriberReconnectTimer) {
    clearTimeout(subscriberReconnectTimer);
    subscriberReconnectTimer = null;
  }

  const closePromises: Promise<void>[] = [];

  if (redisClient) {
    if (redisClient.isOpen) {
      closePromises.push(
        redisClient.quit().catch((err: Error) => {
          loggingService.logInfo('Redis client quit error (ignored)', { error: err.message });
        }).then(() => {
          loggingService.logInfo('Redis client closed');
        })
      );
    }
    redisClient = null;
  }

  if (redisSubscriber) {
    if (redisSubscriber.isOpen) {
      closePromises.push(
        redisSubscriber.quit().catch((err: Error) => {
          loggingService.logInfo('Redis subscriber quit error (ignored)', { error: err.message });
        }).then(() => {
          loggingService.logInfo('Redis subscriber closed');
        })
      );
    }
    redisSubscriber = null;
  }

  await Promise.all(closePromises);
}
