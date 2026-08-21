/**
 * TestLogger - Manages console output during tests
 */
export class TestLogger {
  private readonly originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  private readonly mockConsole = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  };

  private isSuppressed = false;

  suppressConsole(): void {
    if (this.isSuppressed) return;
    
    console.log = this.mockConsole.log;
    console.warn = this.mockConsole.warn;
    console.error = this.mockConsole.error;
    console.info = this.mockConsole.info;
    console.debug = this.mockConsole.debug;
    
    this.isSuppressed = true;
  }

  restoreConsole(): void {
    if (!this.isSuppressed) return;
    
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.info = this.originalConsole.info;
    console.debug = this.originalConsole.debug;
    
    this.isSuppressed = false;
  }

  enableConsoleForTest(): void {
    this.restoreConsole();
  }

  disableConsoleForTest(): void {
    this.suppressConsole();
  }

  getConsoleCalls() {
    return {
      log: this.mockConsole.log.mock.calls,
      warn: this.mockConsole.warn.mock.calls,
      error: this.mockConsole.error.mock.calls,
      info: this.mockConsole.info.mock.calls,
      debug: this.mockConsole.debug.mock.calls
    };
  }

  clearConsoleCalls(): void {
    this.mockConsole.log.mockClear();
    this.mockConsole.warn.mockClear();
    this.mockConsole.error.mockClear();
    this.mockConsole.info.mockClear();
    this.mockConsole.debug.mockClear();
  }

  expectConsoleToHaveBeenCalledWith(method: 'log' | 'warn' | 'error' | 'info' | 'debug', ...args: unknown[]): void {
    expect(this.mockConsole[method]).toHaveBeenCalledWith(...args);
  }

  expectConsoleNotToHaveBeenCalled(method: 'log' | 'warn' | 'error' | 'info' | 'debug'): void {
    expect(this.mockConsole[method]).not.toHaveBeenCalled();
  }

  logForTest(message: string, ...args: unknown[]): void {
    this.originalConsole.log(`[TEST LOG] ${message}`, ...args);
  }

  warnForTest(message: string, ...args: unknown[]): void {
    this.originalConsole.warn(`[TEST WARN] ${message}`, ...args);
  }

  errorForTest(message: string, ...args: unknown[]): void {
    this.originalConsole.error(`[TEST ERROR] ${message}`, ...args);
  }
}
