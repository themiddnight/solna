import type { IncidentReportV1 } from './types';

export const SOLNA_ISSUES_URL = 'https://github.com/themiddnight/solna/issues/new';

const ISSUE_TEMPLATE = 'bug-report.yml';
const MAX_TITLE_LENGTH = 100;
const MAX_SUMMARY_LENGTH = 300;

function bounded(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function issueTitle(report: IncidentReportV1): string {
  return bounded(`[${report.kind}] ${report.summary} (${report.fingerprint})`, MAX_TITLE_LENGTH);
}

/** Plain-text body: headline facts only. The full JSON is attached by the user, never put in the URL. */
function issueBody(report: IncidentReportV1): string {
  const recovery =
    report.recoveryAttempts.length === 0
      ? 'none'
      : report.recoveryAttempts.map((a) => `#${a.generation} ${a.result}`).join(', ');
  return [
    'This report is public: GitHub issues are visible to everyone. Review it before submitting.',
    '',
    `Summary: ${bounded(report.summary, MAX_SUMMARY_LENGTH)}`,
    `Kind: ${report.kind} (${report.severity})`,
    `Fingerprint: ${report.fingerprint}`,
    `Build: ${report.buildId}`,
    `Runtime: ${report.runtime.engine} / ${report.runtime.platform}${report.runtime.standalone ? ' (installed app)' : ''}`,
    `Recovery attempts: ${recovery}`,
    '',
    'Please attach the exported incident JSON file to this issue by dragging it into the description. It was not included here.',
  ].join('\n');
}

/** Issue-form fields are prefilled by their `id` in bug-report.yml; a form ignores `body`, so the ids are set too. */
function formFields(report: IncidentReportV1): Record<string, string> {
  return {
    fingerprint: report.fingerprint,
    build: report.buildId,
    environment: `${report.runtime.engine} / ${report.runtime.platform}${report.runtime.standalone ? ' (installed app)' : ''}`,
    recovery:
      report.recoveryAttempts.length === 0
        ? 'none'
        : report.recoveryAttempts.map((a) => `#${a.generation} ${a.result}`).join(', '),
  };
}

/** A prefilled GitHub issue URL. Opening it creates nothing until the user submits the form. */
export function githubIssueUrl(report: IncidentReportV1): string {
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: issueTitle(report),
    body: issueBody(report),
    ...formFields(report),
  });
  return `${SOLNA_ISSUES_URL}?${params.toString()}`;
}
