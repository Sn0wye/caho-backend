import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(8080),
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
    // Parent domain shared with the frontend (e.g. caho.com.br), so the session
    // cookie OAuth callbacks set here also reaches the frontend's server.
    COOKIE_DOMAIN: z.string().min(1).optional(),
    // Reverse proxies between the client and the API (Coolify's Traefik = 1).
    // 0 trusts none; use it when the API is reachable directly.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    // Shared with the frontend's server so it can forward each player's IP for
    // rate limiting (src/http/client-ip.ts). Unset: forwarded IPs are ignored.
    FRONTEND_PROXY_SECRET: z.string().min(32).optional(),
    SEQ_URL: z.string().url().optional(),
    SEQ_API_KEY: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    OTEL_SERVICE_NAME: z.string().min(1).default('caho-backend'),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().optional(),
    OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1),
    OTEL_SDK_DISABLED: z.enum(['true', 'false']).default('false')
  },
  runtimeEnv: {
    ...process.env,
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || undefined,
    FRONTEND_PROXY_SECRET: process.env.FRONTEND_PROXY_SECRET || undefined,
    SEQ_URL: process.env.SEQ_URL || undefined,
    SEQ_API_KEY: process.env.SEQ_API_KEY || undefined,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || undefined
  }
});
