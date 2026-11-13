'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BrandSettingsForm } from '@/components/console/BrandSettingsForm';
import { ConsoleTagsManager, TapCardSteps } from '@/components/console/ConsoleTagsManager';
import { RulesSettingsForm, type RulesSettingsFormProps } from '@/components/console/RulesSettingsForm';
import { StaffManagementClient, type InviteItem, type MemberItem } from '@/components/console/StaffManagementClient';
import { Notice, primaryButtonClass, secondaryButtonClass } from '@/components/console/ui';
import {
  SETUP_SKIPPED_COOKIE,
  SETUP_STEP_IDS,
  setupHref,
  type SetupProgress,
  type SetupStepId,
} from '@/lib/console/setup-progress';
import { ROUTES, type TagLeakSignal, type TenantBrand } from '@/lib/contracts';
import type { TagWithBranch } from '@/app/api/staff/[slug]/tags/route';

export interface SetupWizardData {
  slug: string;
  tenantId: string;
  tenantName: string;
  currentUserId: string;
  brand: TenantBrand;
  rules: RulesSettingsFormProps['initialSettings'];
  tapCards: { tags: TagWithBranch[]; locations: Array<{ id: string; name: string }>; leakSignals: TagLeakSignal[] } | null;
  team: { members: MemberItem[]; invites: InviteItem[] } | null;
}

const STEP_INTRO: Record<SetupStepId, { heading: string; body: string }> = {
  look: {
    heading: 'Make the card look like your shop',
    body: 'Add your logo and choose a colour style. You can see the card change on the right as you go.',
  },
  reward: {
    heading: 'Choose your reward',
    body: 'How many stamps does a customer need, and what do they get? You can change this later.',
  },
  tapCard: {
    heading: 'Set up your counter tap card',
    body: 'Customers tap this card with their phone to collect a stamp. You need a blank NFC card or sticker.',
  },
  team: {
    heading: 'Invite your team',
    body: 'Optional. Give each person their own login so they can give rewards at the counter.',
  },
  testTap: {
    heading: 'Do a test tap',
    body: 'Hold your phone near the tap card, just like a customer would.',
  },
};

