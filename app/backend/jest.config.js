module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '**/tests/**/*.test.ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/bootstrap/**',
    '!src/**/__tests__/**',
    '!src/**/*.test.ts',
    '!src/testing/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  maxWorkers: 4, // Allow limited parallel execution, increased from 1 for faster CI
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  resetModules: true, // Reset module registry between tests
  // Tiered per-path thresholds — Phase 0 ratchet baseline (current actual − 2pt,
  // computed 2026-08-15 from the post-deletion coverage run). Jest semantics:
  // PATH keys (trailing slash) aggregate all files under the prefix recursively;
  // GLOB keys are per-file and cannot express aggregate tiers (ledger ruling).
  coverageThreshold: {
    'src/shared/infrastructure/security/': { statements: 98 },
    'src/shared/infrastructure/handlers/': { statements: 93.65 },
    'src/shared/infrastructure/socket/': { statements: 98 },
    'src/domains/auth/': { statements: 93.86 }, // ratcheted 2026-08-16: 95.86 actual − 2pt (Task 4)
    'src/domains/room-management/': { statements: 60.46 }, // ratcheted 2026-08-17: 62.46 actual − 2pt (Task 5)
    'src/domains/arrange-room/': { statements: 61.7 }, // ratcheted 2026-08-17: 63.69 actual − 2pt = 61.69 < 61.7 (Task 5)
    'src/domains/lobby-management/': { statements: 59.97 }, // ratcheted 2026-08-17: 61.97 actual − 2pt (Task 6)
    'src/domains/real-time-communication/': { statements: 77.79 }, // ratcheted 2026-08-17: 79.79 actual − 2pt (Task 5)
    'src/domains/perform-room/': { statements: 55.81 }, // ratcheted 2026-08-17: 57.81 actual − 2pt (Task 5)
    'src/domains/audio-processing/': { statements: 43.3 },
    'src/domains/user-management/': { statements: 64.3 },
    'src/domains/ai-generation/': { statements: 77.7 },
    'src/routes/': { statements: 92.8 },
    'src/middleware/': { statements: 55.7 },
    'src/workers/': { statements: 92.9 },
    'src/shared/infrastructure/namespace/': { statements: 77.6 },
    'src/shared/infrastructure/resilience/': { statements: 64.7 },
    'src/shared/infrastructure/performance/': { statements: 93.1 },
    'src/shared/infrastructure/monitoring/': { statements: 49.9 },
    'src/shared/infrastructure/storage/': { statements: 78.0 },
    'src/shared/infrastructure/events/': { statements: 66.5 },
    'src/shared/infrastructure/workers/': { statements: 23.5 },
    'src/shared/infrastructure/logging/': { statements: 69.9 },
    'src/shared/infrastructure/profiling/': { statements: 50.2 },
    'src/shared/infrastructure/bug-report/': { statements: 89.9 },
    'src/shared/infrastructure/caching/': { statements: 64.6 },
    'src/shared/utils/': { statements: 92.06 }, // ratcheted 2026-08-17: 94.06 actual − 2pt (Task 12)
    'src/shared/domain/': { statements: 79.48 }, // ratcheted 2026-08-17: 81.48 actual − 2pt (Task 12)
    'src/shared/constants/': { statements: 98 },
    'src/config/': { statements: 48.5 },
    'src/types/': { statements: 98 },
    'src/': { statements: 59.6 },
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/__tests__/fixtures/'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  }
};