// CSRF origin check, ported from lucia's removed `verifyRequestOrigin`. Compares
// the request Origin host against an allow-list of hosts. An allowed entry may be
// a bare host ("caho.app") or include a port ("localhost:3000").

function hostOf(value: string): string | null {
  try {
    // `new URL("localhost:3000")` parses "localhost" as a scheme and yields an
    // empty host, so only trust a parsed host when it's actually populated.
    const host = new URL(value).host;
    if (host) {
      return host.toLowerCase();
    }
  } catch {
    // fall through to the bare-host path below
  }

  // Bare host (no scheme) — accept "host" or "host:port" as-is.
  return /^[^/?#\s]+$/.test(value) ? value.toLowerCase() : null;
}

export function verifyRequestOrigin(
  origin: string,
  allowedHosts: string[]
): boolean {
  if (!origin || allowedHosts.length === 0) {
    return false;
  }

  const originHost = hostOf(origin);
  if (!originHost) {
    return false;
  }

  return allowedHosts.some(allowed => hostOf(allowed) === originHost);
}
