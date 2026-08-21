---
name: api-endpoint
description: How to add a new REST API endpoint in the backend — route registration, controller pattern, validation, authentication middleware.
---

# Adding a New REST API Endpoint

This skill covers creating new HTTP endpoints in the murva backend.

## Architecture

```
Express Router (src/routes/)
  → Middleware (auth, validation, rate limit)
    → Controller (infrastructure/controllers/)
      → Application Service (application/)
        → Repository (infrastructure/repositories/) → Prisma
```

## Step-by-Step

### 1. Define Route

**Option A: Add to existing route file**

Routes are in `app/backend/src/routes/`. Pick the appropriate file:
- `auth.ts` — Authentication endpoints
- `projects.ts` — Project CRUD, fork, community
- `bands.ts` — Band management, invites
- `userPresets.ts` — User presets and settings
- `performance.ts` — Performance monitoring

```typescript
// Example: Adding to an existing route file (e.g., projects.ts)
router.get('/projects/:id/stats', authenticateToken, async (req, res) => {
  // handler logic
});
```

**Option B: Create a new route file**

```typescript
// app/backend/src/routes/myFeature.ts
import { Router } from 'express';
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  // ...
});

export default router;
```

Then register in `app/backend/src/routes/index.ts`:

```typescript
import myFeatureRoutes from './myFeature';
// Inside createRoutes():
router.use('/my-feature', myFeatureRoutes);
```

**Option C: Domain-specific routes**

For domain-specific routes (e.g., AI generation), create routes inside the domain:

```
app/backend/src/domains/<domain>/infrastructure/routes/myRoutes.ts
```

Then import and mount in `src/routes/index.ts`.

### 2. Authentication Middleware

File: `app/backend/src/domains/auth/infrastructure/middleware/authMiddleware.ts`

```typescript
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';

// Requires valid JWT token
router.get('/protected', authenticateToken, handler);

// Optional auth (allows guest access, but attaches user if token present)
router.get('/optional-auth', optionalAuth, handler);

// No auth needed
router.get('/public', handler);
```

The `authenticateToken` middleware attaches `req.user` with `{ id, email, username, userType, role }`.

### 3. Request Validation

File: `app/backend/src/validation/schemas.ts`

Use Zod for request validation:

```typescript
import { z } from 'zod';
import { validateData } from '../validation/schemas';

// Define schema
const mySchema = z.object({
  name: z.string().min(1).max(100),
  value: z.number().min(0).max(100),
  type: z.enum(['typeA', 'typeB']),
});

// In route handler
router.post('/my-endpoint', authenticateToken, (req, res) => {
  const validationResult = validateData(mySchema, req.body);
  if (validationResult.error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request data',
      details: validationResult.error
    });
  }
  req.body = validationResult.value;
  // proceed with validated data...
});
```

### 4. Controller Pattern

For complex endpoints, use a controller class:

```typescript
// app/backend/src/domains/<domain>/infrastructure/controllers/MyController.ts
import { Request, Response } from 'express';

export class MyController {
  constructor(private myService: MyService) {}

  async getItems(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const items = await this.myService.getItems(userId);
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async createItem(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const item = await this.myService.createItem(userId, req.body);
      res.status(201).json({ success: true, data: item });
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}
```

### 5. Repository Pattern (Prisma)

```typescript
// app/backend/src/domains/<domain>/infrastructure/repositories/MyRepository.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class MyRepository {
  async findById(id: string) {
    return prisma.myModel.findUnique({ where: { id } });
  }

  async findByUserId(userId: string) {
    return prisma.myModel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: { userId: string; name: string }) {
    return prisma.myModel.create({ data });
  }
}
```

## Response Format Convention

```typescript
// Success
res.json({ success: true, data: result });
res.status(201).json({ success: true, data: created });

// Error
res.status(400).json({ success: false, message: 'Invalid request data', details: errors });
res.status(401).json({ success: false, message: 'Unauthorized' });
res.status(403).json({ success: false, message: 'Forbidden' });
res.status(404).json({ success: false, message: 'Not found' });
res.status(429).json({ error: 'Too many requests', retryAfter: '1 minute' });
res.status(500).json({ success: false, message: 'Internal server error' });
```

## Rate Limiting

HTTP rate limiting is applied globally via `apiLimiter` in `src/middleware/rateLimit.ts`:
- 500 req/min in development, 200 req/min in production
- HLS endpoints have separate `hlsLimiter` (300 req/min)

## File Upload

For endpoints that accept file uploads, use `multer`:

```typescript
import multer from 'multer';
const upload = multer({ storage: multer.diskStorage({ ... }), limits: { fileSize: 200 * 1024 * 1024 } });

router.post('/upload', authenticateToken, upload.single('file'), handler);
```

## Doc Update (Mandatory)

After adding or modifying any endpoint, update `docs/API_CONTRACT.md` before closing the task.

| Change | What to update in API_CONTRACT.md |
|---|---|
| New endpoint | Add full entry: method, path, auth, request body, response, errors |
| Changed request/response shape | Update the relevant request/response schema |
| Changed auth requirement | Update the Auth column |
| Removed endpoint | Remove the entry and note it in a changelog comment if it was public |
| New error code | Add to the endpoint's error table |

The doc must match the code exactly — field names, types, optional vs required, HTTP status codes.

---

## Reference Files

- Route index: `app/backend/src/routes/index.ts`
- Auth middleware: `app/backend/src/domains/auth/infrastructure/middleware/authMiddleware.ts`
- Validation: `app/backend/src/validation/schemas.ts`
- API docs: `docs/API_CONTRACT.md`
- Example routes: `app/backend/src/routes/projects.ts`, `app/backend/src/routes/bands.ts`
