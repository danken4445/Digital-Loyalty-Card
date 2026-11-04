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
  'no-card',
  'tenant-unavailable',
  'unauthorized',
] as const;

export type StampResultCode = (typeof STAMP_RESULT_CODES)[number];

export function isStampResultCode(value: unknown): value is StampResultCode {
  return typeof value === 'string' && (STAMP_RESULT_CODES as readonly string[]).includes(value);
}

export const STAMP_SOURCES = ['nfc', 'manual'] as const;
export type StampSource = (typeof STAMP_SOURCES)[number];

export const STAFF_ROLES = ['owner', 'manager', 'staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles allowed to create, rotate and deactivate tags (enforced again in SQL). */
export const TAG_MANAGER_ROLES = ['owner', 'manager'] as const satisfies readonly StaffRole[];

export const REDEEM_RESULT_CODES = [
  'redeemed',
  'insufficient-stamps',
  'unauthorized',
  'invalid-token',
  'expired-token',
  'already-claimed',
  'no-card',
  'tenant-unavailable',
  'invalid-perk',
  'wrong-tenant',
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

/**
 * Multi-tenant (Phase 12) shop contracts. A tenant is one shop; settings mirror public.tenant_settings,
 * which stays the single authority for stamp rules (enforced in SQL).
 */
export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'closed'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface TenantBrand {
  /** CSS color for the card background, e.g. "#0A0A0A" */
  primaryColor?: string;
  /** CSS color for accents and the stamp ink, e.g. "#FFFFFF" */
  accentColor?: string;
  /** Absolute or root-relative URL of the shop logo */
  logoUrl?: string;
  /** Absolute or root-relative URL of decorative card art */
  cardArtUrl?: string;
  tagline?: string;
}

export interface TenantPerkConfig {
  label: string;
  /** e.g. an Instagram handle such as "@thecaffeineplug8400" */
  handle?: string;
}

export type TenantPerks = Partial<Record<Perk, TenantPerkConfig>>;

export interface TenantSettings {
  cooldownMinutes: number;
  dailyCap: number;
  rewardThreshold: number;
  tagThrottleSeconds: number;
  /** IANA timezone, e.g. "Asia/Manila" */
  timezone: string;
  /** ISO 4217 code, e.g. "PHP" */
  currency: string;
  rewardLabel: string;
  brand: TenantBrand;
  perks: TenantPerks;
}

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  settings: TenantSettings;
}

/** Tenant #1 (The Caffeine Plug), created by migration 20261104000000. */
export const TENANT_ONE_ID = '7c1f0000-0000-4000-8000-000000000001' as const;
export const TENANT_ONE_SLUG = 'caffeine-plug' as const;

/** One card in a customer's wallet (one per shop). */
export interface WalletCardSummary {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  brand: TenantBrand;
  rewardThreshold: number;
  rewardLabel: string;
  availableStamps: number;
  totalStamps: number;
  lastStampedAt: string | null;
  addedAt: string;
  /** Phase 13: Total completed cards for this shop based on lifetime total stamps */
  cardsCompleted?: number;
}

export interface StaffMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: StaffRole;
}

/** HttpOnly cookie holding the staff member's active shop (re-verified against memberships on every request). */
export const STAFF_TENANT_COOKIE_NAME = 'tcp_staff_tenant' as const;

export const ADD_CARD_RESULT_CODES = ['added', 'already-added', 'tenant-unavailable'] as const;
export type AddCardResultCode = (typeof ADD_CARD_RESULT_CODES)[number];

export interface AddCardRequest {
  tenantSlug: string;
  /** Present when the customer arrived from an NFC tap: the stamp is claimed right after adding the card. */
  tagId?: string;
  consentVersion?: string;
}

export interface AddCardResponse {
  result: AddCardResultCode;
  stampResult?: StampResultCode;
  redirectTo: string;
}

export interface DeleteCardRequest {
  tenantSlug: string;
}

export interface DeleteCardResponse {
  /** False when the customer had no card at that shop (idempotent). */
  removed: boolean;
  redirectTo: string;
}

export interface RedeemTokenRequest {
  tenantSlug: string;
}

export interface StaffSwitchTenantRequest {
  tenantId: string;
}

export interface StaffSwitchTenantResponse {
  tenantId: string;
  tenantSlug: string;
}

export const MERGE_RESULT_CODES = [
  'merged',
  'noop-same-user',
  'source-not-found',
  'target-not-found',
] as const;
export type MergeResultCode = (typeof MERGE_RESULT_CODES)[number];

export interface MergeWalletsOutcome {
  result: MergeResultCode;
  cards_moved: number;
  cards_combined: number;
}

