# murva restructure — metrics

## Baseline (recorded before Task 2, 2026-08-24)
- Duplication % (jscpd, min-lines 5): 7.11%
- Total LOC (src, .ts + .tsx): 17742
- files-touched-per-feature (git log): recorded in Task 18

## After (recorded in Task 18)
- Duplication % (jscpd, min-lines 5): 6.92% (1272 duplicated lines of 18,377 analyzed lines, 51 clones)
- Total LOC (src, .ts + .tsx, wc -l): 18352
- files-touched-per-feature (git log): 6.47 files/commit avg (123 files touched across 19 restructure feature commits, be67859..3e08e3a; computed by summing `git show --stat` "N files changed" per commit, excluding the docs-only and metrics commits e4baa2e, 54ecc09, e84a168, 1b1255d)

Note: jscpd's analyzed-line count (18,377) differs from wc -l (18,352); baseline showed the same pattern (17,776 vs 17,742). Percentages are jscpd's own (duplicated lines / analyzed lines).
