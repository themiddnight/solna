<!-- doc-sync: codebase-reference -->
# User Management Domain

The user-management domain contains account-adjacent application services, profile storage integration, band behavior, approval workflow handlers, and user preferences.

Some services sit directly under application or infrastructure because they are integration-oriented and predate the stricter DDD layout. New behavior should prefer explicit application services and keep storage, email, and external integrations in infrastructure.

## Code map

| File | Responsibility |
|---|---|
| `application/BandApplicationService.ts` | Application-level orchestration for band operations. |
| `application/services/BandService.ts` | Band membership/behavior domain logic. |
| `domain/services/AiSettingsService.ts` | Per-user AI settings read/write. |
| `domain/services/UserPreferencesService.ts` | User preferences logic. |
| `domain/errors/UserPreferencesValidationError.ts` | Validation error type raised by `UserPreferencesService`. |
| `infrastructure/handlers/ApprovalWorkflowHandler.ts` | Socket handler for join-approval workflow. |
| `infrastructure/repositories/UserAiSettingsRepository.ts` · `UserPreferencesRepository.ts` | Prisma persistence for AI settings / preferences. |
| `infrastructure/services/ProfilePictureService.ts` | Profile picture upload/storage (Backblaze B2). |

## Invariants & gotchas

1. **Integration-oriented services may sit outside strict DDD layers** — this is grandfathered; new behavior should prefer explicit `application/` services and keep storage/email/external integrations in `infrastructure/`.
2. **Preferences and AI settings are separate stores** — `UserPreferencesRepository` vs `UserAiSettingsRepository`; do not merge their persistence.