function rememberLater() {
  try {
    document.cookie = `${SETUP_SKIPPED_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // Cookies blocked: Home will simply offer the wizard again next time.
  }
}

export function SetupWizard({
  step,
  progress,
  data,
}: {
  step: SetupStepId;
  progress: SetupProgress;
  data: SetupWizardData;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const index = SETUP_STEP_IDS.indexOf(step);
  const prev = index > 0 ? SETUP_STEP_IDS[index - 1] : null;
  const next = index < SETUP_STEP_IDS.length - 1 ? SETUP_STEP_IDS[index + 1] : null;
  const current = progress.steps.find((s) => s.id === step)!;
  const intro = STEP_INTRO[step];

  function goNext() {
    if (next) {
      router.push(setupHref(data.slug, next));
    }
    router.refresh();
  }

  function finish() {
    rememberLater();
    router.push(ROUTES.staff.root);
    router.refresh();
  }

  const firstActiveTag = data.tapCards?.tags.find((t) => t.active) ?? null;

  return (
    <div className="min-h-dvh bg-plug-black text-white">
      {/* Focused header: no full menu, so there's only one thing to do on screen */}
      <header className="border-b border-plug-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <p className="truncate text-lg font-bold">{data.tenantName} setup</p>
          <button
            type="button"
            onClick={finish}
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-plug-muted hover:text-white"
          >
            I&apos;ll finish later
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6">
        {/* Stepper */}
        <nav aria-label="Setup steps">
          <ol className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
            {progress.steps.map((s, i) => {
              const isCurrent = s.id === step;
              return (
                <li key={s.id} className="shrink-0">
                  <Link
                    href={s.href}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors ${
                      isCurrent
                        ? 'border-white bg-white text-plug-black'
                        : s.done
                          ? 'border-emerald-700/60 text-emerald-300'
                          : 'border-plug-border text-plug-muted hover:text-white'
                    }`}
                  >
                    <span aria-hidden="true">{s.done ? '✓' : i + 1}</span>
                    <span className="hidden sm:inline">{s.title.split(' ').slice(0, 3).join(' ')}</span>
                    <span className="sr-only">
                      {s.title}
                      {s.done ? ' (done)' : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="mt-6">
          <p className="text-sm text-plug-muted">
            Step {index + 1} of {SETUP_STEP_IDS.length}
            {current.optional && ' · Optional'}
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{intro.heading}</h1>
          <p className="mt-1.5 max-w-prose text-base text-neutral-300">{intro.body}</p>
          {current.done && step !== 'testTap' && (
            <p className="mt-3 text-sm font-medium text-emerald-300">✓ Done. You can change it, or go to the next step.</p>
          )}
        </div>

        <div className="mt-8">
          {step === 'look' && (
            <BrandSettingsForm
              mode="basics"
              slug={data.slug}
              tenantId={data.tenantId}
              tenantName={data.tenantName}
              canManage
              initialBrand={data.brand}
              rewardThreshold={data.rules.reward_threshold}
              rewardLabel={data.rules.reward_label}
              saveLabel="Save and continue"
              onSaved={goNext}
            />
          )}

          {step === 'reward' && (
            <div className="max-w-3xl">
              <RulesSettingsForm
                slug={data.slug}
                isOwner
                initialSettings={data.rules}
                saveLabel="Save and continue"
                onSaved={goNext}
              />
            </div>
          )}

          {step === 'tapCard' && data.tapCards && (
            <div className="space-y-6">
              <TapCardSteps />
              <ConsoleTagsManager
                compact
                slug={data.slug}
                initialTags={data.tapCards.tags}
                locations={data.tapCards.locations}
                leakSignals={data.tapCards.leakSignals}
                canManage
                onCreated={() => router.refresh()}
              />
            </div>
          )}

          {step === 'team' && data.team && (
            <div className="max-w-3xl">
              <StaffManagementClient
                slug={data.slug}
                isOwner
                currentUserId={data.currentUserId}
                initialMembers={data.team.members}
                initialInvites={data.team.invites}
                onInvited={() => router.refresh()}
              />
            </div>
          )}

          {step === 'testTap' && (
            <div className="max-w-2xl space-y-5">
              {current.done ? (
                <Notice tone="success" title="It works! 🎉">
                  Your shop has received its first stamp. You&apos;re ready for customers.
                </Notice>
              ) : firstActiveTag ? (
                <>
                  <ol className="list-decimal space-y-2 pl-5 text-base text-neutral-200">
                    <li>Unlock your phone and turn on NFC (most iPhones have it on already).</li>
                    <li>Hold the top of your phone against the tap card for a second.</li>
                    <li>Your loyalty card opens. Follow the steps to collect your first stamp.</li>
                    <li>Come back here and press &ldquo;Check again&rdquo;.</li>
                  </ol>
                  <button type="button" onClick={() => router.refresh()} className={primaryButtonClass}>
                    Check again
                  </button>
                  <div className="rounded-xl border border-plug-border bg-plug-surface p-4 text-sm text-neutral-300">
                    <p className="font-semibold text-white">Phone won&apos;t read the card?</p>
                    <p className="mt-1">
                      Check the link was written onto the card (step 3). Or open this link on your phone to test without the
                      card:
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(firstActiveTag.productionTapUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          /* copy blocked: the link is visible to copy by hand */
                        }
                      }}
                      className={`${secondaryButtonClass} mt-3`}
                    >
                      {copied ? 'Copied ✓' : 'Copy test link'}
                    </button>
                    <p className="mt-2 break-all font-mono text-xs text-plug-muted">{firstActiveTag.productionTapUrl}</p>
                  </div>
                </>
              ) : (
                <Notice tone="info" title="Add a tap card first">
                  You need a tap card before you can test it.{' '}
                  <Link href={setupHref(data.slug, 'tapCard')} className="font-semibold underline underline-offset-4">
                    Go to step 3
                  </Link>
                </Notice>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Sticky footer navigation */}
      <footer className="fixed inset-x-0 bottom-0 border-t border-plug-border bg-plug-black/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {prev ? (
            <Link href={setupHref(data.slug, prev)} className={secondaryButtonClass}>
              ← Back
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={setupHref(data.slug, next)} className={current.done ? primaryButtonClass : secondaryButtonClass}>
              {current.done ? 'Next step →' : 'Skip for now →'}
            </Link>
          ) : (
            <button type="button" onClick={finish} className={primaryButtonClass}>
              {progress.isComplete ? 'Go to my shop →' : 'Finish for now'}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
