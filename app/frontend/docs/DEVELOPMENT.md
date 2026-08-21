# Development Guide

Complete guide for developers working on murva Frontend.

---

## 📑 Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Adding New Features](#adding-new-features)
- [Available Scripts](#available-scripts)
- [Configuration](#configuration)
- [Testing](#testing)
- [Code Style](#code-style)

---

## Getting Started

### Prerequisites

- **Node.js 18+** or **Bun** runtime
- Modern web browser with Web Audio API support
- Git for version control

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd app/frontend
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your settings
   ```

4. **Start development server**

   ```bash
   bun dev
   # or
   bun run dev
   ```

5. **Open browser**
   
   Navigate to `https://localhost:5173` (HTTPS is auto-configured via mkcert)

---

## Development Workflow

### HTTPS Development

**Why HTTPS is Required:**
- WebRTC requires secure context for microphone access
- AudioWorklet requires HTTPS in production-like environment
- Service Workers (PWA) require HTTPS

**Auto-Configuration:**
- `vite-plugin-mkcert` automatically generates SSL certificates
- Set `SSL_ENABLED=true` in `.env.local`
- Certificates are trusted by your system

### Hot Module Replacement (HMR)

Vite provides fast HMR for instant feedback:
- React components reload without losing state
- CSS updates instantly
- TypeScript compilation is incremental

### Backend Connection

**Full Stack Setup:**

1. **Start Backend** (in separate terminal):
   ```bash
   cd ../app/backend
   bun install
   cp env.local.example .env.local
   bun run start:dev
   ```
   Backend runs on `https://localhost:3001`

2. **Start Frontend**:
   ```bash
   cd ../app/frontend
   bun dev
   ```
   Frontend runs on `https://localhost:5173`

**Environment Variables:**
```env
VITE_API_URL=https://localhost:3001
VITE_SOCKET_URL=https://localhost:3001
```

---

## Adding New Features

We follow a **Feature-based Architecture**. When adding a new feature that requires backend communication (API or WebSocket), follow these patterns:

### 1. REST API Integration

**Step 1: Add Endpoint URL**

Add your new endpoint path in `src/shared/utils/endpoints.ts`:

```typescript
export const endpoints = {
  // ...existing endpoints
  myFeature: `${apiURL}/my-feature`,
};
```

**Step 2: Create Service**

Create an API service file in your feature directory (e.g., `src/features/my-feature/services/api.ts`):

```typescript
import axiosInstance from "@/shared/utils/axiosInstance";
import { endpoints } from "@/shared/utils/endpoints";

export const fetchMyData = async () => {
  const response = await axiosInstance.get(endpoints.myFeature);
  return response.data;
};

export const createMyData = async (data: MyDataType) => {
  const response = await axiosInstance.post(endpoints.myFeature, data);
  return response.data;
};
```

**Step 3: Use in Component**

```typescript
import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchMyData, createMyData } from "../services/api";

function MyComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ["myFeature"],
    queryFn: fetchMyData,
  });

  const mutation = useMutation({
    mutationFn: createMyData,
    onSuccess: () => {
      // Handle success
    },
  });

  // ...
}
```

### 2. WebSocket Integration

**Step 1: Create Context & Provider**

Manage socket connections within a specific feature context:

```
src/features/my-feature/contexts/
├── MySocketContext.tsx  # Context definition
└── MySocketProvider.tsx # Connection logic
```

**Step 2: Implement Provider**

```typescript
// src/features/my-feature/contexts/MySocketProvider.tsx
import { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

interface MySocketContextType {
  socket: Socket | null;
}

const MySocketContext = createContext<MySocketContextType>({ socket: null });

export const MySocketProvider = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io(import.meta.env.VITE_API_URL, {
      path: '/socket.io',
      auth: { token: localStorage.getItem('auth_token') }
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <MySocketContext.Provider value={{ socket }}>
      {children}
    </MySocketContext.Provider>
  );
};

export const useMySocket = () => useContext(MySocketContext);
```

**Step 3: Use in Component**

```typescript
import { useMySocket } from "../contexts/MySocketProvider";

function MyComponent() {
  const { socket } = useMySocket();

  useEffect(() => {
    if (!socket) return;

    socket.on("my-event", (data) => {
      console.log("Received:", data);
    });

    return () => {
      socket.off("my-event");
    };
  }, [socket]);

  const sendData = () => {
    socket?.emit("my-action", { data: "example" });
  };

  // ...
}
```

### 3. Recommended File Structure

```
src/features/<feature-name>/
├── services/
│   └── api.ts           # API functions
├── contexts/
│   ├── SocketContext.tsx
│   └── SocketProvider.tsx
├── hooks/               # Custom hooks using API/Socket
│   ├── useMyData.ts
│   └── useMySocketEvents.ts
├── stores/              # Zustand stores (if needed)
│   └── myFeatureStore.ts
├── components/          # UI Components
│   ├── MyComponent.tsx
│   └── MyOtherComponent.tsx
├── types/               # TypeScript types
│   └── index.ts
└── utils/               # Utility functions
    └── helpers.ts
```

---

## Available Scripts

### Development

- **`bun dev`** - Start development server with automatic HTTPS via `mkcert`
- **`bun build`** - TypeScript compilation + Vite production build
- **`bun preview`** - Preview production build locally

### Code Quality

- **`bun lint`** - Run ESLint with React hooks rules
- **`bun lint --fix`** - Auto-fix linting issues
- **`bun format`** - Format code with Prettier

### Testing

- **`bun test`** - Run test suite in watch mode
- **`bun test:run`** - Run tests once (CI mode)
- **`bun test:ui`** - Run tests with interactive UI dashboard
- **`bun test:coverage`** - Generate detailed coverage reports
- **`bun test:regression`** - Run regression tests only

### Internationalization (i18n)

- **`bun run i18n:extract`** - Scan `src/` for Lingui macros and write new message IDs into every `messages.po`
- **`bun run i18n:compile`** - Compile `.po` catalogs → runtime `.js` (also runs automatically at the start of `bun build`)

See [`I18N.md`](I18N.md) for the full workflow, usage patterns, and the `no-literal-string` lint gate (TR-35).

### Git Hooks

- **`bun prepare`** - Install Husky git hooks (runs automatically after install)

**Pre-commit Hook:**
- Runs linting on staged files
- Prevents commits with linting errors

---

## ✅ Definition of Done

When implementing or modifying features, you **MUST** ensure the following steps are completed before considering the task done. This applies to both human and AI agents.

### 1. Update Tests
- [ ] **Unit Tests**: Update or add unit tests for new components/logic.
- [ ] **Integration Tests**: Ensure the feature works correctly with other parts of the system.
- [ ] **Regression Tests**: If fixing a bug, add a regression test to prevent recurrence.

### 2. Update Documentation
- [ ] **Architecture**: Update `docs/ARCHITECTURE.md` if the system design or data flow changed.
- [ ] **README**: Update project README if setup instructions or key features changed.

### 2.5 Localize User-Facing Strings (TR-35)
- [ ] All new UI text wrapped in Lingui macros (`<Trans>` / `` t`...` ``) — no bare literals.
- [ ] Ran `bun run i18n:extract`, added Thai translations in `src/locales/th/messages.po`, then `bun run i18n:compile`.
- [ ] Committed both the `.po` and regenerated `.js` catalogs.

### 3. Verification
- [ ] All tests pass: `bun test`
- [ ] Linting passes: `bun lint`
- [ ] Build succeeds: `bun build`

---

## Configuration

### Environment Variables

Create `.env.local` from the example file:

```bash
cp .env.example .env.local
```

**Required Variables:**

```env
VITE_API_URL=https://localhost:3001   # Backend API URL (HTTPS required for WebRTC)
```

**Optional Variables:**

```env
# Socket.IO (defaults to VITE_API_URL if not set)
VITE_SOCKET_URL=https://localhost:3001

# SSL Configuration
SSL_ENABLED=true                      # Enable HTTPS in development

# Landing Page URL
VITE_LANDINGPAGE_URL=https://localhost:3002

# User Feedback Prompts
VITE_FEEDBACK_PROMPT_DELAY_SEC=300    # Delay before showing feedback prompt (default: 300s)
VITE_FEEDBACK_REMIND_DELAY_SEC=43200  # Cooldown before showing again (default: 12 hours)
```

### Vite Configuration

**Key Settings in `vite.config.ts`:**

```typescript
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mkcert(), // Auto HTTPS
    VitePWA({ /* PWA config */ })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
```

### TypeScript Configuration

**Multiple tsconfig files for different contexts:**

- `tsconfig.json` - Base configuration
- `tsconfig.app.json` - Application code
- `tsconfig.node.json` - Node.js scripts (vite.config.ts)
- `tsconfig.test.json` - Test files

---

## Testing

### Test Framework

**Stack:**
- **Vitest** - Fast unit test runner (Vite-native)
- **Testing Library** - React component testing
- **jsdom** - DOM environment for tests

### Running Tests

```bash
# Watch mode (default)
bun test

# Run once (CI)
bun test:run

# With UI dashboard
bun test:ui

# Coverage report
bun test:coverage

# Regression tests only
bun test:regression
```

### Writing Tests

**Example Component Test:**

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const { user } = render(<MyComponent />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Clicked')).toBeInTheDocument();
  });
});
```

**Example Store Test:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useMyStore } from './myStore';

describe('myStore', () => {
  beforeEach(() => {
    useMyStore.getState().reset();
  });

  it('updates state correctly', () => {
    const { setState } = useMyStore.getState();
    setState({ value: 42 });
    expect(useMyStore.getState().value).toBe(42);
  });
});
```

### Test Coverage

**Current Coverage (as of latest run):**
- 67 test files
- 896 tests (1 skipped)
- All tests passing

**Coverage Goals:**
- Critical paths: 80%+
- Utilities: 90%+
- Components: 70%+

---

## Code Style

### ESLint Configuration

**Rules enforced:**
- React Hooks rules
- TypeScript strict mode (`@typescript-eslint/no-explicit-any` enforced as `error`)
- Import ordering
- No unused variables

**Run linting:**
```bash
bun lint
bun lint --fix  # Auto-fix issues
```

### Prettier Configuration

**Formatting rules:**
- 2 spaces indentation
- Single quotes
- Trailing commas
- Import sorting via `@trivago/prettier-plugin-sort-imports`

**Run formatting:**
```bash
bun format
```

### Import Organization

**Order:**
1. React imports
2. Third-party libraries
3. Internal absolute imports (`@/...`)
4. Relative imports
5. Type imports

**Example:**
```typescript
import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

import { useAuth } from '@/features/auth';
import { Button } from '@/shared/components';

import { MyLocalComponent } from './MyLocalComponent';
import type { MyType } from './types';
```

### Naming Conventions

**Files:**
- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- Utilities: `camelCase.ts`
- Types: `types.ts` or `index.ts`

**Code:**
- Components: `PascalCase`
- Hooks: `useCamelCase`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

### Component Structure

**Recommended order:**
1. Imports
2. Types/Interfaces
3. Component definition
4. Hooks
5. Event handlers
6. Render logic
7. Export

**Example:**
```typescript
import { useState } from 'react';
import { Button } from '@/shared/components';

interface MyComponentProps {
  title: string;
  onAction: () => void;
}

export const MyComponent = ({ title, onAction }: MyComponentProps) => {
  const [count, setCount] = useState(0);

  const handleClick = () => {
    setCount(prev => prev + 1);
    onAction();
  };

  return (
    <div>
      <h1>{title}</h1>
      <Button onClick={handleClick}>Count: {count}</Button>
    </div>
  );
};
```

---

## Troubleshooting

### Common Development Issues

**Port Already in Use:**
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9
```

**SSL Certificate Issues:**
```bash
# Regenerate certificates
rm -rf node_modules/.vite
bun dev
```

**Module Not Found:**
```bash
# Clear cache and reinstall
rm -rf node_modules bun.lockb
bun install
```

**TypeScript Errors:**
```bash
# Rebuild TypeScript
bun run build
```

### E2E Test & Database Issues

**E2E Tests Skipping or Failing After DB Reset/Staging Dump:**
If the dev database was recently reset, dump-transferred from staging, or is empty, E2E tests will fail during login (as test accounts do not exist) or skip project-ownership tests (as project fixtures are missing from the DB and Backblaze B2).
* **Fix**: Run the E2E seed script from the root workspace or `app/frontend`:
  ```bash
  bun run e2e:seed
  ```
  This script will automatically:
  1. Parse the E2E user credentials defined in your `app/frontend/.env` file.
  2. Create/register those users directly in the database via the backend Prisma client, setting `emailVerified: true` (bypassing verification limitations).
  3. Log in as those E2E users via local API calls and write the required fixture projects (`[E2E] Arrange Base`) to the database and Backblaze B2.

**Missing Audio Files After Database Dump from Staging:**
If you dump-transferred the database from staging to dev, the database records will exist in dev but the corresponding audio/project files in the dev Backblaze B2 bucket might be missing (causing file load errors).
* **Fix**: You can perform a true sync of files from the staging B2 bucket to the dev B2 bucket:
  1. Open `app/backend/.env`.
  2. Locate the commented-out environment variables under `# Clone staging bucket to dev` (e.g. `STG_BUCKET_ACCESS_KEY_ID`, `STG_BUCKET_SECRET_ACCESS_KEY`, `STG_BUCKET_BUCKET_NAME`).
  3. Uncomment them and execute the sync script from the root workspace:
     ```bash
     bun run sync:b2:stg2dev
     ```
  4. Once synced, you can comment those variables out again to keep the environment clean.

**Database Reset Prohibited (TR-25):**
* ❌ **Never run `prisma migrate reset` or `prisma db push --force-reset` on the dev database.** This deletes all custom test data and accumulated E2E credentials that cannot be easily restored. If a migration fails, consult the owner.


### Debug Tips

1. **Check browser console** for errors
2. **Verify backend connection**: Open `https://localhost:3001/health`
3. **Test audio context**: Run `new AudioContext().state` in console
4. **Check WebSocket**: Look for Socket.IO connection in Network tab
5. **Use React DevTools** for component debugging
6. **Use Zustand DevTools** for state debugging