export function isMergeWalletsOutcome(value: unknown): value is MergeWalletsOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.result === 'string' &&
    (MERGE_RESULT_CODES as readonly string[]).includes(v.result) &&
    typeof v.cards_moved === 'number' &&
    typeof v.cards_combined === 'number'
  );
}

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
 * Postgres SECURITY DEFINER RPC function contracts (service_role only).
 */
export interface RpcContracts {
  /** Phase 11 tenant-aware functions (migrations 20261104*). Each staff action takes p_actor and checks membership in SQL. */
  add_card: {
    Args: { p_customer: string; p_tenant: string; p_consent_version?: string };
    Returns: AddCardResultCode;
  };
  stamp_card_nfc: {
    Args: { p_customer: string; p_tag: string; p_now?: string };
    Returns: { result: StampResultCode; tenant_slug: string | null };
  };
  stamp_card_manual: {
    Args: {
      p_actor: string;
      p_tenant: string;
      p_customer: string;
      p_reason: string;
      p_now?: string;
    };
    Returns: Extract<
      StampResultCode,
      'stamped' | 'cooldown' | 'daily-limit' | 'no-card' | 'unauthorized' | 'tenant-unavailable'
    >;
  };
  redeem_card_reward: {
    Args: { p_actor: string; p_tenant: string; p_customer: string; p_nonce: string };
    Returns: Extract<
      RedeemResultCode,
      | 'redeemed'
      | 'insufficient-stamps'
      | 'invalid-token'
      | 'no-card'
      | 'unauthorized'
      | 'tenant-unavailable'
    >;
  };
  claim_card_perk: {
    Args: { p_actor: string; p_tenant: string; p_customer: string; p_perk: Perk };
    Returns: Extract<
      RedeemResultCode,
      | 'redeemed'
      | 'already-claimed'
      | 'invalid-perk'
      | 'no-card'
      | 'unauthorized'
      | 'tenant-unavailable'
    >;
  };
  create_tag: {
    Args: { p_actor: string; p_tenant: string; p_tag_id: string; p_label?: string | null };
    Returns: 'created' | 'duplicate' | 'invalid-tag-id' | 'unauthorized';
  };
  deactivate_tag: {
    Args: { p_actor: string; p_tenant: string; p_tag_id: string };
    Returns: 'deactivated' | 'not-found' | 'unauthorized';
  };
  rotate_tag: {
    Args: {
      p_actor: string;
      p_tenant: string;
      p_old_tag_id: string;
      p_new_tag_id: string;
      p_label?: string | null;
    };
    Returns: 'rotated' | 'not-found' | 'duplicate' | 'invalid-tag-id' | 'unauthorized';
  };
  remove_card: {
    Args: { p_customer: string; p_tenant: string };
    Returns: boolean;
  };
  delete_wallet: {
    Args: { p_customer: string };
    Returns: boolean;
  };
  merge_wallets: {
    Args: { p_source: string; p_target: string };
    Returns: { result: MergeResultCode; cards_moved: number; cards_combined: number };
  };
  // Phase 14 (migrations 20261106*): platform admin, tenant admin, support and ops functions.
  set_tenant_status: {
    Args: { p_actor: string; p_tenant: string; p_status: string; p_reason: string };
    Returns: 'updated' | 'unauthorized' | 'invalid-status' | 'invalid-reason' | 'not-found';
  };
  is_platform_admin_user: { Args: { p_user: string }; Returns: boolean };
  platform_create_tenant: {
    Args: { p_actor: string; p_slug: string; p_name: string; p_owner_email: string };
    Returns: PlatformCreateTenantResult;
  };
  invite_member: {
    Args: { p_actor: string; p_tenant: string; p_email: string; p_role: StaffRole };
    Returns: 'invited' | 'unauthorized' | 'already-member' | 'invalid-email' | 'invalid-role';
  };
  accept_invite: {
    Args: { p_user: string; p_invite: string; p_display_name: string };
    Returns: 'accepted' | 'invalid-invite' | 'expired' | 'email-mismatch';
  };
  set_member_role: {
    Args: { p_actor: string; p_tenant: string; p_user: string; p_role: StaffRole };
    Returns: 'updated' | 'unauthorized' | 'last-owner' | 'not-found' | 'invalid-role';
  };
  set_member_active: {
    Args: { p_actor: string; p_tenant: string; p_user: string; p_active: boolean };
    Returns: 'updated' | 'unauthorized' | 'last-owner' | 'not-found';
  };
  update_tenant_rules: {
    Args: { p_actor: string; p_tenant: string; p_patch: TenantRulesPatch };
    Returns: 'updated' | 'unauthorized' | 'invalid-patch';
  };
  preview_tenant_rules: {
    Args: { p_actor: string; p_tenant: string; p_patch: TenantRulesPatch };
    Returns: TenantRulesPreview;
  };
  update_tenant_brand: {
    Args: { p_actor: string; p_tenant: string; p_brand: TenantBrand };
    Returns: 'updated' | 'unauthorized' | 'invalid-brand';
  };
  start_support_session: {
    Args: { p_admin: string; p_tenant: string; p_reason: string };
    Returns: {
      result: 'started' | 'unauthorized' | 'invalid-reason' | 'not-found';
      sessionId?: string;
      expiresAt?: string;
    };
  };
  end_support_session: {
    Args: { p_admin: string; p_session: string };
    Returns: 'ended' | 'unauthorized' | 'not-found';
  };
  support_get_tenant_overview: {
    Args: { p_admin: string; p_session: string };
    Returns: SupportTenantOverview | { result: 'unauthorized' };
  };
  support_list_recent_activity: {
    Args: { p_admin: string; p_session: string; p_limit?: number };
    Returns: SupportActivityRow[] | { result: 'unauthorized' };
  };
  ops_cleanup_status: {
    Args: Record<string, never>;
    Returns: { lastRunAt: string | null; stale: boolean };
  };
  tag_leak_signals: {
    Args: { p_actor: string; p_tenant: string; p_window_minutes?: number };
    Returns: TagLeakSignal[] | { result: 'unauthorized' };
  };
  ensure_customer: {
    Args: {
      p_customer: string;
    };
    Returns: string; // customer uuid
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
      /** Added by the Phase 12 contract migration; null = platform-level event. */
      p_tenant?: string | null;
    };
    Returns: string;
  };
  merge_nonce_used: { Args: { p_nonce: string }; Returns: boolean };
}

