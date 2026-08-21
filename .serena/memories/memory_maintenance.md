# Memory Maintenance

> Serena-specific — this memory is the only one with no CLAUDE.md equivalent

## Thin-pointer policy

Serena memories MUST NOT duplicate content from CLAUDE.md or docs/. Each memory is a navigation aid pointing to the authoritative source. When a convention changes, only the git-tracked source needs updating — Serena memories stay valid as long as section numbers don't shift.

## Discovery Model

- Core principle: progressive discovery through references, building a graph of memories.
- Agents read `mem:core` as the top-level entry point (graph root).
- Use topics/folders to group related memories.
- Memory references use `mem:` prefix inside backticks, e.g. `mem:frontend/core`.

## Style

Dense agent notes, not prose docs. Prefer invariants, terse bullets.
Avoid obvious context, rationale, and examples unless they prevent likely mistakes.

## Add/update threshold

Add or update memories only with stable, non-obvious project conventions that avoid complex rediscovery.
Do not add: quick-read facts; generic language/framework knowledge; one-off task notes; volatile line-level details; behavior likely to change soon.
Do not add: anything already in CLAUDE.md or docs/ — add a pointer instead.