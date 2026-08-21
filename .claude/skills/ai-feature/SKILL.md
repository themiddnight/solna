---
name: ai-feature
description: AI generation features — OpenAI/Gemini API patterns, job queue for concurrency control, ai-generation domain structure. Read before any AI feature work.
---

# AI Feature Skill

Read every time before working on AI generation features — chord suggestion, melody generation, etc.

**Domain:** `app/backend/src/domains/ai-generation/`

---

## Architecture

```
FE (user request)
  → REST API (POST /api/ai/generate) — synchronous over HTTP
    → Job Queue (per-user + global concurrency control; the request AWAITS its slot)
      → Provider call (OpenAI / Gemini / DeepSeek / GLM, BYOK)
    → Result returned in the SAME HTTP response ({ notes, processedNotes, ops?, rawResponse?, usage? })
```

**Why use a Job Queue:** AI API calls take a long time and have rate limits — the queue serializes/limits concurrent requests (per-user "already have a generation in progress" + a global slot limit). It is **not** an async dispatch mechanism: the handler in `app/backend/src/routes/aiGeneration.ts` calls `aiGenerationService.generate()` and `await`s it to completion, then returns the notes/ops directly. There is no `jobId` returned to the client for the generation result itself, no polling endpoint for the result, and no WebSocket delivery of generated content. (`/ai/queue/cancel` and `/ai/queue/status` exist to cancel/inspect the *in-flight* request, not to fetch an async result.)

---

## Domain Structure

```
domains/ai-generation/
├── domain/
│   └── services/       ← AiJobQueueService, AiGenerationService (no models/ dir)
└── infrastructure/
    └── ...             ← API clients, queue workers
```

---

## AI Providers

All providers are BYOK (bring your own key) — keys are supplied per-user via account settings (`AiSettingsService`), not `.env` globals for end users.

| Provider | Notes |
|---|---|
| **OpenAI** | `OpenAIProvider` |
| **Gemini** | `GeminiProvider` |
| **DeepSeek** | `DeepSeekProvider`, OpenAI-compatible API |
| **GLM** | `GlmProvider`, OpenAI-compatible API |

DeepSeek/GLM/OpenAI share a common `OpenAICompatibleProvider` base (`app/backend/src/domains/ai-generation/infrastructure/providers/OpenAICompatibleProvider.ts`).

---

## Patterns to Follow

### 1. Always Go Through `AiGenerationService` / Job Queue (Do NOT call the provider directly from the route)

```typescript
// ❌ Wrong — direct call from the route, bypasses concurrency control
router.post("/ai/generate", async (req, res) => {
  const result = await openai.chat.completions.create({...});
  res.json(result);
});

// ✅ Correct — route awaits AiGenerationService.generate(), which creates a job,
// waits for a concurrency slot, calls the provider, and returns the result
// SYNCHRONOUSLY in the same HTTP response (see app/backend/src/routes/aiGeneration.ts):
router.post("/ai/generate", authenticateToken, requireRegistered, aiGenerationRateLimiter, async (req, res) => {
  const result = await aiGenerationService.generate(req.user.id, request);
  res.json(result); // { notes, processedNotes, ops?, rawResponse?, usage? }
});
```

The queue gates *when* the provider call happens (one active generation per user + a global slot limit) — it does not change the request/response shape into an async job/poll pattern.

### 2. Edit-Mode Ops Protocol (`mode: 'edit'`)

For editing an existing note set (rather than generating fresh notes), send `mode: 'edit'` with `indexedNotes` (the region's current notes, each with a stable `index`) and `history` (prior chat turns, max 20). The provider returns `NoteEditOp[]` instead of a note array:

```typescript
type NoteEditOp =
  | { op: 'add'; note: AiNoteShape }
  | { op: 'modify'; target: number; set: Partial<AiNoteShape> } // target = index into indexedNotes
  | { op: 'remove'; target: number };
```

Apply ops with the shared `applyNoteEditOps()` helper (`shared/src/ai/noteEditOps.ts`) — `target` always indexes the *original* array sent in the request, so ops are order-independent and safe to apply as a batch.

### 3. Error Handling for AI APIs

```typescript
try {
  const result = await openai.chat.completions.create({...});
} catch (error) {
  if (error.status === 429) {
    // Rate limit — requeue with backoff
  } else if (error.status === 500) {
    // AI provider error — fallback to Gemini or retry
  }
}
```

### 4. Prompt Engineering

- Specify output format clearly (JSON schema)
- Include music context: key, scale, BPM, existing chord progression
- Use low temperature (0.3–0.7) for music theory tasks that require accuracy

---

## Adding a New AI Feature

1. **Module structure** — TR-37 (FE feature modules) / DDD domains (BE); scaffolding checklist in the archived `add-feature` skill ([`../../skills-archive/add-feature/SKILL.md`](../../skills-archive/add-feature/SKILL.md)).
2. **Create** job/result types alongside `domains/ai-generation/domain/services/` (`AiJobQueueService`, `AiGenerationService` — there is no `domain/models/` dir).
3. **Add** worker in `domains/ai-generation/infrastructure/`.
4. **Add** REST endpoint in `app/backend/src/routes/`.
5. **Read** `music-theory` skill if the AI feature relates to music (scales, chords, notes).

---

## Key Constraints

- **DO NOT** expose API keys in client-side code.
- **DO NOT** call AI API directly from the frontend.
- Validation is **numeric clamping only** — there is no Tonal.js / music-theory validation of AI output.
  - Generate mode: `extractValidNotes()` (`domain/utils/AiResponseValidator.ts`) requires `pitch`/`start`/`duration`/`velocity` to be numbers and throws `InvalidAiResponseError` otherwise; numeric clamping (pitch/velocity 0–127 or 1–127, min duration 1/16) happens later in `convertAiNotesToMidiNotes()`.
  - Edit mode: `extractValidOps()` (`domain/utils/AiOpsValidator.ts`) silently **drops** invalid ops instead of throwing — malformed notes/sets are skipped, out-of-range `target` indices are ignored, numeric fields are clamped, and the op list is capped at 256 per turn.