/**
 * Signed short-lived redemption QR token payload (HMAC-SHA256 with REDEEM_TOKEN_SECRET).
 */
export interface RedeemTokenPayload {
  customerId: string;
  /** Phase 12 (token prefixes tcp2 / tcpig2): the shop the reward belongs to. Staff of another shop get 'wrong-tenant'. */
  tenantId: string;
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
  /** The shop this card belongs to (Phase 12: one card per shop). */
  tenant: TenantContext;
  isAnonymous: boolean;
  email?: string | null;
  totalStamps: number;
  stampsRedeemed: number;
  availableStamps: number;
  lastStampedAt: string | null;
  /**
   * ISO string timestamp when the customer joined / card was created.
   */
  createdAt?: string | null;
  /**
   * Total number of 10-stamp loyalty cards completed by this customer.
   */
  cardsCompleted?: number;
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
  /** Role in the active shop (Task 5 adds the active-shop fields). */
  role: StaffRole;
  active: true;
  /** The active shop: the STAFF_TENANT_COOKIE_NAME membership if valid, else the first membership by shop name. */
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /** Every active membership, for the shop switcher. */
  memberships: StaffMembership[];
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

/** Roles that can see a shop's billing (only owners can change the plan; enforced again in SQL). */
export const BILLING_VIEWER_ROLES = ['owner', 'manager'] as const satisfies readonly StaffRole[];

/**
 * Flexible billing plans. Mirrors public.billing_plans; money is whole centavos (PHP 1 = 100).
 * A "customer" is a card holder who earned at least one stamp at the shop that calendar month.
 */
export interface BillingPlan {
  code: string;
  name: string;
  description: string;
  baseFeeCentavos: number;
  includedCustomers: number;
  perCustomerCentavos: number;
  /** Ceiling on the monthly charge, or null when uncapped. */
  monthlyCapCentavos: number | null;
}

export interface BillingEstimate {
  /** First day of the month the figures are for (YYYY-MM-DD, shop timezone). */
  month: string;
  /** False for trial shops: figures show what the plan would cost. */
  billed: boolean;
  /** Null until the shop picks a plan. */
  plan: BillingPlan | null;
  activeCustomers: number;
  extraCustomers: number;
  baseFeeCentavos: number;
  usageFeeCentavos: number;
  capApplied: boolean;
  totalCentavos: number;
  /** A plan change queued for a later month. */
  pendingPlan: { code: string; effectiveMonth: string } | null;
}

export interface ChoosePlanResponse {
  result: 'updated' | 'unchanged';
}

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
  status: 'ok' | 'degraded';
  service: string;
  timestampIso: string;
  timezone: string;
  cleanup?: {
    lastRunAt: string | null;
    stale: boolean;
  };
}

