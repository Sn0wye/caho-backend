# pino-seq + Seq Docker Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `pino-seq` into the Fastify app so logs ship to a local Seq instance (run via Docker Compose) when `SEQ_URL` is set, while keeping console output working.

**Architecture:** A new `src/lib/logger.ts` factory builds the Pino logger; when `SEQ_URL` is present it combines `@fastify/one-line-logger` (console) with `pino-seq`'s `createStream()` via `pino.multistream()`; the result is passed directly to Fastify. The Seq container lives in `docker-compose.yml` on the `caho` network.

**Tech Stack:** Fastify v4, Pino, `pino-seq` (Datalust), Docker Compose, Vitest, TypeScript, `@t3-oss/env-core`.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Create** | `src/lib/logger.ts` | `buildLogger()` factory; exports `logger` + `seqStream` |
| **Create** | `src/lib/logger.test.ts` | Unit tests for factory logic |
| **Modify** | `src/env.ts` | Add optional `SEQ_URL` + `SEQ_API_KEY` fields |
| **Modify** | `src/app.ts` | Use imported `logger`, add `onClose` flush hook |
| **Modify** | `docker-compose.yml` | Add `seq` service, `seq_data` volume, `SEQ_URL` to caho-api |
| **Modify** | `.env.example` | Document `SEQ_URL` as optional |

---

## Task 1 — Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install `pino` and `pino-seq`**

  ```bash
  pnpm add pino pino-seq
  ```

  Expected: both packages appear under `"dependencies"` in `package.json`.

- [ ] **Step 2: Verify build still compiles**

  ```bash
  pnpm build
  ```

  Expected: exits 0, no new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add package.json pnpm-lock.yaml
  git commit -m "chore: add pino and pino-seq dependencies"
  ```

---

## Task 2 — Extend env schema with `SEQ_URL`

**Files:**
- Modify: `src/env.ts`

- [ ] **Step 1: Add `SEQ_URL` and `SEQ_API_KEY` to env schema**

  Replace the contents of `src/env.ts` with:

  ```ts
  import { createEnv } from '@t3-oss/env-core';
  import { z } from 'zod';

  export const env = createEnv({
    server: {
      PORT: z.coerce.number().default(8081),
      NODE_ENV: z.enum(['production', 'development', 'test']),
      COOKIE_SECRET: z.string().min(1),
      PASSWORD_SECRET: z.string().min(1),
      DATABASE_URL: z.string().min(1),
      REDIS_URL: z.string().min(1),
      GITHUB_CLIENT_ID: z.string().min(1),
      GITHUB_CLIENT_SECRET: z.string().min(1),
      GOOGLE_CLIENT_ID: z.string().min(1),
      GOOGLE_CLIENT_SECRET: z.string().min(1),
      GOOGLE_REDIRECT_URL: z.string().min(1),
      FRONTEND_AUTH_REDIRECT_URL: z.string().min(1),
      SEQ_URL: z.string().url().optional(),
      SEQ_API_KEY: z.string().optional(),
    },
    runtimeEnv: process.env
  });
  ```

- [ ] **Step 2: Verify types are correct**

  ```bash
  pnpm typecheck
  ```

  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/env.ts
  git commit -m "feat(env): add optional SEQ_URL and SEQ_API_KEY fields"
  ```

---

## Task 3 — Create `src/lib/logger.ts` (TDD)

**Files:**
- Create: `src/lib/logger.test.ts`
- Create: `src/lib/logger.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/lib/logger.test.ts`:

  ```ts
  import { describe, expect, it, vi, beforeEach } from 'vitest';

  vi.mock('pino', async () => {
    const mockStream = { write: vi.fn(), flush: vi.fn() };
    const mockLogger = { level: 'info', child: vi.fn() };
    const mockFn = vi.fn(() => mockLogger) as any;
    mockFn.transport = vi.fn(() => mockStream);
    mockFn.multistream = vi.fn(() => mockStream);
    return { default: mockFn };
  });

  vi.mock('pino-seq', () => ({
    createStream: vi.fn(() => ({ write: vi.fn(), flush: vi.fn() })),
  }));

  describe('buildLogger', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns null seqStream when seqUrl is undefined', async () => {
      const { buildLogger } = await import('./logger');
      const { seqStream } = buildLogger(undefined);
      expect(seqStream).toBeNull();
    });

    it('returns a seqStream when seqUrl is provided', async () => {
      const { createStream } = await import('pino-seq');
      const { buildLogger } = await import('./logger');
      const { seqStream } = buildLogger('http://localhost:5341');
      expect(seqStream).not.toBeNull();
      expect(createStream).toHaveBeenCalledWith({ serverUrl: 'http://localhost:5341' });
    });

    it('calls pino.multistream when seqUrl is provided', async () => {
      const pino = (await import('pino')).default;
      const { buildLogger } = await import('./logger');
      buildLogger('http://localhost:5341');
      expect(pino.multistream).toHaveBeenCalledOnce();
    });

    it('does NOT call pino.multistream when seqUrl is absent', async () => {
      const pino = (await import('pino')).default;
      const { buildLogger } = await import('./logger');
      buildLogger(undefined);
      expect(pino.multistream).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm test --reporter=verbose src/lib/logger.test.ts
  ```

  Expected: 4 failures — `buildLogger` is not defined.

