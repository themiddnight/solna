/**
 * Test Utilities - Helper functions for testing
 */
import { performance } from 'perf_hooks';

interface TrackedPromise extends Promise<void> {
  status?: 'resolved' | 'rejected' | 'pending';
}

export class TestUtils {
  private static instance: TestUtils | undefined;
  private readonly performanceMetrics: Map<string, number[]> = new Map();

  static getInstance(): TestUtils {
    if (!TestUtils.instance) {
      TestUtils.instance = new TestUtils();
    }
    return TestUtils.instance;
  }

  // Performance testing utilities
  async measureExecutionTime<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await operation();
    const end = performance.now();
    const duration = end - start;

    // Store metrics
    if (!this.performanceMetrics.has(operationName)) {
      this.performanceMetrics.set(operationName, []);
    }
    this.performanceMetrics.get(operationName)!.push(duration);

    return { result, duration };
  }

  getPerformanceStats(operationName: string) {
    const metrics = this.performanceMetrics.get(operationName) || [];
    if (metrics.length === 0) {
      return null;
    }

    const sorted = metrics.slice().sort((a, b) => a - b);
    return {
      count: metrics.length,
      min: Math.min(...metrics),
      max: Math.max(...metrics),
      avg: metrics.reduce((a, b) => a + b, 0) / metrics.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  clearPerformanceMetrics(): void {
    this.performanceMetrics.clear();
  }

  // Async utilities
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return;
      }
      await this.sleep(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Retry utilities
  async retry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;
        
        if (attempt === maxAttempts) {
          throw lastError;
        }
        
        await this.sleep(delay * attempt); // Exponential backoff
      }
    }
    
    throw lastError!;
  }

  // Data generation utilities
  generateRandomString(length: number = 10): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  generateRandomEmail(): string {
    const username = this.generateRandomString(8);
    const domain = this.generateRandomString(6);
    return `${username}@${domain}.com`;
  }

  generateRandomPort(): number {
    return Math.floor(Math.random() * (65535 - 1024) + 1024);
  }

  // Mock utilities
  createMockSocket(overrides: Record<string, unknown> = {}): {
    [key: string]: unknown;
    id: string;
    connected: boolean;
    emit: jest.Mock;
    on: jest.Mock;
    off: jest.Mock;
    join: jest.Mock;
    leave: jest.Mock;
    disconnect: jest.Mock;
    to: jest.Mock;
    in: jest.Mock;
    broadcast: {
      emit: jest.Mock;
      to: jest.Mock;
      in: jest.Mock;
    };
    handshake: {
      auth: Record<string, unknown>;
      query: Record<string, unknown>;
      headers: Record<string, unknown>;
    };
  } {
    return {
      id: this.generateRandomString(12),
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      to: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      broadcast: {
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis()
      },
      handshake: {
        auth: {},
        query: {},
        headers: {}
      },
      ...overrides
    };
  }

  createMockRequest(overrides: Record<string, unknown> = {}): {
    [key: string]: unknown;
    body: Record<string, unknown>;
    params: Record<string, unknown>;
    query: Record<string, unknown>;
    headers: Record<string, unknown>;
    user: null;
  } {
    return {
      body: {},
      params: {},
      query: {},
      headers: {},
      user: null,
      ...overrides
    };
  }

  createMockResponse(): {
    status: jest.Mock;
    json: jest.Mock;
    send: jest.Mock;
    end: jest.Mock;
    cookie: jest.Mock;
    clearCookie: jest.Mock;
    redirect: jest.Mock;
    locals: Record<string, unknown>;
  } {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      locals: {}
    };
    return res;
  }

  // Test isolation utilities
  async isolateTest<T>(testFn: () => Promise<T>): Promise<T> {
    // Save current state
    const originalEnv = { ...process.env };
    
    try {
      // Run test
      return await testFn();
    } finally {
      // Restore state
      process.env = originalEnv;
      jest.clearAllMocks();
    }
  }

  // Validation utilities
  expectToMatchSchema(object: Record<string, unknown>, schema: Record<string, unknown>): void {
    Object.keys(schema).forEach(key => {
      expect(object).toHaveProperty(key);
      
      if (typeof schema[key] === 'string') {
        expect(typeof object[key]).toBe(schema[key]);
      } else if (schema[key] instanceof RegExp) {
        expect(object[key]).toMatch(schema[key] as RegExp);
      } else if (typeof schema[key] === 'function') {
        expect((schema[key] as (value: unknown) => boolean)(object[key])).toBe(true);
      }
    });
  }

  expectArrayToContainObjectsMatching(array: Record<string, unknown>[], matcher: Record<string, unknown> | ((item: Record<string, unknown>) => boolean)): void {
    expect(Array.isArray(array)).toBe(true);
    expect(array.length).toBeGreaterThan(0);
    
    array.forEach(item => {
      if (typeof matcher === 'function') {
        expect(matcher(item)).toBe(true);
      } else {
        expect(item).toMatchObject(matcher);
      }
    });
  }

  // Concurrency testing utilities
  async runConcurrently<T>(
    operations: (() => Promise<T>)[],
    maxConcurrency: number = 10
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: TrackedPromise[] = [];

    for (const operation of operations) {
      const promise = operation().then(result => {
        results.push(result);
      }) as TrackedPromise;

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
        // Remove completed promises
        const completedIndex = executing.findIndex(p => 
          p.status === 'resolved' || p.status === 'rejected'
        );
        if (completedIndex !== -1) {
          void executing.splice(completedIndex, 1);
        }
      }
    }

    await Promise.all(executing);
    return results;
  }

  // Memory and resource testing
  measureMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  expectMemoryUsageToBeReasonable(beforeUsage: NodeJS.MemoryUsage, afterUsage: NodeJS.MemoryUsage): void {
    const heapGrowth = afterUsage.heapUsed - beforeUsage.heapUsed;
    const maxAcceptableGrowth = 50 * 1024 * 1024; // 50MB
    
    expect(heapGrowth).toBeLessThan(maxAcceptableGrowth);
  }

  // Network testing utilities
  async waitForPort(port: number, timeout: number = 10000): Promise<void> {
    const { createConnection } = await import('net');
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection(port, 'localhost');
          socket.on('connect', () => {
            socket.destroy();
            resolve();
          });
          socket.on('error', (err: Error) => reject(err));
          setTimeout(() => {
            socket.destroy();
            reject(new Error('Connection timeout'));
          }, 1000);
        });
        return;
      } catch {
        await this.sleep(100);
      }
    }

    throw new Error(`Port ${port} not available within ${timeout}ms`);
  }

  // Database testing utilities (for when you add database)
  async cleanupDatabase(): Promise<void> {
    // Implement database cleanup logic when you add a database
    console.log('Database cleanup - implement when database is added');
  }

  async seedDatabase(data: Record<string, unknown>): Promise<void> {
    // Implement database seeding logic when you add a database  
    console.log('Database seeding - implement when database is added', data);
  }
}

// Export singleton instance
export const testUtils = TestUtils.getInstance();
