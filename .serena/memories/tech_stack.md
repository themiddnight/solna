# Tech Stack

> Thin pointer — source of truth: CLAUDE.md §1 (stack list), §11 (environment & infra)

- Frontend: React + TypeScript + Zustand + Tone.js + WebRTC + TanStack Query + Tailwind v4 + daisyUI v5
- Backend: Node.js + Express + Prisma + Socket.IO + Redis + WebRTC signaling
- DB: PostgreSQL (Railway; local dev = local Postgres `collab_dev`)
- Cache: Redis (Railway)
- Storage: Backblaze B2
- Email: Resend. AI: OpenAI + Gemini (job queue)
- Test runners: backend = Jest; shared = `bun test`; E2E = Playwright

Full details: CLAUDE.md §11 (environment vars, SSL, dev credentials, Railway monitoring).
