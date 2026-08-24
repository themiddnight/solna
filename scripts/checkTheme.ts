import { ALLOWLIST, formatReport, scanRepo } from './themeTokenGuard';

const root = process.cwd();
const results = scanRepo(root);
const total = [...results.values()].reduce((n, v) => n + v.length, 0);

if (total > 0) {
  console.error(formatReport(results));
  console.error(
    `\ntheme token guard: ${total} violation(s) across ${results.size} file(s) outside the allowlist`,
  );
  process.exit(1);
}

console.log(
  `theme token guard: 0 violations outside the allowlist (${ALLOWLIST.length} file(s) still exempt)`,
);
