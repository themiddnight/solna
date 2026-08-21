/**
 * Redis State Service
 * 
 * Generic Redis state management for shared state across workers.
 * Provides a consistent interface for storing and retrieving state
 * with automatic JSON serialization and fallback handling.
 */
import { getRedisClient, resetRedisClients } from '../../../config/redis';
import { loggingService } from '../logging/LoggingService';
import { v4 as uuidv4 } from 'uuid';

// Type alias for Redis client (matches the return type of getRedisClient)
type RedisClient = Awaited<ReturnType<typeof getRedisClient>>;

/**
 * Pipeline operation tuple: [command, ...args]
 */
export type PipelineOperation =
  | ['set', string, unknown]
  | ['setEx', string, number, unknown]
  | ['get', string]
  | ['del', string]
  | ['hset', string, string, unknown]
  | ['hget', string, string]
  | ['hdel', string, string]
  | ['sadd', string, string]
  | ['srem', string, string]
  | ['incr', string]
  | ['expire', string, number];

/**
 * RedisStateService - Centralized Redis operations for state management
 * 
 * Features robust error handling to prevent process crashes on connection issues.
 */
export class RedisStateService {
  private static instance: RedisStateService | undefined;
  private client: RedisClient | null = null;
  private isConnected = false;
  private isConnecting = false;
  private isHealthy = true; // Track Redis health for monitoring

  // Key prefix for namespacing
  private readonly KEY_PREFIX = 'collab:';

  private constructor() { }

  static getInstance(): RedisStateService {
    if (!RedisStateService.instance) {
      RedisStateService.instance = new RedisStateService();
    }
    return RedisStateService.instance;
  }

  /**
   * Check if Redis is healthy and available
   * Used for monitoring and health checks
   */
  getHealthStatus(): boolean {
    return this.isHealthy;
  }

