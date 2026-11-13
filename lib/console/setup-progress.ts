/**
 * Shop setup checklist: which first-run jobs an owner has finished.
 *
 * Every step is derived from real shop data (no extra "onboarding" table), so the checklist can
 * never drift from reality: delete the only tap card and that step un-ticks itself.
 */
import type { TenantBrand } from '@/lib/contracts';

export type SetupStepId = 'look' | 'reward' | 'tapCard' | 'team' | 'testTap';

export const SETUP_STEP_IDS: readonly SetupStepId[] = ['look', 'reward', 'tapCard', 'team', 'testTap'];

/** Set when an owner chooses "I'll do it later", so Home stops sending them into the wizard. */
export const SETUP_SKIPPED_COOKIE = 'odyssey_setup_later';

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === 'string' && (SETUP_STEP_IDS as readonly string[]).includes(value);
}

export interface SetupStep {
  id: SetupStepId;
  title: string;
  description: string;
  /** Where the owner goes to do this step */
  href: string;
  done: boolean;
  optional: boolean;
}

export interface SetupFacts {
  brand: TenantBrand;
  /** Owner has saved the reward rules at least once */
  rewardSaved: boolean;
  activeTapCards: number;
  /** Members plus pending invites, including the owner */
  teamSize: number;
  totalStamps: number;
}

export interface SetupProgress {
  steps: SetupStep[];
  doneCount: number;
  /** Required steps only; optional ones never block "all set" */
  requiredCount: number;
  requiredDoneCount: number;
  isComplete: boolean;
  nextStep: SetupStep | null;
}

/** Card counts as personalised once a logo or a non-default colour has been saved. */
export function hasCustomLook(brand: TenantBrand): boolean {
  const primary = brand.primaryColor?.toUpperCase();
  const accent = brand.accentColor?.toUpperCase();
  return Boolean(
    brand.logoUrl ||
      brand.cardArtUrl ||
      (primary && primary !== '#0A0A0A') ||
      (accent && accent !== '#FFFFFF'),
  );
}

export function setupHref(slug: string, step: SetupStepId): string {
  return `/staff/${encodeURIComponent(slug)}/setup?step=${step}`;
}

export function computeSetupProgress(slug: string, facts: SetupFacts): SetupProgress {
  const steps: SetupStep[] = [
    {
      id: 'look',
      title: 'Make the card look like your shop',
      description: 'Add your logo and pick your colours.',
      href: setupHref(slug, 'look'),
      done: hasCustomLook(facts.brand),
      optional: false,
    },
    {
      id: 'reward',
      title: 'Choose your reward',
      description: 'For example: buy 10, get a free coffee.',
      href: setupHref(slug, 'reward'),
      done: facts.rewardSaved,
      optional: false,
    },
    {
      id: 'tapCard',
      title: 'Set up your counter tap card',
      description: 'Customers tap it with their phone to collect a stamp.',
      href: setupHref(slug, 'tapCard'),
      done: facts.activeTapCards > 0,
      optional: false,
    },
    {
      id: 'team',
      title: 'Invite your team',
      description: 'Give your baristas their own login.',
      href: setupHref(slug, 'team'),
      done: facts.teamSize > 1,
      optional: true,
    },
    {
      id: 'testTap',
      title: 'Do a test tap',
      description: 'Tap the card with your own phone to see it work.',
      href: setupHref(slug, 'testTap'),
      done: facts.totalStamps > 0,
      optional: false,
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const requiredDoneCount = required.filter((s) => s.done).length;

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    requiredCount: required.length,
    requiredDoneCount,
    isComplete: requiredDoneCount === required.length,
    nextStep: steps.find((s) => !s.done) ?? null,
  };
}

/** Plain-language wording for a number of minutes ("1 hour", "30 minutes", "no wait"). */
export function describeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'no wait';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest === 0 ? h : `${h} ${rest} min`;
}

/** Midnight "today" in the shop's timezone, as a UTC Date. */
export function startOfTodayInZone(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // How far the shop's wall clock is past its midnight, subtracted from the real instant.
  const msSinceMidnight =
    ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - msSinceMidnight);
}
