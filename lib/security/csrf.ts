import 'server-only';

export type SameOriginCheckResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: 'cross-origin-blocked';
    };

function extractHostFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return null;
  }
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Verifies that a state-changing request (POST, PUT, PATCH, DELETE) originates
 * from the same origin as the application.
 *
 * Defense-in-depth alongside `SameSite=Lax` cookies:
 * 1. Rejects requests with `Sec-Fetch-Site: cross-site`.
 * 2. Rejects requests with `Origin: null` (sandboxed / data: / cross-origin redirects).
 * 3. When `Origin` or `Referer` is present, requires its host to match the request URL host,
 *    the `Host` / `X-Forwarded-Host` header, or `NEXT_PUBLIC_SITE_URL`.
 */
export function verifySameOriginRequest(request: Request): SameOriginCheckResult {
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return {
      allowed: false,
      reason: 'cross-origin-blocked',
    };
  }

  const rawOrigin = request.headers.get('origin');
  const rawReferer = request.headers.get('referer');

  // Explicit "Origin: null" is sent by sandboxed iframes or cross-origin redirects
  if (rawOrigin !== null && rawOrigin.trim().toLowerCase() === 'null') {
    return {
      allowed: false,
      reason: 'cross-origin-blocked',
    };
  }

  // If neither Origin nor Referer is present, allow (e.g., server-side fetch / unit test Request)
  if (!rawOrigin && !rawReferer) {
    return { allowed: true };
  }

  const candidateHost = rawOrigin ? extractHostFromUrl(rawOrigin) : extractHostFromUrl(rawReferer);

  if (!candidateHost) {
    return {
      allowed: false,
      reason: 'cross-origin-blocked',
    };
  }

  const allowedHosts = new Set<string>();

  const requestUrlHost = extractHostFromUrl(request.url);
  if (requestUrlHost) {
    allowedHosts.add(requestUrlHost);
  }

  const headerHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (headerHost) {
    const firstHeaderHost = headerHost.split(',')[0]?.trim().toLowerCase();
    if (firstHeaderHost) {
      allowedHosts.add(firstHeaderHost);
    }
  }

  const siteUrlHost = extractHostFromUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (siteUrlHost) {
    allowedHosts.add(siteUrlHost);
  }

  if (!allowedHosts.has(candidateHost)) {
    return {
      allowed: false,
      reason: 'cross-origin-blocked',
    };
  }

  return { allowed: true };
}
