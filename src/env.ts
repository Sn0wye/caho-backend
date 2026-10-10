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
    SEQ_URL: z.string().url().optional(),
    SEQ_API_KEY: z.string().min(1).optional()
  },
  runtimeEnv: {
    ...process.env,
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || undefined,
    SEQ_URL: process.env.SEQ_URL || undefined,
    SEQ_API_KEY: process.env.SEQ_API_KEY || undefined
  }
});
