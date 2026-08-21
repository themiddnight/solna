/**
 * Unit tests for BugReportController (BE-slices Task 29) — documents existing
 * behavior. Real controller exercised through a real express pipeline
 * (supertest); LinearService is mocked at the module boundary and
 * LoggingService is mocked to keep logs out of test output.
 *
 * TR-33 note — userId/roomId are CONTEXT, not identity: a bug report is
 * submitted from the client on an unauthenticated, rate-limited endpoint
 * (5 reports/hour/IP, routes/bugReport.ts). userId/roomId are attached to the
 * Linear issue for triage context only; the server never derives the acting
 * identity or any privilege from them, so no TR-33 concern applies here.
 */
import express from 'express';
import request from 'supertest';
import type { BugReportPayload } from '../LinearService';

const mockCreateIssue = jest.fn<
  Promise<{ id: string; identifier: string } | null>,
  [payload: BugReportPayload]
>();

jest.mock('../LinearService', () => {
  class MockLinearService {
    readonly createIssue: (payload: BugReportPayload) => Promise<{ id: string; identifier: string } | null>;

    constructor() {
      this.createIssue = mockCreateIssue;
    }
  }
  return { LinearService: MockLinearService };
});

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
    logSecurityEvent: jest.fn(),
    logPerformanceMetric: jest.fn(),
    logWarn: jest.fn(),
  },
}));

// Imported after the mocks so the mock factory sees initialized consts.
import { BugReportController } from '../BugReportController';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';

const app = express();
app.use(express.json());
app.post('/bug-report', (req, res) => {
  void new BugReportController().submit(req, res);
});

const validBug = { reportType: 'bug', category: 'audio', area: 'auth' };
const validFeature = { reportType: 'feature', featureTitle: 'Add a looper pedal' };

describe('BugReportController.submit', () => {
  beforeEach(() => {
    mockCreateIssue.mockResolvedValue({ id: 'issue-1', identifier: 'MURVA-1' });
  });

  describe('validation — 400 responses', () => {
    it('rejects a missing reportType', async () => {
      const res = await request(app).post('/bug-report').send({ category: 'audio', area: 'auth' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid or missing reportType' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects an invalid reportType', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validBug, reportType: 'nonsense' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid or missing reportType' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects a bug report with a missing category', async () => {
      const res = await request(app).post('/bug-report').send({ reportType: 'bug', area: 'auth' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid or missing category' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects a bug report with an invalid category', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validBug, category: 'graphics' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid or missing category' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects a bug report with a missing area', async () => {
      const res = await request(app).post('/bug-report').send({ reportType: 'bug', category: 'audio' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid or missing area' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects a bug report with an invalid area', async () => {
      const res = await request(app).post('/bug-report').send({ ...validBug, area: 'settings' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid or missing area' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('requires categoryOther when category is "other"', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ reportType: 'bug', category: 'other', area: 'auth' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Please specify category details' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only categoryOther', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ reportType: 'bug', category: 'other', categoryOther: '   ', area: 'auth' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Please specify category details' });
    });

    it('requires areaOther when area is "other"', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ reportType: 'bug', category: 'audio', area: 'other' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Please specify area details' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only areaOther', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ reportType: 'bug', category: 'audio', area: 'other', areaOther: '\t' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Please specify area details' });
    });

    it('requires featureTitle for feature reports', async () => {
      const res = await request(app).post('/bug-report').send({ reportType: 'feature' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Feature title is required' });
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only featureTitle', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ reportType: 'feature', featureTitle: ' ' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Feature title is required' });
    });
  });

  describe('truncation caps — one boundary each', () => {
    it('caps featureTitle at 200 characters', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validFeature, featureTitle: 'f'.repeat(201) });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ featureTitle: 'f'.repeat(200) })
      );
    });

    it('caps description at 2000 characters', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validBug, description: 'd'.repeat(2001) });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'd'.repeat(2000) })
      );
    });

    it('caps url at 500 characters', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validBug, url: 'u'.repeat(501) });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ url: 'u'.repeat(500) }));
    });

    it('caps browser at 200 characters', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validBug, browser: 'b'.repeat(201) });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ browser: 'b'.repeat(200) })
      );
    });

    it('caps os at 100 characters', async () => {
      const res = await request(app).post('/bug-report').send({ ...validBug, os: 'o'.repeat(101) });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ os: 'o'.repeat(100) }));
    });
  });

  describe('source coercion', () => {
    it('keeps source "crash" as crash', async () => {
      const res = await request(app).post('/bug-report').send({ ...validBug, source: 'crash' });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ source: 'crash' }));
    });

    it('coerces any non-crash or missing source to "manual"', async () => {
      const res = await request(app).post('/bug-report').send({ ...validBug, source: 'spam' });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }));

      mockCreateIssue.mockClear();
      const resWithoutSource = await request(app).post('/bug-report').send(validBug);

      expect(resWithoutSource.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }));
    });
  });

  describe('success and failure paths', () => {
    it('returns 200 with the issue identifier when LinearService succeeds', async () => {
      const res = await request(app).post('/bug-report').send(validBug);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, issueIdentifier: 'MURVA-1' });
    });

    it('returns 200 with a null identifier when LinearService returns null', async () => {
      mockCreateIssue.mockResolvedValue(null);

      const res = await request(app).post('/bug-report').send(validBug);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, issueIdentifier: null });
    });

    it('returns 500 success:false and logs the error when LinearService throws', async () => {
      mockCreateIssue.mockRejectedValue(new Error('Linear is down'));

      const res = await request(app).post('/bug-report').send(validBug);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Failed to create report' });
      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'BugReportController.submit' })
      );
    });
  });

  describe('client-supplied context fields (TR-33 note)', () => {
    it('passes userId/roomId through as context only, attached for triage', async () => {
      const res = await request(app).post('/bug-report').send({
        ...validBug,
        userId: 'user-42',
        roomId: 'room-7',
        userType: 'PRO',
        browser: 'Chrome 126',
        os: 'macOS 14',
        url: 'https://murva.app/perform/room-7',
      });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-42',
          roomId: 'room-7',
          userType: 'PRO',
          browser: 'Chrome 126',
          os: 'macOS 14',
          url: 'https://murva.app/perform/room-7',
        })
      );
    });

    it('omits non-string context values (typeof guard on optional fields)', async () => {
      const res = await request(app)
        .post('/bug-report')
        .send({ ...validBug, userId: 42, roomId: { id: 'room-7' } });

      expect(res.status).toBe(200);
      expect(mockCreateIssue).toHaveBeenCalled();
      const sentPayload = mockCreateIssue.mock.calls[0]?.[0];
      expect(sentPayload).not.toHaveProperty('userId');
      expect(sentPayload).not.toHaveProperty('roomId');
    });
  });
});
