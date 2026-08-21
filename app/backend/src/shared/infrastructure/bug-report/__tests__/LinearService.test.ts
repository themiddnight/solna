/**
 * Unit tests for LinearService (BE-slices Task 29) — documents existing behavior.
 *
 * Boundary mocks: global `fetch` (assert the GraphQL request body), a mutable
 * `config.linear` (the constructor reads config once per instance, so the
 * not-configured path is exercised by mutating before constructing), and
 * LoggingService (assert the deliberate silent-drop log and failure logs).
 *
 * Behavior pinned:
 * - not configured  → logSecurityEvent + return null (silent drop, NOT a throw)
 * - priority map    → sync/audio=2, ui/performance=3, other=4 (bugs); features=3
 * - failure modes   → HTTP non-ok / GraphQL `errors` / `success=false` all throw
 * - bug vs feature  → label / title / description selection, Business team
 * - slice caps      → 60-char title description snippet, 3000-char error stack
 */
import type { BugCategory, BugReportPayload } from '../LinearService';

const mockLinearConfig = {
  apiKey: 'test-api-key',
  devTeamId: 'test-dev-team-id',
  bizTeamId: 'test-biz-team-id',
};

// Typed as unknown-returning so the delegation arrows stay any-free (TR-27).
const mockLogSecurityEvent = jest.fn<unknown, unknown[]>();
const mockLogPerformanceMetric = jest.fn<unknown, unknown[]>();
const mockLogError = jest.fn<unknown, unknown[]>();

jest.mock('@/config/environment', () => ({
  config: { linear: mockLinearConfig },
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logSecurityEvent: (...args: unknown[]) => mockLogSecurityEvent(...args),
    logPerformanceMetric: (...args: unknown[]) => mockLogPerformanceMetric(...args),
    logError: (...args: unknown[]) => mockLogError(...args),
  },
}));

// Imported after the mocks so the mock factories see initialized consts.
import { LinearService } from '../LinearService';

const mockFetch = jest.fn<Promise<Response>, [input: unknown, init?: RequestInit]>();

// Label IDs from LinearService.ts — the mocks assert them verbatim.
const LABEL_BUG = 'dc1d8dc7-fd50-4084-9c9d-3ec69bd150a1';
const LABEL_PRODUCT = 'f7a844dc-f35e-470b-9fe5-77bf45681afa';

function makeSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      data: { issueCreate: { success: true, issue: { id: 'issue-1', identifier: 'MURVA-1' } } },
    }),
    { status: 200 }
  );
}

function setGlobalFetch(mock: unknown): void {
  Object.defineProperty(globalThis, 'fetch', { value: mock, configurable: true, writable: true });
}

const bugPayload = (overrides: Partial<BugReportPayload> = {}): BugReportPayload => ({
  reportType: 'bug',
  category: 'audio',
  area: 'auth',
  description: 'Volume knob jumps around',
  source: 'manual',
  ...overrides,
});

function parseRequestBody(): { query: string; variables: { input: Record<string, unknown> } } {
  const init = mockFetch.mock.calls[0]?.[1];
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error('fetch request body expected to be a JSON string');
  }
  return JSON.parse(body) as { query: string; variables: { input: Record<string, unknown> } };
}

const originalFetch = globalThis.fetch;