- [ ] **Step 3: Implement `src/lib/logger.ts`**

  Create `src/lib/logger.ts`:

  ```ts
  import pino from 'pino';
  import { createStream } from 'pino-seq';
  import { env } from '@/env';

  type SeqStream = ReturnType<typeof createStream>;

  export function buildLogger(seqUrl?: string): {
    logger: pino.Logger;
    seqStream: SeqStream | null;
  } {
    const consoleTransport = pino.transport({
      target: '@fastify/one-line-logger'
    });

    if (seqUrl) {
      const seqStream = createStream({ serverUrl: seqUrl });
      const logger = pino(
        { level: 'info' },
        pino.multistream([
          { stream: consoleTransport },
          { stream: seqStream as unknown as NodeJS.WritableStream }
        ])
      );
      return { logger, seqStream };
    }

    return {
      logger: pino({ level: 'info' }, consoleTransport),
      seqStream: null
    };
  }

  export const { logger, seqStream } = buildLogger(env.SEQ_URL);
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm test --reporter=verbose src/lib/logger.test.ts
  ```

  Expected: 4 passing.

- [ ] **Step 5: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/logger.ts src/lib/logger.test.ts
  git commit -m "feat(logger): add buildLogger factory with optional pino-seq transport"
  ```

---

## Task 4 — Update `src/app.ts` to use the new logger

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Replace inline transport config with imported logger**

  In `src/app.ts`:

  1. Add this import near the top (after existing imports):
     ```ts
     import { logger, seqStream } from './lib/logger';
     ```

  2. Replace:
     ```ts
     export const app = fastify({
       logger: {
         transport: {
           target: '@fastify/one-line-logger'
         }
       }
     }).withTypeProvider<ZodTypeProvider>();
     ```
     With:
     ```ts
     export const app = fastify({
       logger
     }).withTypeProvider<ZodTypeProvider>();
     ```

  3. Add the `onClose` flush hook directly after the `app` declaration:
     ```ts
     app.addHook('onClose', async () => {
       await seqStream?.flush();
     });
     ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: exits 0.

- [ ] **Step 3: Start the dev server and verify console logs still appear**

  ```bash
  pnpm dev
  ```

  Expected: one-line log output appears in terminal as before. No errors about
  missing transports or streams. Ctrl-C to stop.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app.ts
  git commit -m "feat(app): use logger factory; flush pino-seq stream on close"
  ```

---

## Task 5 — Add Seq to `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add `seq` service, `seq_data` volume, and `SEQ_URL` to caho-api**

  Final `docker-compose.yml`:

  ```yaml
  version: '3.8'

  networks:
    caho:
      driver: bridge

  services:
    redis:
      image: redis:latest
      container_name: caho-redis
      restart: always
      ports:
        - '6379:6379'
      environment:
        REDIS_PASSWORD: ${REDIS_PASSWORD}
      command: ['redis-server', '--requirepass', '${REDIS_PASSWORD}']
      healthcheck:
        test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD}', 'ping']
        interval: 10s
        timeout: 5s
        retries: 5

    postgres:
      image: postgres:16
      container_name: caho-postgres
      restart: always
      environment:
        POSTGRES_USER: ${DATABASE_USER}
        POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
      ports:
        - '5432:5432'
      volumes:
        - postgres_data:/var/lib/postgresql/data
      healthcheck:
        test: ['CMD', 'pg_isready', '-U', '${DATABASE_USER}']
        interval: 10s
        timeout: 5s
        retries: 5

    seq:
      image: datalust/seq:latest
      container_name: caho-seq
      restart: unless-stopped
      environment:
        ACCEPT_EULA: Y
      ports:
        - '5341:80'
      volumes:
        - seq_data:/data
      networks:
        - caho

    caho-api:
      image: ghcr.io/sn0wye/caho-api:prod
      restart: unless-stopped
      env_file: ./caho.env
      environment:
        SEQ_URL: http://seq:5341
      healthcheck:
        test: ['CMD', 'curl', '-f', 'http://localhost:8081/readyz']
        interval: 10s
        timeout: 5s
        retries: 5
        start_period: 15s
      ports:
        - '8081:8081'
      networks:
        - caho
      depends_on:
        - postgres
        - redis
        - seq

  volumes:
    postgres_data:
    seq_data:
  ```

- [ ] **Step 2: Pull the Seq image and verify compose is valid**

  ```bash
  docker compose config
  ```

  Expected: validated YAML output, no errors.

  ```bash
  docker compose pull seq
  ```

  Expected: `datalust/seq:latest` pulled successfully.

- [ ] **Step 3: Start Seq alone and verify the UI is reachable**

  ```bash
  docker compose up seq -d
  ```

  Open `http://localhost:5341` in a browser.
  Expected: Seq web UI loads (no login required — anonymous mode).

  ```bash
  docker compose stop seq
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add docker-compose.yml
  git commit -m "feat(docker): add Seq service with named volume and caho network"
  ```

---

## Task 6 — Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add `SEQ_URL` documentation**

  Append to `.env.example`:

  ```
  # Seq — structured log shipping (optional)
  # Set to enable pino-seq transport. Omit or leave blank to disable.
  # In docker compose, caho-api sets this automatically to http://seq:5341
  SEQ_URL=
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .env.example
  git commit -m "docs(env): document optional SEQ_URL variable"
  ```

---

## Task 7 — End-to-end smoke test

No code changes — verification only.

- [ ] **Step 1: Start the full stack**

  ```bash
  docker compose up -d
  ```

  Expected: all 4 services (redis, postgres, seq, caho-api) reach healthy/running state.

  ```bash
  docker compose ps
  ```

  Expected: all containers show `Up` or `healthy`.

- [ ] **Step 2: Trigger a log event**

  ```bash
  curl http://localhost:8081/readyz
  ```

  Expected: `200 OK`.

- [ ] **Step 3: Verify the event appears in Seq**

  Open `http://localhost:5341`.
  Expected: the GET `/readyz` request log event is visible in the Seq stream.

- [ ] **Step 4: Tear down**

  ```bash
  docker compose down
  ```
