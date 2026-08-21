# Backend Testing Guide

This document provides detailed information about the testing framework, conventions, and procedures for the murva backend.

## Table of Contents

- [Testing Philosophy](#testing-framework)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing New Tests](#adding-tests-for-new-features)
- [Best Practices](#best-practices)

---

## Testing Framework

### Overview

We maintain a comprehensive test suite with **over 270 tests** across multiple categories to ensure system stability and prevent regressions.

**Key Testing Categories:**
- **Regression Tests**: Protect against critical bugs that were previously fixed.
- **Integration Tests**: Verify complete workflows and complex room lifecycle logic.
- **Unit Tests**: Test isolated components, services, and domain logic.
- **End-to-End Tests**: Validate API endpoints and WebSocket integration.

---

## Running Tests

### Basic Commands
```bash
# Run all tests
bun test

# Run specific test types
bun run test:unit           # Unit tests only
bun run test:integration    # Integration tests only
bun run test:e2e           # End-to-end tests only
bun run test:regression    # Regression tests only

# Run all test types in sequence
bun run test:all

# Development commands
bun run test:watch         # Watch mode
bun run test:coverage      # With coverage report
bun run test:changed       # Only changed files
```

### Continuous Integration
```bash
bun run test:ci            # CI optimized run
```

---

## Adding Tests for New Features

### 1. Before Adding a New Feature
Run regression tests to establish a baseline:
```bash
bun run test:regression
```

### 2. During Feature Development
Write tests in this order:
1. **Unit Tests**: Define the core logic and edge cases for your new service or utility.
2. **Integration Tests**: Verify that your feature interacts correctly with other domains and infrastructure (Redis/DB).

### 3. After Feature Implementation
Run the comprehensive test suite to ensure no side effects:
```bash
bun run test:all
```

---

## Debugging Tests

### 1. Enable Console Output
```bash
# Run tests with verbose output
bun test -- --verbose
```

### 2. Isolate Failing Tests
```bash
# Filter by file path
bun test -- --testPathPattern="specific-test-file"

# Filter by test name
bun test -- --testNamePattern="specific test name"
```

---

## Best Practices

### 1. Real Infrastructure Testing
When testing components that interact with Redis, prefer using the real Redis service (via `RealRedisStateService.integration.test.ts`) when possible to ensure actual connectivity and data persistence are verified.

### 2. Regression Protection
If you fix a bug, **always** add a corresponding test in the `__tests__/` directory with the `.regression.test.ts` suffix. This prevents the bug from being reintroduced in future changes.

### 3. Clean Setup/Teardown
Always use `beforeAll`/`afterAll` and `beforeEach`/`afterEach` to manage test environments and clean up Redis keys or database records.

---

See also:
- [Development Guide](../docs/DEVELOPMENT.md) - General development workflow
- [Architecture Guide](../docs/ARCHITECTURE.md) - System design and DDD layers
