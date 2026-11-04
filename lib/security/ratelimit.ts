import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimitCheckInput {
  endpoint:
    | 'tap'
    | 'claim'
    | 'cards'
    | 'customers'
    | 'redeem-token'
    | 'instagram-upsize-token'
    | 'staff-redeem'
    | 'staff-stamp'
    | 'staff-tags'
    | 'staff-tenant'
    | 'merge-intent'
    | 'merge'
    | 'delete-customer';
  ip: string | null;
  customerId?: string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

/**
 * Resolves the caller's IP. On Cloudflare Workers `x-forwarded-for` is client-controllable,
 * while `cf-connecting-ip` is set by Cloudflare, so it wins. The first `x-forwarded-for`
 * hop is the local-development fallback.
 */
export function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) {
    return cfIp;
  }
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || null;
}

const WINDOW_MS = 60_000; // 1 minute sliding window
const LIMITS: Record<RateLimitCheckInput['endpoint'], { perIp: number; perCustomer: number }> = {
  tap: { perIp: 60, perCustomer: 30 },
  claim: { perIp: 20, perCustomer: 10 },
  cards: { perIp: 20, perCustomer: 10 },
  customers: { perIp: 30, perCustomer: 20 },
  'redeem-token': { perIp: 30, perCustomer: 15 },
  'instagram-upsize-token': { perIp: 30, perCustomer: 15 },
  'staff-redeem': { perIp: 60, perCustomer: 30 },
  'staff-stamp': { perIp: 60, perCustomer: 30 },
  'staff-tags': { perIp: 30, perCustomer: 20 },
  'staff-tenant': { perIp: 30, perCustomer: 20 },
  'merge-intent': { perIp: 20, perCustomer: 10 },
  merge: { perIp: 20, perCustomer: 10 },
  'delete-customer': { perIp: 10, perCustomer: 5 },
};

// In-memory sliding window store used for local development / unit tests when Upstash Redis is not configured.
const memoryHits = new Map<string, number[]>();

function checkMemoryRateLimit(key: string, maxRequests: number, nowMs: number): RateLimitResult {
  const windowStart = nowMs - WINDOW_MS;
  const existing = memoryHits.get(key) ?? [];
  const active = existing.filter((timestamp) => timestamp > windowStart);

  if (active.length >= maxRequests) {
    memoryHits.set(key, active);
    const oldest = active[0] ?? nowMs;
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetMs: Math.max(0, oldest + WINDOW_MS - nowMs),
    };
  }

  active.push(nowMs);
  memoryHits.set(key, active);

  return {
    allowed: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - active.length),
    resetMs: WINDOW_MS,
  };
}

export function resetMemoryRateLimitStore(): void {
  memoryHits.clear();
}

let cachedUpstashLimiters: Record<string, Ratelimit> | null = null;

function getUpstashLimiter(prefix: string, maxRequests: number): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token || url.includes('your-upstash-redis-instance')) {
    return null;
  }

  if (!cachedUpstashLimiters) {
    cachedUpstashLimiters = {};
  }

  const cacheKey = `${prefix}:${maxRequests}`;
  if (!cachedUpstashLimiters[cacheKey]) {
    const redis = new Redis({ url, token });
    cachedUpstashLimiters[cacheKey] = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxRequests, '60 s'),
      prefix: `caffeine_plug_rl:${prefix}`,
    });
  }

  return cachedUpstashLimiters[cacheKey] ?? null;
}

/**
 * Enforces per-IP and optional per-customer rate limits on public endpoints.
 * Note: Coffee shop customers may share the shop Wi-Fi IP, so per-IP thresholds
 * are generous enough for shared shop Wi-Fi while per-customer limits stay tight.
 */
export async function checkPublicEndpointRateLimit(
  input: RateLimitCheckInput,
  nowMs: number = Date.now(),
): Promise<RateLimitResult> {
  const config = LIMITS[input.endpoint];
  const normalizedIp = (input.ip?.split(',')[0]?.trim() || '127.0.0.1').slice(0, 64);
  const ipKey = `${input.endpoint}:ip:${normalizedIp}`;

  const ipUpstash = getUpstashLimiter(`${input.endpoint}:ip`, config.perIp);
  const ipResult = ipUpstash
    ? await ipUpstash.limit(normalizedIp).then((r) => ({
        allowed: r.success,
        limit: r.limit,
        remaining: r.remaining,
        resetMs: Math.max(0, r.reset - nowMs),
      }))
    : checkMemoryRateLimit(ipKey, config.perIp, nowMs);

  if (!ipResult.allowed) {
    return ipResult;
  }

  if (input.customerId) {
    const customerKey = `${input.endpoint}:cust:${input.customerId}`;
    const custUpstash = getUpstashLimiter(`${input.endpoint}:cust`, config.perCustomer);
    const custResult = custUpstash
      ? await custUpstash.limit(input.customerId).then((r) => ({
          allowed: r.success,
          limit: r.limit,
          remaining: r.remaining,
          resetMs: Math.max(0, r.reset - nowMs),
        }))
      : checkMemoryRateLimit(customerKey, config.perCustomer, nowMs);

    if (!custResult.allowed) {
      return custResult;
    }
    return custResult;
  }

  return ipResult;
}
