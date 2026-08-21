import { loggingService } from '../logging/LoggingService';
import { config } from "../../../config/environment";

export type BugCategory = 'audio' | 'ui' | 'sync' | 'performance' | 'other';
export type BugArea =
  | 'perform_room'
  | 'arrange_room'
  | 'auth'
  | 'profile'
  | 'other';

export type ReportType = 'bug' | 'feature';

export interface BugReportPayload {
  reportType: ReportType;
  // Bug-specific fields
  category?: BugCategory;
  categoryOther?: string;
  area?: BugArea;
  areaOther?: string;
  // Feature request fields
  featureTitle?: string;
  // Shared
  description?: string;
  // Auto-attached context
  url?: string;
  userType?: string;
  userId?: string;
  roomId?: string;
  browser?: string;
  os?: string;
  errorStack?: string; // from ErrorBoundary crash
  source: 'manual' | 'crash';
}

interface LinearIssueInput {
  title: string;
  description: string;
  teamId: string;
  labelIds?: string[];
  priority?: number; // 1=Urgent 2=High 3=Medium 4=Low
}

const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Label IDs — scoped per team / global
// Business team labels / global labels
const LABEL_BUG = 'dc1d8dc7-fd50-4084-9c9d-3ec69bd150a1';       // "Bug" global label (used for bugs sent to Business team)
const LABEL_PRODUCT = 'f7a844dc-f35e-470b-9fe5-77bf45681afa';     // "product" in Business team

const BUG_PRIORITY_MAP: Record<BugCategory, number> = {
  sync: 2,        // High
  audio: 2,       // High
  ui: 3,          // Medium
  performance: 3, // Medium
  other: 4,       // Low
};

const CATEGORY_LABEL: Record<BugCategory, string> = {
  audio: 'Audio',
  ui: 'UI',
  sync: 'Sync',
  performance: 'Performance',
  other: 'Other',
};

const AREA_LABEL: Record<BugArea, string> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  perform_room: 'Perform Room',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  arrange_room: 'Arrange Room',
  auth: 'Auth & Login',
  profile: 'Profile',
  other: 'Other',
};

export class LinearService {
  private readonly apiKey: string;
  private readonly devTeamId: string;  // Developer team — receives bug reports
  private readonly bizTeamId: string;  // Business team — receives feature requests

  constructor() {
    this.apiKey = config.linear.apiKey || '';
    this.devTeamId = config.linear.devTeamId || '';
    this.bizTeamId = config.linear.bizTeamId || '';
  }

  // ─── Main method ──────────────────────────────────────────

