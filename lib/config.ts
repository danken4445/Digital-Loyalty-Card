import { z } from 'zod';

/**
 * Core shop & business configuration constants.
 * Note: Authoritative enforcement of stamp rules lives in Postgres SQL functions.
 * These TypeScript constants mirror the SQL configuration for display and validation.
 */
export const SHOP_CONFIG = Object.freeze({
  name: 'The Caffeine Plug',
  tagline: 'YOUR DAILY DOSE, STRAIGHT FROM THE PLUG',
  instagramHandle: '@thecaffeineplug8400',
  instagramUrl: 'https://www.instagram.com/thecaffeineplug8400/',
  defaultProductionDomain: 'card.thecaffeineplug.ph',
  currency: 'PHP',
  timezone: 'Asia/Manila',
});

export const STAMP_RULES = Object.freeze({
  /** Stamps required to unlock a free coffee reward (authoritative in SQL) */
  rewardThreshold: 10,
  /** Optional display milestone shown on physical card reference (slot 5) */
  milestoneStep: 5,
  /** Minimum minutes between stamps for the same customer */
  cooldownMinutes: 30,
  /** Maximum stamps a customer can earn per calendar day in Asia/Manila */
  dailyCap: 2,
  /** Minimum seconds between stamps across any customer on the same physical NFC tag */
  tagThrottleSeconds: 5,
});

/**
 * One-time perk for following the shop on Instagram (authoritative once-per-card rule in SQL).
 * Instagram offers no API to check who follows an account, so the barista verifies the follow.
 */
export const INSTAGRAM_PERK = Object.freeze({
  rewardLabel: 'Free upsize on any drink',
  /** localStorage key remembering that the customer opened our profile from the card */
  followOpenedStorageKey: 'tcp_ig_follow_opened',
});

export const SECURITY_CONFIG = Object.freeze({
  /** Short-lived HMAC redemption QR token validity in seconds (5 minutes) */
  redeemTokenTtlSeconds: 300,
  /** Days before zero-stamp anonymous accounts are eligible for cleanup */
  staleAnonRetentionDays: 30,
  /** Minimum byte/char length for REDEEM_TOKEN_SECRET */
  minRedeemSecretLength: 32,
});

/**
 * Monochrome two-tone streetwear palette inspired by The Caffeine Plug's KAWS-style branding.
 */
export const BRAND_THEME = Object.freeze({
  palette: {
    black: '#0A0A0A',
    white: '#FFFFFF',
    surfaceDark: '#121214',
    surfaceElevated: '#1C1C1F',
    contourLine: '#27272A',
    mutedText: '#A1A1AA',
  },
  assets: {
    logoCircleDark: '/brand/logo-circle-dark.png',
    logoCircleLight: '/brand/logo-circle-light.png',
    mascotFull: '/brand/mascot-full.png',
    loyaltyCardReference: '/brand/loyalty-card-reference.png',
  },
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).default('1x00000000000000000000AA'),
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDEEM_TOKEN_SECRET: z.string().min(SECURITY_CONFIG.minRedeemSecretLength),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates and returns public environment variables safe for client and server.
 */
export function getPublicEnv(envSource?: Record<string, string | undefined>): PublicEnv {
  const source = envSource ?? {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  };
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      source.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA',
  });
}

/**
 * Validates and returns server-only secrets. Never call this from client components.
 */
export function getServerEnv(
  envSource: Record<string, string | undefined> = process.env,
): ServerEnv {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SITE_URL: envSource.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: envSource.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: envSource.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      envSource.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA',
    SUPABASE_SERVICE_ROLE_KEY: envSource.SUPABASE_SERVICE_ROLE_KEY,
    REDEEM_TOKEN_SECRET: envSource.REDEEM_TOKEN_SECRET,
    TURNSTILE_SECRET_KEY: envSource.TURNSTILE_SECRET_KEY,
    UPSTASH_REDIS_REST_URL: envSource.UPSTASH_REDIS_REST_URL || undefined,
    UPSTASH_REDIS_REST_TOKEN: envSource.UPSTASH_REDIS_REST_TOKEN || undefined,
  });
}
