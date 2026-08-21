import type { Request, Response } from 'express';
import { LinearService } from './LinearService';
import type { BugReportPayload, BugCategory, BugArea, ReportType } from './LinearService';
import { loggingService } from '../logging/LoggingService';

const VALID_REPORT_TYPES: ReportType[] = ['bug', 'feature'];
const VALID_CATEGORIES: BugCategory[] = ['audio', 'ui', 'sync', 'performance', 'other'];
const VALID_AREAS: BugArea[] = ['perform_room', 'arrange_room', 'auth', 'profile', 'other'];

export class BugReportController {
  private readonly linearService = new LinearService();

  async submit(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const reportType = body.reportType as string | undefined;
      const category = body.category as string | undefined;
      const categoryOther = body.categoryOther as string | undefined;
      const area = body.area as string | undefined;
      const areaOther = body.areaOther as string | undefined;
      const featureTitle = body.featureTitle as string | undefined;
      const description = body.description as string | undefined;
      const url = body.url as string | undefined;
      const userType = body.userType as string | undefined;
      const userId = body.userId as string | undefined;
      const roomId = body.roomId as string | undefined;
      const browser = body.browser as string | undefined;
      const os = body.os as string | undefined;
      const errorStack = body.errorStack as string | undefined;
      const source = body.source as string | undefined;

      // Validate reportType
      if (!reportType || !VALID_REPORT_TYPES.includes(reportType as ReportType)) {
        res.status(400).json({ success: false, error: 'Invalid or missing reportType' });
        return;
      }

      if (reportType === 'bug') {
        if (!category || !VALID_CATEGORIES.includes(category as BugCategory)) {
          res.status(400).json({ success: false, error: 'Invalid or missing category' });
          return;
        }
        if (!area || !VALID_AREAS.includes(area as BugArea)) {
          res.status(400).json({ success: false, error: 'Invalid or missing area' });
          return;
        }
        if (category === 'other' && !categoryOther?.trim()) {
          res.status(400).json({ success: false, error: 'Please specify category details' });
          return;
        }
        if (area === 'other' && !areaOther?.trim()) {
          res.status(400).json({ success: false, error: 'Please specify area details' });
          return;
        }
      }

      if (reportType === 'feature') {
        if (!featureTitle?.trim()) {
          res.status(400).json({ success: false, error: 'Feature title is required' });
          return;
        }
      }

      const payload: BugReportPayload = {
        reportType: reportType as ReportType,
        source: source === 'crash' ? 'crash' : 'manual',
        ...(reportType === 'bug' && category ? { category: category as BugCategory } : {}),
        ...(categoryOther?.trim() ? { categoryOther: categoryOther.trim() } : {}),
        ...(reportType === 'bug' && area ? { area: area as BugArea } : {}),
        ...(areaOther?.trim() ? { areaOther: areaOther.trim() } : {}),
        ...(featureTitle?.trim()
          ? { featureTitle: featureTitle.trim().slice(0, 200) }
          : {}),
        ...(description?.trim() ? { description: description.trim().slice(0, 2000) } : {}),
        ...(typeof url === 'string' ? { url: url.slice(0, 500) } : {}),
        ...(typeof userType === 'string' ? { userType } : {}),
        ...(typeof userId === 'string' ? { userId } : {}),
        ...(typeof roomId === 'string' ? { roomId } : {}),
        ...(typeof browser === 'string' ? { browser: browser.slice(0, 200) } : {}),
        ...(typeof os === 'string' ? { os: os.slice(0, 100) } : {}),
        ...(typeof errorStack === 'string' ? { errorStack } : {}),
      };

      const issue = await this.linearService.createIssue(payload);

      res.status(200).json({
        success: true,
        issueIdentifier: issue?.identifier ?? null,
      });
    } catch (err) {
      loggingService.logError(err instanceof Error ? err : new Error(String(err)), { context: 'BugReportController.submit' });
      res.status(500).json({ success: false, error: 'Failed to create report' });
    }
  }
}
