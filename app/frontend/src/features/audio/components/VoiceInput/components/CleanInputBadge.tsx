import { Trans } from "@lingui/react/macro";
import type { CleanInputReport } from "@/engine/audio";

interface CleanInputBadgeProps {
  report: CleanInputReport | null;
  cleanMode: boolean;
}

/**
 * States what the browser actually did with the clean-mode request.
 *
 * `partial` names the offending stages rather than saying "some processing remains": on WebKit
 * there is only one switch to throw, so knowing *which* stage survived is the difference
 * between a fixable setting and a platform limit. `unknown` is rendered as its own state — never
 * folded into `clean` — because it means the browser reported nothing back, so no claim can be
 * made either way.
 */
export function CleanInputBadge({ report, cleanMode }: CleanInputBadgeProps) {
  if (!report) return null;
  // The verdict only answers "did the browser do what we asked" — with clean mode off we asked
  // for processing ON, so a `clean` verdict there means processing is running, not absent. That
  // is only a claim about unprocessed audio when clean mode is on.
  if (!cleanMode) return null;

  const stuckStageNames = (Object.keys(report.actual) as (keyof typeof report.actual)[]).filter(
    (name) => report.actual[name] !== undefined && report.actual[name] !== report.requested[name],
  );

  return (
    <span
      data-testid="clean-input-badge"
      data-verdict={report.verdict}
      className={
        report.verdict === "clean"
          ? "badge badge-success badge-sm"
          : report.verdict === "partial"
            ? "badge badge-warning badge-sm"
            : "badge badge-ghost badge-sm"
      }
    >
      {report.verdict === "clean" && <Trans>Clean input verified</Trans>}
      {report.verdict === "partial" && (
        <Trans>Browser kept processing on: {stuckStageNames.join(", ")}</Trans>
      )}
      {report.verdict === "unknown" && <Trans>Browser did not report input processing</Trans>}
    </span>
  );
}