  async createIssue(payload: BugReportPayload): Promise<{ id: string; identifier: string } | null> {
    if (!this.isConfigured()) {
      loggingService.logSecurityEvent(
        'Linear not configured — report dropped',
        { payload },
        'warn'
      );
      return null;
    }

    const isBug = payload.reportType === 'bug';

    // All user-submitted feedback (bugs & features) go to the Business team for triage first
    const teamId = this.bizTeamId;
    const labelId = isBug ? LABEL_BUG : LABEL_PRODUCT;

    const input: LinearIssueInput = {
      title: isBug ? this.buildBugTitle(payload) : this.buildFeatureTitle(payload),
      description: isBug ? this.buildBugDescription(payload) : this.buildFeatureDescription(payload),
      teamId,
      labelIds: [labelId],
      priority: isBug
        ? BUG_PRIORITY_MAP[payload.category ?? 'other']
        : 3, // Feature requests default to Medium
    };

    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
          }
        }
      }
    `;

    try {
      const headers: Record<string, string> = {
        Authorization: this.apiKey,
      };
      headers['Content-Type'] = 'application/json';

      const response = await fetch(LINEAR_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: mutation, variables: { input } }),
      });

      if (!response.ok) {
        throw new Error(`Linear API HTTP ${response.status}`);
      }

      const json = (await response.json()) as {
        data?: { issueCreate?: { success: boolean; issue?: { id: string; identifier: string } } };
        errors?: { message: string }[];
      };

      if (json.errors != null && json.errors.length > 0) {
        throw new Error(json.errors.map((e) => e.message).join(', '));
      }

      const result = json.data?.issueCreate;
      if (result == null || !result.success || result.issue == null) {
        throw new Error('Linear issueCreate returned isSuccess=false');
      }

      loggingService.logPerformanceMetric('report_created', 1, {
        identifier: result.issue.identifier,
        reportType: payload.reportType,
        source: payload.source,
      });

      return result.issue;
    } catch (err) {
      loggingService.logSecurityEvent(
        'Failed to create Linear issue',
        { error: String(err) },
        'error'
      );
      throw err;
    }
  }

  // ─── Private helpers ─────────────────────────────────────

  private isConfigured(): boolean {
    return this.apiKey !== '' && this.devTeamId !== '' && this.bizTeamId !== '';
  }

  private buildBugTitle(payload: BugReportPayload): string {
    const category = payload.category ?? 'other';
    const area = payload.area ?? 'other';
    const categoryLabel = CATEGORY_LABEL[category];
    const areaLabel = AREA_LABEL[area];
    const desc =
      payload.description
        ? payload.description.slice(0, 60).trim()
        : payload.source === 'crash'
        ? 'App crashed'
        : 'User reported issue';
    return `[${categoryLabel}][${areaLabel}] ${desc}`;
  }

  private buildBugDescription(payload: BugReportPayload): string {
    const category = payload.category ?? 'other';
    const area = payload.area ?? 'other';

    const categoryDisplay =
      category === 'other' && payload.categoryOther
        ? `Other: ${payload.categoryOther}`
        : CATEGORY_LABEL[category];

    const areaDisplay =
      area === 'other' && payload.areaOther
        ? `Other: ${payload.areaOther}`
        : AREA_LABEL[area];

    const lines: string[] = [
      `## Bug Report`,
      ``,
      `**Source:** ${payload.source === 'crash' ? '🔴 App Crash (ErrorBoundary)' : '🟡 Manual Report'}`,
      `**Category:** ${categoryDisplay}`,
      `**Area:** ${areaDisplay}`,
      ``,
    ];

    if (payload.description) {
      lines.push(`## User Description`, ``, payload.description, ``);
    }

    lines.push(`## Context`, ``);
    if (payload.url) lines.push(`- **URL:** \`${payload.url}\``);
    if (payload.userType) lines.push(`- **User Type:** ${payload.userType}`);
    if (payload.userId) lines.push(`- **User ID:** \`${payload.userId}\``);
    if (payload.roomId) lines.push(`- **Room ID:** \`${payload.roomId}\``);
    if (payload.browser) lines.push(`- **Browser:** ${payload.browser}`);
    if (payload.os) lines.push(`- **OS:** ${payload.os}`);

    if (payload.errorStack) {
      lines.push(
        ``,
        `## Error Stack Trace`,
        ``,
        '```',
        payload.errorStack.slice(0, 3000),
        '```'
      );
    }

    lines.push(``, `---`, `*Reported via in-app Bug Report form*`);
    return lines.join('\n');
  }

  private buildFeatureTitle(payload: BugReportPayload): string {
    const title = payload.featureTitle?.trim() || 'Feature Request';
    return `[Feature Request] ${title.slice(0, 80)}`;
  }

  private buildFeatureDescription(payload: BugReportPayload): string {
    const lines: string[] = [
      `## Feature Request`,
      ``,
      `**Title:** ${payload.featureTitle ?? '(not provided)'}`,
      ``,
    ];

    if (payload.description) {
      lines.push(`## Details`, ``, payload.description, ``);
    }

    lines.push(`## Context`, ``);
    if (payload.url) lines.push(`- **URL:** \`${payload.url}\``);
    if (payload.userType) lines.push(`- **User Type:** ${payload.userType}`);
    if (payload.userId) lines.push(`- **User ID:** \`${payload.userId}\``);
    if (payload.browser) lines.push(`- **Browser:** ${payload.browser}`);
    if (payload.os) lines.push(`- **OS:** ${payload.os}`);

    lines.push(``, `---`, `*Submitted via in-app Feature Request form*`);
    return lines.join('\n');
  }
}
