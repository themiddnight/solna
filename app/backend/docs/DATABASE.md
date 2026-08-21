# Database Schema

This document describes the database schema for the murva application, including entity-relationship diagrams, core models, and user tiers.

## Table of Contents

- [ER Diagram](#er-diagram)
- [Core Models](#core-models)
- [User Tiers & Business Model](#user-tiers--business-model)
- [Enums](#enums)

---

## ER Diagram

```mermaid
erDiagram
    User ||--o{ SavedProject : "creates"
    User ||--o{ BandMember : "has"
    User ||--o{ ProjectContributor : "contributes to"
    User ||--o| UserAiSettings : "has settings"
    User ||--o| UserPreferences : "has preferences"
    User ||--o{ UserPreset : "creates"
    User ||--o{ RefreshToken : "has tokens"
    User ||--o{ OAuthAccount : "has OAuth accounts"
    User ||--o{ EmailVerification : "has verifications"
    User ||--o{ PasswordReset : "has resets"
    
    Band ||--o{ BandMember : "has members"
    Band }o--o{ SavedProject : "shared with (many-to-many)"
    
    SavedProject ||--o{ ProjectContributor : "has contributors"
    SavedProject ||--o{ SavedProject : "forked from"
    
    User {
        uuid id PK
        string email "nullable, unique"
        string username "nullable"
        string passwordHash "nullable"
        string profilePictureUrl "nullable"
        boolean emailVerified
        UserType userType
        UserRole role
        datetime onboardingTourPromptedAt "nullable — first time the onboarding tour was auto-offered; gates the auto-toast"
        datetime createdAt
        datetime updatedAt
    }
    
    Band {
        uuid id PK
        string name
        string description "nullable"
        string inviteToken UK
        datetime createdAt
        datetime updatedAt
    }
    
    BandMember {
        uuid id PK
        uuid bandId FK
        uuid userId FK
        BandRole role
        datetime joinedAt
    }
    
    SavedProject {
        uuid id PK
        string name
        string roomType
        string description "nullable"
        json metadata "nullable"
        ProjectVisibility visibility
        boolean allowFork "default: false"
        boolean isLocked "default: false"
        json forkChain "nullable"
        uuid userId FK
        uuid forkedFromId FK "nullable"
        datetime createdAt
        datetime updatedAt
    }
    
    ProjectContributor {
        uuid id PK
        uuid projectId FK
        uuid userId FK
        datetime lastContributedAt
    }
    
    UserAiSettings {
        uuid id PK
        uuid userId FK UK
        string provider
        boolean enabled
        string apiKeyHash "nullable"
        json settings "nullable"
        datetime updatedAt
    }
    
    UserPreferences {
        uuid id PK
        uuid userId FK UK
        string theme "default: dark"
        json settings "nullable"
        datetime updatedAt
    }
    
    UserPreset {
        uuid id PK
        uuid userId FK
        string name
        PresetType presetType
        jsonb data
        datetime createdAt
        datetime updatedAt
    }
    
    RefreshToken {
        uuid id PK
        uuid userId FK
        string token UK
        datetime expiresAt
        datetime revokedAt "nullable"
        datetime createdAt
    }
    
    OAuthAccount {
        uuid id PK
        uuid userId FK
        string provider
        string providerId
        datetime createdAt
    }
    
    EmailVerification {
        uuid id PK
        uuid userId FK
        string token UK
        datetime expiresAt
        string otpCodeHash "nullable"
        datetime otpExpiresAt "nullable"
        int attempts "default: 0"
        datetime createdAt
    }
    
    PasswordReset {
        uuid id PK
        uuid userId FK
        string token UK
        datetime expiresAt
        datetime usedAt "nullable"
        string otpCodeHash "nullable"
        datetime otpExpiresAt "nullable"
        int attempts "default: 0"
        datetime createdAt
    }
```

---

## Core Models

| Model | Description | Key Relations |
|-------|-------------|---------------|
| `User` | User accounts (guest/registered/artist/pro) | Has many projects, band memberships, tokens |
| `Band` | Music collaboration groups | Has many members and projects |
| `BandMember` | Band membership (owner/member) | Links User ↔ Band |
| `SavedProject` | Saved room projects with state | Belongs to User. Can be shared with multiple Bands (many-to-many via `bands` relation). Can be forked from other projects (controlled by `allowFork`; exposed as `allowRemix` in API). Can be locked by owner (`isLocked`) to prevent non-owner saves. |
| `ProjectContributor` | Tracks who contributed to projects | Links User ↔ SavedProject |
| `UserAiSettings` | AI provider settings and encrypted keys | One-to-one with User (optional) |
| `UserPreferences` | UI preferences. `theme` is a column; all other preferences live in the `settings` JSON document validated by `shared/src/validation/userPreferencesSchema.ts` (TR-41, `USER_PREFERENCES_SCHEMA_VERSION`) — adding a preference means adding a schema field, never a Prisma migration | One-to-one with User (optional) |
| `UserPreset` | Saved synth/effect presets | Belongs to User |
| `RefreshToken` | JWT refresh tokens | Belongs to User |
| `OAuthAccount` | Google OAuth connections | Belongs to User |
| `EmailVerification` | Email verification tokens | Belongs to User |
| `PasswordReset` | Password reset tokens | Belongs to User |

---

## User Tiers & Business Model

The application implements a tiered access model designed to balance community access with sustainability:

### 1. Guest (Free)

- Access to public **Perform / Arrange Rooms**.
- Record performing audio and mixdown audio projects.
- *Designed for casual jamming and testing the platform.*

### 2. Registered (Free)

- All Guest features.
- Create/Join private & hidden **Perform / Arrange Rooms**.
- Record Perform sessions directly to Arrange projects.
- **Profile Benefits**:
  - Save up to **3 personal projects**.
  - Create **1 Band**.
  - Contribute to public community projects.
- Limited AI Assistant requests.

### 3. Artist (Paid)

- All Registered features.
- **Broadcasting**: Live performance broadcasting to audiences.
- **Expanded Storage**: Save up to **~10 personal projects**.
- **Band Expansion**: Join/Create up to **3 Bands**.
- **Enhanced AI**: Increased AI Assistant request limits.
- **Export**: Ability to export MIDI/Multitrack audio (Pro feature fit for serious users).

### 4. Pro (Paid)

- All Artist features.
- **Unlimited Personal Projects** (Fair Use Policy: ~50GB storage).
- **Unlimited Band Association**: For producers working with many bands.
- **Max AI**: Highest tier of AI Assistant requests.

### 5. Band Add-on (Paid)

- Pays to upgrade the *space* shared by the band.
- **Unlimited Tracks**: Projects in this band have no track limit.
- **Multitrack Export**: Members of the band can export multitracks.

> **Note**: User tiers and limits are to be implemented in the future. Current implementation focuses on core functionality.

---

## Enums

| Enum | Values | Description |
|------|--------|-------------|
| `UserType` | `REGISTERED`, `ARTIST`, `PRO` | Account type (tiers) - Note: Guests are unauthenticated users (no UserType) |
| `UserRole` | `USER`, `ADMIN`, `SUPER_ADMIN` | System role |
| `BandRole` | `OWNER`, `MEMBER` | Band membership role |
| `ProjectVisibility` | `PRIVATE`, `BAND`, `PUBLIC` | Project visibility |
| `PresetType` | `SYNTH`, `EFFECT`, `SEQUENCER`, `INSTRUMENT` | Preset category |

> **Note:** `MemberRole` (`room_owner`, `band_member`, `audience`) is a room-level runtime concept stored in Redis, not a Prisma enum. It is defined as a TypeScript type in the shared package and is not persisted to the database.

---

See also:
- [RULES_AND_CONSTRAINTS.md](../../docs/RULES_AND_CONSTRAINTS.md) - For business and technical rules (BR-11: Project Lock)
- [Architecture Documentation](./ARCHITECTURE.md) - System architecture and DDD structure
- [API Reference](../../docs/API_CONTRACT.md) - REST API documentation

---

*Last updated: 2026-08-11 — Added `UserPreferences.settings Json?` (DEV-333 TR-41 preferences document), fixed fork self-relation cardinality (one parent → many forks). Prev 2026-06-11: added missing models (UserPreferences, EmailVerification, PasswordReset), corrected User fields (nullable email/username/passwordHash), fixed SavedProject fields (added roomType/metadata, removed non-existent projectData), corrected RefreshToken (added revokedAt), fixed OAuthAccount (removed non-existent updatedAt), corrected MemberRole note (Redis-only, not a Prisma enum).*
