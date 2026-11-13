'use client';

import { useState } from 'react';
import {
  TENANT_RULE_BOUNDS,
  type ApiResponse,
  type TenantRulesPatch,
  type TenantRulesPreview,
} from '@/lib/contracts';
import { describeMinutes } from '@/lib/console/setup-progress';
import {
  AdvancedSection,
  Notice,
  Panel,
  inlineInputClass,
  inputClass,
  primaryButtonClass,
} from '@/components/console/ui';

export interface RulesSettingsFormProps {
  slug: string;
  isOwner: boolean;
  initialSettings: {
    cooldown_minutes: number;
    daily_cap: number;
    reward_threshold: number;
    tag_throttle_seconds: number;
    reward_label: string;
    milestone_step?: number | null;
    milestone_reward_label?: string | null;
  };
  /** Called after a successful save (the setup wizard uses it to move on). */
  onSaved?: () => void;
  /** Label for the save button; defaults to "Save changes". */
  saveLabel?: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A row of dots so owners can *see* the card they are describing. */
function StampDots({ total, bonusAt }: { total: number; bonusAt: number | null }) {
  const count = clamp(Number(total) || 0, 0, TENANT_RULE_BOUNDS.reward_threshold.max);
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        const isLast = n === count;
        const isBonus = bonusAt === n;
        return (
          <span
            key={n}
            className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold ${
              isLast
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                : isBonus
                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-neutral-700 text-neutral-500'
            }`}
          >
            {isLast ? '★' : isBonus ? '½' : n}
          </span>
        );
      })}
    </div>
  );
}

export function RulesSettingsForm({
  slug,
  isOwner,
  initialSettings,
  onSaved,
  saveLabel = 'Save changes',
}: RulesSettingsFormProps) {
  const [cooldownMinutes, setCooldownMinutes] = useState(initialSettings.cooldown_minutes);
  const [dailyCap, setDailyCap] = useState(initialSettings.daily_cap);
  const [rewardThreshold, setRewardThreshold] = useState(initialSettings.reward_threshold);
  const [tagThrottleSeconds, setTagThrottleSeconds] = useState(initialSettings.tag_throttle_seconds);
  const [rewardLabel, setRewardLabel] = useState(initialSettings.reward_label);
  const [enableMilestone, setEnableMilestone] = useState(
    initialSettings.milestone_step != null && initialSettings.milestone_step > 0,
  );
  const [milestoneStep, setMilestoneStep] = useState<number | string>(
    initialSettings.milestone_step ?? (Math.floor(initialSettings.reward_threshold / 2) || 5),
  );
  const [milestoneRewardLabel, setMilestoneRewardLabel] = useState(
    initialSettings.milestone_reward_label ?? '50% OFF',
  );

  const [savedThreshold, setSavedThreshold] = useState(initialSettings.reward_threshold);
  const [preview, setPreview] = useState<TenantRulesPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const thresholdChanged = Number(rewardThreshold) !== savedThreshold;

  function buildPayload(): TenantRulesPatch {
    return {
      cooldown_minutes: Number(cooldownMinutes),
      daily_cap: Number(dailyCap),
      reward_threshold: Number(rewardThreshold),
      tag_throttle_seconds: Number(tagThrottleSeconds),
      reward_label: rewardLabel.trim(),
      milestone_step: enableMilestone ? Number(milestoneStep) : null,
      milestone_reward_label: enableMilestone ? milestoneRewardLabel.trim() : null,
    };
  }

  async function handlePreview() {
    setIsPreviewing(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/rules/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });

      const body: ApiResponse<TenantRulesPreview> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? "We couldn't check that right now." : body.message || "We couldn't check that right now.",
        });
      } else {
        setPreview(body.data);
      }
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;

    if (enableMilestone) {
      const step = Number(milestoneStep);
      const thresh = Number(rewardThreshold);
      if (isNaN(step) || step < 1 || step >= thresh) {
        setFeedback({
          type: 'error',
          message: `The bonus has to come before the last stamp: pick a stamp from 1 to ${thresh - 1}.`,
        });
        return;
      }
      if (!milestoneRewardLabel.trim()) {
        setFeedback({ type: 'error', message: 'Tell customers what the bonus is, e.g. "50% OFF".' });
        return;
      }
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/rules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? "Your changes weren't saved. Please try again." : body.message || "Your changes weren't saved.",
        });
      } else {
        setFeedback({ type: 'success', message: 'Saved. Customers will see this on their card right away.' });
        setPreview(null);
        setSavedThreshold(Number(rewardThreshold));
        onSaved?.();
      }
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setIsSaving(false);
    }
  }

  const bonusAt = enableMilestone ? Number(milestoneStep) || null : null;

  return (
    <div className="space-y-6">
      {!isOwner && (
        <Notice tone="info">
          Only the shop owner can change the reward. You can look around, but you can&apos;t save.
        </Notice>
      )}

      {feedback && <Notice tone={feedback.type}>{feedback.message}</Notice>}

      <form onSubmit={handleSave} className="space-y-6">
        {/* The one rule every shop needs, written as a sentence */}
        <Panel title="Your reward" description="This is what customers see on their loyalty card.">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 text-lg text-white">
            <label htmlFor="reward-threshold">Customers collect</label>
            <input
              id="reward-threshold"
              type="number"
              inputMode="numeric"
              min={TENANT_RULE_BOUNDS.reward_threshold.min}
              max={TENANT_RULE_BOUNDS.reward_threshold.max}
              value={rewardThreshold}
              onChange={(e) => {
                setRewardThreshold(Number(e.target.value));
                setPreview(null);
              }}
              disabled={!isOwner}
              className={`${inlineInputClass} w-20 text-center text-lg font-semibold`}
              aria-describedby="reward-threshold-hint"
              required
            />
            <label htmlFor="reward-label">stamps to get a</label>
            <input
              id="reward-label"
              type="text"
              minLength={TENANT_RULE_BOUNDS.reward_label.minLength}
              maxLength={TENANT_RULE_BOUNDS.reward_label.maxLength}
              value={rewardLabel}
              onChange={(e) => setRewardLabel(e.target.value)}
              disabled={!isOwner}
              placeholder="Free Coffee"
              className={`${inlineInputClass} w-full max-w-xs text-lg font-semibold sm:w-60`}
              required
            />
          </div>
          <p id="reward-threshold-hint" className="mt-2 text-sm text-plug-muted">
            Between {TENANT_RULE_BOUNDS.reward_threshold.min} and {TENANT_RULE_BOUNDS.reward_threshold.max} stamps. Most
            coffee shops use 8 to 10.
          </p>
          <div className="mt-5">
            <StampDots total={rewardThreshold} bonusAt={bonusAt} />
          </div>

          {thresholdChanged && isOwner && (
            <div className="mt-5 rounded-xl border border-sky-700/60 bg-sky-950/30 p-4 text-sm text-sky-100">
              <p>
                You&apos;re changing the card from <strong>{savedThreshold}</strong> to{' '}
                <strong>{Number(rewardThreshold)}</strong> stamps. Customers keep the stamps they already have.
              </p>
              {preview ? (
                <ul className="mt-3 space-y-1">
                  <li>
                    <strong>{preview.cardsNewlyRedeemable}</strong> customer
                    {preview.cardsNewlyRedeemable === 1 ? '' : 's'} will be able to claim a reward straight away.
                  </li>
                  <li>
                    <strong>{preview.cardsWithPartialProgress}</strong> customer
                    {preview.cardsWithPartialProgress === 1 ? ' is' : 's are'} part-way and will keep collecting.
                  </li>
                </ul>
              ) : (
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={isPreviewing}
                  className="mt-3 font-semibold underline underline-offset-4 disabled:opacity-50"
                >
                  {isPreviewing ? 'Checking…' : 'See which customers this affects'}
                </button>
              )}
            </div>
          )}
        </Panel>

        {/* Optional halfway bonus */}
        <Panel>
          <label htmlFor="enable-milestone" className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-lg font-semibold text-white">Halfway bonus</span>
              <span className="mt-1 block text-sm text-plug-muted">
                Give a small extra part-way through, so customers stay excited. They keep their stamps.
              </span>
            </span>
            <input
              id="enable-milestone"
              type="checkbox"
              checked={enableMilestone}
              onChange={(e) => setEnableMilestone(e.target.checked)}
              disabled={!isOwner}
              className="mt-1 h-6 w-6 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500 disabled:opacity-60"
            />
          </label>

          {enableMilestone && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-3 border-t border-plug-border pt-4 text-base text-white">
              <label htmlFor="milestone-step">At stamp</label>
              <input
                id="milestone-step"
                type="number"
                inputMode="numeric"
                min={TENANT_RULE_BOUNDS.milestone_step.min}
                max={Math.max(1, Number(rewardThreshold) - 1)}
                value={milestoneStep}
                onChange={(e) => setMilestoneStep(e.target.value)}
                disabled={!isOwner}
                className={`${inlineInputClass} w-20 text-center font-semibold`}
                required={enableMilestone}
              />
              <label htmlFor="milestone-reward-label">customers get</label>
              <input
                id="milestone-reward-label"
                type="text"
                maxLength={TENANT_RULE_BOUNDS.milestone_reward_label.maxLength}
                value={milestoneRewardLabel}
                onChange={(e) => setMilestoneRewardLabel(e.target.value)}
                disabled={!isOwner}
                placeholder="50% OFF"
                className={`${inlineInputClass} w-full max-w-xs font-semibold sm:w-48`}
                required={enableMilestone}
              />
            </div>
          )}
        </Panel>

        <AdvancedSection
          summary="Stamp limits (advanced)"
          hint="Stops people collecting stamps too fast. The defaults work for most shops."
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <label htmlFor="cooldown-minutes" className="block text-sm font-semibold text-white">
                Wait between stamps
              </label>
              <p className="mt-1 text-sm text-plug-muted">
                Minutes a customer waits before their next stamp. Now: {describeMinutes(Number(cooldownMinutes))}.
              </p>
              <input
                id="cooldown-minutes"
                type="number"
                inputMode="numeric"
                min={TENANT_RULE_BOUNDS.cooldown_minutes.min}
                max={TENANT_RULE_BOUNDS.cooldown_minutes.max}
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(Number(e.target.value))}
                disabled={!isOwner}
                className={`${inputClass} mt-2`}
                required
              />
            </div>

            <div>
              <label htmlFor="daily-cap" className="block text-sm font-semibold text-white">
                Most stamps per day
              </label>
              <p className="mt-1 text-sm text-plug-muted">
                The most stamps one customer can collect in a day ({TENANT_RULE_BOUNDS.daily_cap.min} to{' '}
                {TENANT_RULE_BOUNDS.daily_cap.max}).
              </p>
              <input
                id="daily-cap"
                type="number"
                inputMode="numeric"
                min={TENANT_RULE_BOUNDS.daily_cap.min}
                max={TENANT_RULE_BOUNDS.daily_cap.max}
                value={dailyCap}
                onChange={(e) => setDailyCap(Number(e.target.value))}
                disabled={!isOwner}
                className={`${inputClass} mt-2`}
                required
              />
            </div>

            <div>
              <label htmlFor="tag-throttle" className="block text-sm font-semibold text-white">
                Double-tap protection
              </label>
              <p className="mt-1 text-sm text-plug-muted">
                Seconds the tap card ignores repeat taps, so one tap never counts twice.
              </p>
              <input
                id="tag-throttle"
                type="number"
                inputMode="numeric"
                min={TENANT_RULE_BOUNDS.tag_throttle_seconds.min}
                max={TENANT_RULE_BOUNDS.tag_throttle_seconds.max}
                value={tagThrottleSeconds}
                onChange={(e) => setTagThrottleSeconds(Number(e.target.value))}
                disabled={!isOwner}
                className={`${inputClass} mt-2`}
                required
              />
            </div>
          </div>
        </AdvancedSection>

        {isOwner && (
          <div className="flex justify-end">
            <button type="submit" disabled={isSaving} className={primaryButtonClass}>
              {isSaving ? 'Saving…' : saveLabel}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