/**
 * Canonical route paths across the Next.js App Router.
 */
export const ROUTES = Object.freeze({
  home: '/',
  /** Redirector: one card → that shop; otherwise → wallet (host alias → that shop). */
  card: '/card',
  /** Kept for the shop-less invalid-tag outcome (/t cannot name a shop); prefer shopWithResult otherwise. */
  cardWithResult: (result: StampResultCode) => `/card?r=${encodeURIComponent(result)}`,
  wallet: '/wallet',
  shop: (slug: string) => `/s/${encodeURIComponent(slug)}`,
  shopWithResult: (slug: string, result: StampResultCode) =>
    `/s/${encodeURIComponent(slug)}?r=${encodeURIComponent(result)}`,
  /** Add-card (consent) screen; with a tag, the tap's stamp is claimed right after the card is added. */
  shopAddCard: (slug: string, tagId?: string | null) =>
    tagId
      ? `/s/${encodeURIComponent(slug)}?t=${encodeURIComponent(tagId)}`
      : `/s/${encodeURIComponent(slug)}`,
  /** Phase 13: Per-shop privacy notice generated from tenant settings */
  shopPrivacy: (slug: string) => `/s/${encodeURIComponent(slug)}/privacy`,
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
    billing: '/staff/billing',
    settings: (slug: string) => `/staff/${encodeURIComponent(slug)}/settings`,
  },
  platform: {
    root: '/platform',
    mfa: '/platform/mfa',
    newTenant: '/platform/new',
    tenant: (slug: string) => `/platform/${encodeURIComponent(slug)}`,
    support: (slug: string) => `/platform/${encodeURIComponent(slug)}/support`,
  },
  api: {
    health: '/api/health',
    customers: '/api/customers',
    claim: '/api/claim',
    redeemToken: '/api/redeem-token',
    instagramUpsizeToken: '/api/perks/instagram-upsize',
    mergeIntent: '/api/customers/merge-intent',
    merge: '/api/customers/merge',
    cards: '/api/cards',
    staff: {
      redeem: '/api/staff/redeem',
      stamp: '/api/staff/stamp',
      tags: '/api/staff/tags',
      tenant: '/api/staff/tenant',
      billing: '/api/staff/billing',
    },
    platform: {
      tenants: '/api/platform/tenants',
      support: '/api/platform/support',
      tenantPlan: (slug: string) => `/api/platform/tenants/${encodeURIComponent(slug)}/plan`,
    },
  },
});

/**
 * Phase 14 (owner console and platform operations) contracts. Rules and bounds mirror the
 * public.tenant_settings CHECK constraints; the database stays the authority.
 */
export const SUPPORT_SESSION_MINUTES = 30 as const;
/** Days a customer may still redeem after a shop is suspended (tenants.suspended_at). */
export const TENANT_STATUS_SUSPENDED_REDEEM_DAYS = 30 as const;

export const TENANT_RULE_BOUNDS = Object.freeze({
  cooldown_minutes: { min: 0, max: 1440 },
  daily_cap: { min: 1, max: 20 },
  reward_threshold: { min: 3, max: 50 },
  tag_throttle_seconds: { min: 0, max: 60 },
  reward_label: { minLength: 1, maxLength: 40 },
});

export interface TenantRulesPatch {
  cooldown_minutes?: number;
  daily_cap?: number;
  reward_threshold?: number;
  tag_throttle_seconds?: number;
  reward_label?: string;
}

export interface TenantRulesPreview {
  cardsNewlyRedeemable: number;
  cardsWithPartialProgress: number;
  currentThreshold: number;
  newThreshold: number;
}

export interface PlatformCreateTenantResult {
  result: 'created' | 'unauthorized' | 'invalid-slug' | 'duplicate-slug' | 'invalid-email';
  tenantId?: string;
  inviteId?: string;
}

export interface TenantInvite {
  id: string;
  tenantId: string;
  email: string;
  role: StaffRole;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface PlatformAdminSession {
  userId: string;
  email: string | null;
}

export type PlatformAuthResult =
  | { authorized: true; admin: PlatformAdminSession }
  | { authorized: false; reason: 'unauthenticated' | 'forbidden' | 'mfa-required' };

export interface SupportSession {
  sessionId: string;
  tenantId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

export interface SupportTenantOverview {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  cards: number;
  activeStaff: number;
  stampsLast7Days: number;
}

export interface SupportActivityRow {
  at: string;
  kind: 'stamp' | 'redeem' | 'audit';
  action: string;
}

export interface TagLeakSignal {
  tagId: string;
  distinctCustomers: number;
  throttleRejections: number;
}
