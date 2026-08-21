/**
 * EmailService retry behavior (BE-slices Task 29) — documents existing behavior.
 *
 * Fake timers + Resend mocked at the boundary: exponential backoff 1s/2s/4s,
 * exactly 2 sends when attempt 2 succeeds, and the final error surfaced when
 * all attempts fail. Also pins the not-configured silent-skip path and the
 * fallback from-address.
 *
 * The Resend mock is a plain class (not a jest.fn constructor) so it survives
 * jest's resetMocks between tests; behavior is controlled through the
 * module-level mockResendSend mock.
 */
// Typed as unknown-returning so the delegation arrows stay any-free (TR-27).
const mockResendSend = jest.fn<Promise<unknown>, unknown[]>();
const mockLogWarn = jest.fn<unknown, unknown[]>();
const mockLogError = jest.fn<unknown, unknown[]>();

jest.mock('resend', () => {
  class MockResend {
    readonly emails: { send: (...args: unknown[]) => unknown };

    constructor() {
      this.emails = { send: (...args: unknown[]) => mockResendSend(...args) };
    }
  }
  return { Resend: MockResend };
});

jest.mock('@/config/environment', () => ({
  config: { email: { fromAddress: '' } },
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logWarn: (...args: unknown[]) => mockLogWarn(...args),
    logError: (...args: unknown[]) => mockLogError(...args),
  },
}));

// Imported after the mocks so the module-level `emailService` singleton (which
// constructs a Resend at import time) sees initialized consts.
import { EmailService } from '../infrastructure/services/EmailService';

const SENT_CODE = '123456';

// The not-configured test deletes RESEND_API_KEY; restore the pre-suite value
// afterwards so the key never leaks deleted into later test files sharing the
// jest worker (env pollution bug from the original coverage campaign).
const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY;

describe('EmailService retry (via sendVerificationEmail)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.RESEND_API_KEY = 're_test_key';
  });

  afterEach(() => {
    jest.useRealTimers();
    if (ORIGINAL_RESEND_API_KEY === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY;
    }
  });

  it('retries with 1s backoff and succeeds on attempt 2 — exactly 2 sends', async () => {
    mockResendSend.mockRejectedValueOnce(new Error('transient SMTP failure'));
    mockResendSend.mockResolvedValueOnce({ id: 'msg_1' });

    const sending = new EmailService().sendVerificationEmail('user@example.com', SENT_CODE);

    await Promise.resolve(); // attempt 1 rejected → 1s backoff timer now scheduled
    await jest.advanceTimersByTimeAsync(1000); // fire the 1s backoff → attempt 2 succeeds

    await expect(sending).resolves.toBeUndefined();
    expect(mockResendSend).toHaveBeenCalledTimes(2);
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Email send hasFailed, retrying',
      expect.objectContaining({ attempt: 1, maxRetries: 3, delayMs: 1000 })
    );
  });

  it('backs off 1s/2s/4s and surfaces the final error when all attempts fail', async () => {
    mockResendSend.mockRejectedValue(new Error('SMTP down'));

    const sending = new EmailService().sendVerificationEmail('user@example.com', SENT_CODE);
    // Attach the rejection handler up front so the final throw is never an
    // unhandled rejection between timer advancement and the assertion.
    const rejectsWithFinalError = expect(sending).rejects.toThrow('Failed to send email after retries');

    await Promise.resolve(); // attempt 1 failed → 1s backoff scheduled
    await jest.runAllTimersAsync(); // 1s → attempt 2 fails (2s) → attempt 3 fails → throw

    await rejectsWithFinalError;
    expect(mockResendSend).toHaveBeenCalledTimes(3);
    expect(mockLogWarn).toHaveBeenCalledTimes(2);
    expect(mockLogWarn).toHaveBeenNthCalledWith(
      1,
      'Email send hasFailed, retrying',
      expect.objectContaining({ attempt: 1, maxRetries: 3, delayMs: 1000 })
    );
    expect(mockLogWarn).toHaveBeenNthCalledWith(
      2,
      'Email send hasFailed, retrying',
      expect.objectContaining({ attempt: 2, maxRetries: 3, delayMs: 2000 })
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'EmailService.sendWithRetry', attempts: 3 })
    );
  });

  it('sends with the fallback from-address when config.email.fromAddress is empty', async () => {
    mockResendSend.mockResolvedValueOnce({ id: 'msg_2' });

    await new EmailService().sendVerificationEmail('user@example.com', SENT_CODE);

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'murva <noreply@themiddnight.dev>',
        to: 'user@example.com',
        subject: 'Verify Your Email - murva',
      })
    );
    const sent = mockResendSend.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(sent?.html).toContain(SENT_CODE);
  });

  it('logs a warning and sends nothing when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;

    await new EmailService().sendVerificationEmail('user@example.com', SENT_CODE);

    expect(mockResendSend).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Email service not isConfigured; email not sent',
      expect.objectContaining({ to: 'user@example.com', subject: 'Verify Your Email - murva' })
    );
  });
});