describe('LinearService', () => {
  beforeEach(() => {
    mockLinearConfig.apiKey = 'test-api-key';
    mockLinearConfig.devTeamId = 'test-dev-team-id';
    mockLinearConfig.bizTeamId = 'test-biz-team-id';
    setGlobalFetch(mockFetch);
    // Fresh Response per call — a Response body can only be consumed once.
    mockFetch.mockImplementation(async () => makeSuccessResponse());
  });

  afterEach(() => {
    setGlobalFetch(originalFetch);
  });

  it('drops the report silently (logs a warning, returns null) when Linear is not configured', async () => {
    mockLinearConfig.apiKey = '';
    mockLinearConfig.devTeamId = '';
    mockLinearConfig.bizTeamId = '';

    const result = await new LinearService().createIssue(bugPayload());

    expect(result).toBeNull();
    expect(mockLogSecurityEvent).toHaveBeenCalledWith(
      'Linear not configured — report dropped',
      expect.any(Object),
      'warn'
    );
    const details = mockLogSecurityEvent.mock.calls[0]?.[1] as
      | { payload?: BugReportPayload }
      | undefined;
    expect(details?.payload?.reportType).toBe('bug');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps bug categories to Linear priority (sync/audio=2, ui/performance=3, other=4)', async () => {
    const cases: Array<[BugCategory, number]> = [
      ['sync', 2],
      ['audio', 2],
      ['ui', 3],
      ['performance', 3],
      ['other', 4],
    ];

    for (const [category, priority] of cases) {
      mockFetch.mockClear();
      await new LinearService().createIssue(bugPayload({ category }));
      expect(parseRequestBody().variables.input.priority).toBe(priority);
    }
  });

  it('throws on a non-ok HTTP response and logs the failure', async () => {
    mockFetch.mockResolvedValueOnce(new Response('service unavailable', { status: 503 }));

    await expect(new LinearService().createIssue(bugPayload())).rejects.toThrow('Linear API HTTP 503');
    expect(mockLogSecurityEvent).toHaveBeenCalledWith(
      'Failed to create Linear issue',
      expect.objectContaining({ error: 'Error: Linear API HTTP 503' }),
      'error'
    );
  });

  it('throws when the GraphQL response contains errors', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'boom' }, { message: 'kapow' }] }), {
        status: 200,
      })
    );

    await expect(new LinearService().createIssue(bugPayload())).rejects.toThrow('boom, kapow');
  });

  it('throws when issueCreate returns success=false or no issue', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { issueCreate: { success: false, issue: null } } }),
        { status: 200 }
      )
    );

    await expect(new LinearService().createIssue(bugPayload())).rejects.toThrow(
      'Linear issueCreate returned isSuccess=false'
    );
  });

  it('routes bugs to the Business team with the Bug label, priority and bug title', async () => {
    await new LinearService().createIssue(bugPayload());

    const { query, variables } = parseRequestBody();
    expect(query).toContain('issueCreate');
    expect(variables.input).toMatchObject({
      teamId: 'test-biz-team-id',
      labelIds: [LABEL_BUG],
      priority: 2,
      title: '[Audio][Auth & Login] Volume knob jumps around',
    });
    expect(variables.input.description).toContain('## Bug Report\n');
    expect(variables.input.description).toContain('**Source:** 🟡 Manual Report');
  });

  it('builds a multi-line bug description with real newlines', async () => {
    await new LinearService().createIssue(bugPayload({ description: 'hello' }));

    const body = parseRequestBody();
    const description = body.variables.input.description as string;
    expect(description).toContain('\n');
    expect(description.split('\n').length).toBeGreaterThan(3);
  });

  it('routes feature requests with the Product label, Medium priority and feature title', async () => {
    await new LinearService().createIssue({
      reportType: 'feature',
      featureTitle: 'Add a looper pedal',
      description: 'A loop station for jams',
      source: 'manual',
    });

    const { variables } = parseRequestBody();
    expect(variables.input).toMatchObject({
      teamId: 'test-biz-team-id',
      labelIds: [LABEL_PRODUCT],
      priority: 3,
      title: '[Feature Request] Add a looper pedal',
    });
    expect(variables.input.description).toContain('## Feature Request\n');
  });

  it('builds a multi-line feature description with real newlines', async () => {
    await new LinearService().createIssue({
      reportType: 'feature',
      featureTitle: 'Add a looper pedal',
      description: 'A loop station for jams',
      source: 'manual',
    });

    const body = parseRequestBody();
    const description = body.variables.input.description as string;
    expect(description).toContain('\n');
    expect(description.split('\n').length).toBeGreaterThan(3);
  });

  it('uses "App crashed" as the bug title fallback for crash-sourced reports', async () => {
    await new LinearService().createIssue({
      reportType: 'bug',
      category: 'audio',
      area: 'auth',
      source: 'crash',
    });

    expect(parseRequestBody().variables.input.title).toBe('[Audio][Auth & Login] App crashed');
  });

  it('caps the bug title description snippet at 60 characters', async () => {
    await new LinearService().createIssue(bugPayload({ description: 'd'.repeat(100) }));

    expect(parseRequestBody().variables.input.title).toBe(`[Audio][Auth & Login] ${'d'.repeat(60)}`);
  });

  it('caps the error stack trace at 3000 characters in the description', async () => {
    await new LinearService().createIssue(bugPayload({ errorStack: 's'.repeat(3500) }));

    const description = String(parseRequestBody().variables.input.description);
    expect(description).toContain('s'.repeat(3000));
    expect(description).not.toContain('s'.repeat(3001));
  });

  it('returns the created issue and logs the report_created metric on success', async () => {
    const result = await new LinearService().createIssue(bugPayload());

    expect(result).toEqual({ id: 'issue-1', identifier: 'MURVA-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({ method: 'POST' })
    );
    // Headers asserted separately: `'Content-Type'` is not a valid
    // naming-convention literal, so the expected object is built at runtime.
    const init = mockFetch.mock.calls[0]?.[1];
    const expectedHeaders: Record<string, string> = { Authorization: 'test-api-key' };
    expectedHeaders['Content-Type'] = 'application/json';
    expect(init?.headers).toEqual(expectedHeaders);
    expect(mockLogPerformanceMetric).toHaveBeenCalledWith(
      'report_created',
      1,
      expect.objectContaining({ identifier: 'MURVA-1', reportType: 'bug', source: 'manual' })
    );
  });
});
