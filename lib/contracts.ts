/**
 * Shared application contracts: result codes, domain models, RPC signatures, and route helpers.
 * Sub-agents code strictly against this contract and MUST NOT modify it.
 */

export const STAMP_RESULT_CODES = [
  'stamped',
  'cooldown',
  'daily-limit',
  'tag-throttled',
  'invalid-tag',
] as const;

export type StampResultCode = (typeof STAMP_RESULT_CODES)[number];

export function isStampResultCode(value: unknown): value is StampResultCode {
  return typeof value === 'string' && (STAMP_RESULT_CODES as readonly string[]).includes(value);
}

export const STAMP_SOURCES = ['nfc', 'manual'] as const;
export type StampSource = (typeof STAMP_SOURCES)[number];

export const STAFF_ROLES = ['staff', 'owner'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const REDEEM_RESULT_CODES = [
  'redeemed',
  'insufficient-stamps',
  'unauthorized',
  'invalid-token',
  'expired-token',
  'already-claimed',
] as const;
export type RedeemResultCode = (typeof REDEEM_RESULT_CODES)[number];

/**
 * What a signed redemption QR token is good for. `free-coffee` spends 10 stamps;
 * `instagram-upsize` is the one-time follow-us-on-Instagram perk and spends no stamps.
 */
export const REDEEM_TOKEN_KINDS = ['free-coffee', 'instagram-upsize'] as const;
export type RedeemTokenKind = (typeof REDEEM_TOKEN_KINDS)[number];

export const PERKS = ['instagram_follow_upsize'] as const;
export type Perk = (typeof PERKS)[number];

export const MERGE_RESULT_CODES = [
  'merged',
  'noop-same-user',
  'source-not-found',
  'target-not-found',
] as const;
export type MergeResultCode = (typeof MERGE_RESULT_CODES)[number];

export const API_ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'invalid_input',
  'captcha_failed',
  'rate_limited',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorResponse {
  ok: false;
  error: ApiErrorCode;
  message: string;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Database table row contracts matching the reference schema in `public`.
 */
export interface CustomerRow {
  id: string; // uuid == auth.users.id
  created_at: string; // timestamptz ISO string
}

export interface TagRow {
  id: string; // random hard-to-guess text PK
  label: string | null;
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
}

export interface StampRow {
  id: string; // uuid
  customer_id: string; // uuid
  tag_id: string | null;
  source: StampSource;
  staff_id: string | null; // uuid
  reason: string | null;
  created_at: string;
}

export interface RedemptionRow {
  id: string; // uuid
  customer_id: string; // uuid
  stamps_used: number;
  staff_id: string; // uuid
  created_at: string;
}

export interface PerkClaimRow {
  id: string; // uuid
  customer_id: string; // uuid
  perk: Perk;
  staff_id: string; // uuid
  created_at: string;
}

export interface StaffRow {
  user_id: string; // uuid PK references auth.users
  display_name: string;
  role: StaffRole;
  active: boolean;
}

export interface AuditLogRow {
  id: string; // uuid
  actor: string | null; // uuid
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface CustomerBalanceView {
  customer_id: string;
  total_stamps: number;
  stamps_redeemed: number;
  available_stamps: number;
  last_stamped_at: string | null;
}

/**
 * Postgres SECURITY DEFINER RPC function contracts (service_role only, except `is_staff`).
 */
export interface RpcContracts {
  is_staff: {
    Args: Record<string, never>;
    Returns: boolean;
  };
  ensure_customer: {
    Args: {
      p_customer: string;
    };
    Returns: string; // customer uuid
  };
  record_stamp: {
    Args: {
      p_customer: string;
      p_tag?: string | null;
      p_source?: StampSource;
      p_staff?: string | null;
      p_reason?: string | null;
      p_now?: string;
    };
    Returns: StampResultCode;
  };
  redeem_reward: {
    Args: {
      p_customer: string;
      p_staff: string;
      p_nonce?: string;
    };
    Returns: RedeemResultCode;
  };
  claim_instagram_upsize: {
    Args: {
      p_customer: string;
      p_staff: string;
    };
    Returns: Extract<
      RedeemResultCode,
      'redeemed' | 'already-claimed' | 'unauthorized' | 'invalid-token'
    >;
  };
  merge_anonymous_customer: {
    Args: {
      p_source_customer: string;
      p_target_customer: string;
    };
    Returns: MergeResultCode;
  };
  delete_customer_data: {
    Args: {
      p_customer: string;
    };
    Returns: boolean;
  };
  cleanup_stale_anonymous_customers: {
    Args: {
      p_older_than?: string;
    };
    Returns: number;
  };
  log_audit_event: {
    Args: {
      p_actor: string | null;
      p_action: string;
      p_target?: string | null;
      p_detail?: Record<string, unknown> | null;
    };
    Returns: string;
  };
}

/**
 * Signed short-lived redemption QR token payload (HMAC-SHA256 with REDEEM_TOKEN_SECRET).
 */
export interface RedeemTokenPayload {
  customerId: string;
  iat: number; // Unix epoch seconds
  exp: number; // Unix epoch seconds (iat + 300)
  nonce: string;
}

export interface IssuedRedeemToken {
  kind: RedeemTokenKind;
  token: string;
  payload: RedeemTokenPayload;
  expiresAtIso: string;
  ttlSeconds: number;
  displayCode: string;
  qrSvg: string;
}

export type VerifyRedeemTokenResult =
  | {
      valid: true;
      kind: RedeemTokenKind;
      payload: RedeemTokenPayload;
      displayCode: string;
    }
  | {
      valid: false;
      reason: 'invalid-token' | 'expired-token';
    };

/**
 * Phase 2 Customer Identity & Card Creation API Contracts
 */
export interface EnsureCustomerRequest {
  captchaToken?: string;
}

export interface EnsureCustomerResponse {
  customerId: string;
  isAnonymous: boolean;
}

export interface CustomerCardState {
  customerId: string;
  isAnonymous: boolean;
  email?: string | null;
  totalStamps: number;
  stampsRedeemed: number;
  availableStamps: number;
  lastStampedAt: string | null;
  /**
   * True once staff has granted the one-time Instagram follow upsize to this card.
   * Undefined when the claim status could not be loaded; the perk is then hidden.
   */
  instagramUpsizeClaimed?: boolean;
}

/**
 * Phase 3 Stamp Engine, Tap Verification & Display Contracts
 */
export type VerifyTapResult =
  | {
      valid: true;
      normalizedTagId: string;
      mode: 'ntag215-static';
    }
  | {
      valid: false;
      reason: 'malformed-tag-id';
    };

export interface ClaimStampRequest {
  tagId: string;
  captchaToken?: string;
}

export interface ClaimStampResponse {
  result: StampResultCode;
  redirectTo: string;
}

export interface StampProgressDisplay {
  availableStamps: number;
  rewardThreshold: number;
  clampedStamps: number;
  stampsRemaining: number;
  progressPercent: number;
  isMilestoneReached: boolean;
  isRewardReady: boolean;
  progressText: string;
}

/**
 * Phase 5 Staff Area & Admin Contracts
 */
export interface StaffSession {
  userId: string;
  email: string | null;
  displayName: string;
  role: StaffRole;
  active: true;
}

export type StaffAuthResult =
  | {
      authorized: true;
      staff: StaffSession;
    }
  | {
      authorized: false;
      reason: 'unauthenticated' | 'forbidden';
    };

export interface StaffRedeemRequest {
  action: 'preview' | 'confirm';
  token: string;
}

export interface StaffRedeemPreviewData {
  mode: 'preview';
  valid: true;
  rewardKind: RedeemTokenKind;
  customerId: string;
  displayCode: string;
  availableStamps: number;
  totalStamps: number;
  stampsRedeemed: number;
  canRedeem: boolean;
  expiresAtIso: string;
}

export interface StaffRedeemConfirmData {
  mode: 'confirm';
  result: RedeemResultCode;
  rewardKind?: RedeemTokenKind;
  customerId: string;
  displayCode: string;
  availableStampsAfter: number;
  message: string;
}

export type StaffRedeemResponse = StaffRedeemPreviewData | StaffRedeemConfirmData;

export interface StaffManualStampRequest {
  customerId: string;
  reason: string;
}

export interface StaffManualStampResponse {
  result: StampResultCode;
  customerId: string;
  availableStampsAfter: number;
  reason: string;
}

export type StaffTagActionRequest =
  | {
      action: 'create';
      label?: string;
    }
  | {
      action: 'deactivate';
      tagId: string;
    }
  | {
      action: 'rotate';
      tagId: string;
      newLabel?: string;
    };

export interface TagWithUrls extends TagRow {
  productionTapUrl: string;
  localTapUrl: string;
}

export interface StaffTagActionResponse {
  action: 'create' | 'deactivate' | 'rotate';
  tag: TagWithUrls;
  deactivatedTagId?: string;
}

export interface ActivityAnomalyFlag {
  id: string;
  severity: 'warning' | 'high';
  category: 'repeated-daily-cap' | 'high-tag-volume' | 'frequent-manual-stamps';
  title: string;
  description: string;
  targetId: string;
}

export interface StaffActivityDashboardData {
  stamps: StampRow[];
  redemptions: RedemptionRow[];
  auditLogs: AuditLogRow[];
  anomalies: ActivityAnomalyFlag[];
}

/**
 * Phase 6 Backup, Recovery, and Atomic Account Merge Contracts
 */
export const MERGE_INTENT_COOKIE_NAME = 'tcp_merge_intent' as const;

export interface MergeIntentPayload {
  sourceCustomerId: string;
  iat: number; // Unix epoch seconds
  exp: number; // Unix epoch seconds (iat + 600)
  nonce: string;
}

export interface IssuedMergeIntent {
  mergeToken: string;
  payload: MergeIntentPayload;
  expiresAtIso: string;
  ttlSeconds: number;
}

export type VerifyMergeIntentResult =
  | {
      valid: true;
      payload: MergeIntentPayload;
    }
  | {
      valid: false;
      reason: 'invalid-token' | 'expired-token';
    };

export interface MergeCustomerRequest {
  mergeToken?: string;
}

export interface MergeCustomerResponse {
  result: MergeResultCode;
  sourceCustomerId: string;
  targetCustomerId: string;
  availableStampsAfter: number;
  totalStampsAfter: number;
}

/**
 * Phase 7 Hardening & Philippines RA 10173 Data Privacy Compliance Contracts
 */
export interface DeleteCustomerResponse {
  deletedCustomerId: string;
  deletedAtIso: string;
}

export interface CleanupStaleAnonymousResult {
  deletedCount: number;
}

/**
 * Phase 8 Deployment & Liveness Health Probe Contract
 */
export interface HealthCheckResponse {
  status: 'ok';
  service: string;
  timestampIso: string;
  timezone: string;
}

/**
 * Canonical route paths across the Next.js App Router.
 */
export const ROUTES = Object.freeze({
  home: '/',
  card: '/card',
  cardWithResult: (result: StampResultCode) => `/card?r=${encodeURIComponent(result)}`,
  start: '/start',
  startWithTag: (tagId: string) => `/start?t=${encodeURIComponent(tagId)}`,
  tap: (tagId: string) => `/t/${encodeURIComponent(tagId)}`,
  authCallback: '/auth/callback',
  privacy: '/privacy',
  staff: {
    root: '/staff',
    login: '/staff/login',
    redeem: '/staff/redeem',
    manualStamp: '/staff/stamp',
    tags: '/staff/tags',
    activity: '/staff/activity',
  },
  api: {
    health: '/api/health',
    customers: '/api/customers',
    claim: '/api/claim',
    redeemToken: '/api/redeem-token',
    instagramUpsizeToken: '/api/perks/instagram-upsize',
    mergeIntent: '/api/customers/merge-intent',
    merge: '/api/customers/merge',
    staff: {
      redeem: '/api/staff/redeem',
      stamp: '/api/staff/stamp',
      tags: '/api/staff/tags',
    },
  },
});
