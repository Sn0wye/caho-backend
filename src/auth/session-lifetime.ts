// Sessions live 30 days and renew once past the halfway mark, mirroring the
// validateSessionToken pattern from the Lucia v3 migration guide. Replaces the
// old lucia `TimeSpan(30, 'd')` + built-in renewal.

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const RENEWAL_THRESHOLD_MS = SESSION_DURATION_MS / 2;

export type SessionAssessment = {
  expired: boolean;
  fresh: boolean;
  expiresAt: Date;
};

export function freshExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_DURATION_MS);
}

export function assessSession(expiresAt: Date, now: Date): SessionAssessment {
  if (now.getTime() >= expiresAt.getTime()) {
    return { expired: true, fresh: false, expiresAt };
  }

  const renewDue =
    now.getTime() >= expiresAt.getTime() - RENEWAL_THRESHOLD_MS;

  if (renewDue) {
    return { expired: false, fresh: true, expiresAt: freshExpiry(now) };
  }

  return { expired: false, fresh: false, expiresAt };
}