  /**
   * Disconnect Redis client and cleanup resources
   * Useful for testing and graceful shutdown
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      if (this.client.isOpen) {
        await this.client.disconnect();
      }
      this.client = null;
      this.isConnected = false;
    }
  }

  // ============================================
  // Basic Key-Value Operations
  // ============================================

  /**
   * Get value by key with JSON deserialization
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const value = await client.get(this.buildKey(key));

      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.isHealthy = false;
      loggingService.logError(error as Error, {
        context: 'RedisStateService.get',
        key,
      });
      return null;
    }
  }

  /**
   * Set value with optional TTL
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    try {
      const client = await this.getClient();
      const serialized = JSON.stringify(value);

      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await client.setEx(this.buildKey(key), ttlSeconds, serialized);
      } else {
        await client.set(this.buildKey(key), serialized);
      }

      this.isHealthy = true;
      return true;
    } catch (error) {
      this.isHealthy = false;
      loggingService.logError(error as Error, {
        context: 'RedisStateService.set',
        key,
      });
      return false;
    }
  }

  /**
   * Delete key
   */
  async delete(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.del(this.buildKey(key));
      return result > 0;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.delete',
        key,
      });
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.exists(this.buildKey(key));
      return result > 0;
    } catch {
      return false;
    }
  }

  // ============================================
  // Hash Operations (for complex objects)
  // ============================================

  /**
   * Get field from hash
   */
  async hget<T>(hash: string, field: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const value = await client.hGet(this.buildKey(hash), field);

      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.hget',
        hash,
        field,
      });
      return null;
    }
  }

  /**
   * Get multiple hash fields in one Redis round trip.
   */
  async hgetMany<T>(hash: string, fields: string[]): Promise<Map<string, T>> {
    const values = new Map<string, T>();
    if (fields.length === 0) return values;

    try {
      const client = await this.getClient();
      const rawValues = await client.hmGet(this.buildKey(hash), fields);

      rawValues.forEach((value, index) => {
        if (!value) return;
        const field = fields[index];
        if (!field) return;

        try {
          values.set(field, JSON.parse(value) as T);
        } catch {
          // Skip invalid JSON for parity with hgetall.
        }
      });

      return values;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.hgetMany',
        hash,
        fieldCount: fields.length,
      });
      return values;
    }
  }

  /**
   * Set field in hash
   */
  async hset<T>(hash: string, field: string, value: T): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.hSet(this.buildKey(hash), field, JSON.stringify(value));
      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.hset',
        hash,
        field,
      });
      return false;
    }
  }

  /**
   * Get all fields from hash
   */
  async hgetall<T>(hash: string): Promise<Map<string, T>> {
    try {
      const client = await this.getClient();
      const result = await client.hGetAll(this.buildKey(hash));

      const map = new Map<string, T>();
      for (const [field, value] of Object.entries(result)) {
        try {
          map.set(field, JSON.parse(value as string) as T);
        } catch {
          // Skip invalid JSON
        }
      }

      return map;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.hgetall',
        hash,
      });
      return new Map();
    }
  }

  /**
   * Delete field from hash
   */
  async hdel(hash: string, field: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.hDel(this.buildKey(hash), field);
      return result > 0;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.hdel',
        hash,
        field,
      });
      return false;
    }
  }

  /**
   * Get hash length (number of fields)
   */
  async hlen(hash: string): Promise<number> {
    try {
      const client = await this.getClient();
      return await client.hLen(this.buildKey(hash));
    } catch {
      return 0;
    }
  }

  // ============================================
  // Set Operations (for sessions/lists)
  // ============================================

  /**
   * Add member to set
   */
  async sadd(key: string, member: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.sAdd(this.buildKey(key), member);
      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.sadd',
        key,
        member,
      });
      return false;
    }
  }

  /**
   * Get all members from set
   */
  async smembers(key: string, throwOnError = false): Promise<string[]> {
    try {
      const client = await this.getClient();
      const result = await client.sMembers(this.buildKey(key));
      this.isHealthy = true;
      return result;
    } catch (error) {
      this.isHealthy = false;
      loggingService.logError(error as Error, {
        context: 'RedisStateService.smembers',
        key,
      });
      if (throwOnError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Remove member from set
   */
  async srem(key: string, member: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.sRem(this.buildKey(key), member);
      return result > 0;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.srem',
        key,
        member,
      });
      return false;
    }
  }

  /**
   * Check if member exists in set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.sIsMember(this.buildKey(key), member);
      return Boolean(result);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.sismember',
        key,
        member,
      });
      return false;
    }
  }

  /**
   * Get set cardinality (number of members)
   */
  async scard(key: string): Promise<number> {
    try {
      const client = await this.getClient();
      return await client.sCard(this.buildKey(key));
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.scard',
        key,
      });
      return 0;
    }
  }

  // ============================================
  // Utility Operations
  // ============================================

  /**
   * Delete a key
   */
  async del(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.del(this.buildKey(key));
      return result > 0;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.del',
        key,
      });
      return false;
    }
  }

  /**
   * Delete all keys matching pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const client = await this.getClient();
      const keys = await client.keys(this.buildKey(pattern));

      if (keys.length === 0) return 0;

      const result = await client.del(keys);
      return result;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.deletePattern',
        pattern,
      });
      return 0;
    }
  }

  /**
   * Set TTL on existing key
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.expire(this.buildKey(key), ttlSeconds);
      // Redis expire returns 1 for isSuccess, 0 for key doesn't exist
      return Boolean(result);
    } catch {
      return false;
    }
  }

  /**
   * Execute multiple Redis commands in a single network round-trip
   * Significantly reduces latency for bulk operations
   * 
   * ⚠️ WARNING (ISSUE-65): MULTI/EXEC provides atomicity within a single connection
   * but does NOT provide distributed mutual exclusion across multiple servers.
   * For critical read-modify-write operations that require distributed locking,
   * use executePipelineWithLock() instead or wrap with executeWithLock().
   * 
   * Safe use cases:
   * - Batching independent writes (no read-modify-write)
   * - Operations already protected by executeWithLock()
   * 
   * Unsafe use cases (use executePipelineWithLock instead):
   * - Concurrent ownership changes
   * - Concurrent membership updates
   * - Any read-modify-write without external locking
   * 
   * @param operations - Array of [command, ...args] tuples
   * @returns Array of results in the same order as operations
   */
  async executePipeline<T>(operations: PipelineOperation[]): Promise<(T | null)[]> {
    if (operations.length === 0) return [];

    try {
      const client = await this.getClient();
      const multi = client.multi();

      for (const op of operations) {
        const [command, ...args] = op;

        switch (command) {
          case 'set':
            multi.set(this.buildKey(args[0] as string), JSON.stringify(args[1]));
            break;
          case 'setEx':
            multi.setEx(
              this.buildKey(args[0] as string),
              args[1] as number,
              JSON.stringify(args[2])
            );
            break;
          case 'get':
            multi.get(this.buildKey(args[0] as string));
            break;
          case 'del':
            multi.del(this.buildKey(args[0] as string));
            break;
          case 'hset':
            multi.hSet(
              this.buildKey(args[0] as string),
              args[1] as string,
              JSON.stringify(args[2])
            );
            break;
          case 'hget':
            multi.hGet(this.buildKey(args[0] as string), args[1] as string);
            break;
          case 'hdel':
            multi.hDel(this.buildKey(args[0] as string), args[1] as string);
            break;
          case 'sadd':
            multi.sAdd(this.buildKey(args[0] as string), args[1] as string);
            break;
          case 'srem':
            multi.sRem(this.buildKey(args[0] as string), args[1] as string);
            break;
          case 'incr':
            multi.incr(this.buildKey(args[0] as string));
            break;
          case 'expire':
            multi.expire(this.buildKey(args[0] as string), args[1] as number);
            break;
          default:
            loggingService.logInfo('Unknown pipeline command', { command });
        }
      }

      const results = await multi.exec();
      return results as (T | null)[];
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.executePipeline',
        operationCount: operations.length,
      });
      return operations.map(() => null);
    }
  }

  // ============================================
  // Atomic Counter Operations (for Rate Limiting)
  // ============================================

  /**
   * Increment counter atomically - useful for rate limiting
   * @returns New value after increment, or null on error
   */
  async incr(key: string): Promise<number | null> {
    try {
      const client = await this.getClient();
      return await client.incr(this.buildKey(key));
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.incr',
        key,
      });
      return null;
    }
  }

  /**
   * Execute a Lua script atomically on Redis
   * Keys are automatically prefixed. Use KEYS[1], KEYS[2], ... in the script.
   * @param script - Lua script string
   * @param keys - Array of key names (will be prefixed)
   * @param args - Array of additional arguments
   * @returns Script result
   */
  async eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T | null> {
    try {
      const client = await this.getClient();
      const prefixedKeys = keys.map(k => this.buildKey(k));
      const result = await client.eval(script, {
        keys: prefixedKeys,
        arguments: args.map(String),
      });
      return result as T;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.eval',
        keyCount: keys.length,
      });
      return null;
    }
  }

  /**
   * Get TTL of a key in seconds
   * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
   */
  async ttl(key: string): Promise<number> {
    try {
      const client = await this.getClient();
      return await client.ttl(this.buildKey(key));
    } catch {
      return -2;
    }
  }

  // ============================================
  // Distributed Lock Operations
  // ============================================

  /**
   * Acquire a distributed lock
   * @param key The lock key
   * @param lockId A unique identifier for this lock instance (e.g., UUID)
   * @param ttlMs Time to live in milliseconds
   * @returns true if lock was isAcquired, false otherwise
   */
  async acquireLock(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.set(this.buildKey(key), lockId, {
        NX: true,
        PX: ttlMs
      });
      return result === 'OK';
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.acquireLock',
        key,
        lockId
      });
      return false;
    }
  }

  /**
   * Release a distributed lock safely using Lua script
   * Ensures we only release the lock if we own it (lockId matches)
   * 
   * CRITICAL: eval() calls buildKey() internally, so we pass raw key here
   * to match the key format used in acquireLock() which also calls buildKey()
   */
  async releaseLock(key: string, lockId: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      // Pass raw key - eval() will call buildKey() internally
      const result = await this.eval<number>(script, [key], [lockId]);
      return result === 1;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RedisStateService.releaseLock',
        key,
        lockId
      });
      return false;
    }
  }

  /**
   * Execute pipeline operations with a distributed lock (ISSUE-65 fix).
   * Combines executePipeline() with executeWithLock() for critical operations.
   * 
   * Use this for critical read-modify-write operations that require
   * distributed mutual exclusion across multiple servers.
   * 
   * @param lockKey - Unique key for the distributed lock (e.g., "room-mutation:roomId")
   * @param operations - Pipeline operations to execute
   * @param timeoutMs - Lock acquisition timeout in milliseconds (default: 5000)
   * @param ttlMs - Lock TTL in milliseconds (default: 10000)
   */
  async executePipelineWithLock<T>(
    lockKey: string,
    operations: PipelineOperation[],
    timeoutMs: number = 5000,
    ttlMs: number = 10000
  ): Promise<(T | null)[]> {
    return this.executeWithLock(
      lockKey,
      timeoutMs,
      ttlMs,
      async () => this.executePipeline<T>(operations)
    );
  }

  /**
   * Execute an operation with a distributed lock.
   * Will retry until timeout is reached.
   */
  async executeWithLock<T>(
    key: string,
    timeoutMs: number,
    ttlMs: number,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockId = uuidv4();
    const startTime = Date.now();
    const retryDelay = 100; // ms
    let attempts = 0;

    while (Date.now() - startTime < timeoutMs) {
      attempts++;
      const isAcquired = await this.acquireLock(key, lockId, ttlMs);
      
      if (isAcquired) {
        const acquiredAt = Date.now();
        const acquisitionWaitMs = acquiredAt - startTime;
        try {
          return await operation();
        } finally {
          const holdDurationMs = Date.now() - acquiredAt;
          if (typeof loggingService.logPerformanceMetric === 'function') {
            loggingService.logPerformanceMetric('redis_lock_hold_duration', holdDurationMs, {
              keyCategory: key.split(':')[0],
              acquisitionWaitMs,
              attempts,
            });
          }
          await this.releaseLock(key, lockId);
        }
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    if (typeof loggingService.logPerformanceMetric === 'function') {
      loggingService.logPerformanceMetric('redis_lock_timeout', Date.now() - startTime, {
        keyCategory: key.split(':')[0],
        attempts,
        timeoutMs,
        ttlMs,
      });
    }
    throw new Error(`Failed to acquire lock for key ${key} within ${timeoutMs}ms`);
  }

  /**
   * Build prefixed key
   */
  private buildKey(key: string): string {
    return `${this.KEY_PREFIX}${key}`;
  }

  /**
   * Reset connection state when client becomes disconnected
   */
  private resetConnectionState(): void {
    this.isConnected = false;
    this.client = null;
    resetRedisClients();
  }

  /**
   * Get connected Redis client with automatic reconnection
   */
  private async getClient(): Promise<RedisClient> {

    // Check if current client is still connected
    if (this.client && this.isConnected) {
      // Verify client is still open
      if (this.client.isOpen) {
        return this.client;
      }
      // Client is closed, reset state
      this.resetConnectionState();
    }

    // Prevent concurrent connection attempts
    if (this.isConnecting) {
      // Wait for ongoing connection
      await new Promise<void>((resolve) => {
        // eslint-disable-next-line prefer-const
        let timeoutId: NodeJS.Timeout;

        const checkInterval = setInterval(() => {
          if (!this.isConnecting && this.client?.isOpen) {
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            resolve();
          }
        }, 100);

        timeoutId = setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 10000);
      });

      if (this.client?.isOpen) {
        return this.client;
      }
    }

    this.isConnecting = true;
    try {
      this.client = await getRedisClient();
      this.isConnected = true;
      return this.client;
    } finally {
      this.isConnecting = false;
    }
  }
}

// Singleton export
export const redisStateService = RedisStateService.getInstance();
