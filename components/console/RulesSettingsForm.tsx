'use client';

import { useState } from 'react';
import {
  TENANT_RULE_BOUNDS,
  type ApiResponse,
  type TenantRulesPatch,
  type TenantRulesPreview,
} from '@/lib/contracts';

export interface RulesSettingsFormProps {
  slug: string;
  isOwner: boolean;
  initialSettings: {
    cooldown_minutes: number;
    daily_cap: number;
    reward_threshold: number;
    tag_throttle_seconds: number;
    reward_label: string;
  };
}

export function RulesSettingsForm({
  slug,
  isOwner,
  initialSettings,
}: RulesSettingsFormProps) {
  const [cooldownMinutes, setCooldownMinutes] = useState(initialSettings.cooldown_minutes);
  const [dailyCap, setDailyCap] = useState(initialSettings.daily_cap);
  const [rewardThreshold, setRewardThreshold] = useState(initialSettings.reward_threshold);
  const [tagThrottleSeconds, setTagThrottleSeconds] = useState(initialSettings.tag_throttle_seconds);
  const [rewardLabel, setRewardLabel] = useState(initialSettings.reward_label);

  const [preview, setPreview] = useState<TenantRulesPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  async function handlePreview() {
    setIsPreviewing(true);
    setFeedback(null);
    try {
      const payload: TenantRulesPatch = {
        cooldown_minutes: Number(cooldownMinutes),
        daily_cap: Number(dailyCap),
        reward_threshold: Number(rewardThreshold),
        tag_throttle_seconds: Number(tagThrottleSeconds),
        reward_label: rewardLabel.trim(),
      };

      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/rules/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body: ApiResponse<TenantRulesPreview> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? 'Failed to fetch preview' : body.message || 'Error generating preview',
        });
      } else {
        setPreview(body.data);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error generating preview.' });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;

    setIsSaving(true);
    setFeedback(null);
    try {
      const payload: TenantRulesPatch = {
        cooldown_minutes: Number(cooldownMinutes),
        daily_cap: Number(dailyCap),
        reward_threshold: Number(rewardThreshold),
        tag_throttle_seconds: Number(tagThrottleSeconds),
        reward_label: rewardLabel.trim(),
      };

      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/rules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? 'Failed to save rules' : body.message || 'Error saving rules',
        });
      } else {
        setFeedback({ type: 'success', message: 'Rules successfully updated.' });
        setPreview(null);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error saving rules.' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {!isOwner && (
        <div
          role="status"
          className="border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200"
        >
          <strong>View Only:</strong> You have manager access. You can test and preview rule changes,
          but only an owner can save changes to this shop&apos;s rules.
        </div>
      )}

      {feedback && (
        <div
          role="alert"
          className={`border p-4 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
              : 'border-rose-800 bg-rose-950/40 text-rose-200'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Impact Preview Banner */}
      {preview && (
        <div
          role="region"
          aria-label="Impact Preview"
          className="border border-blue-800 bg-blue-950/30 p-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold uppercase tracking-wider text-white">
              Customer Impact Preview
            </h3>
            <span className="text-xs text-blue-300">
              Threshold: {preview.currentThreshold} → {preview.newThreshold}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-300">
            Review how this threshold adjustment affects existing customer balances before committing changes.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="border border-neutral-800 bg-neutral-900/80 p-4">
              <span className="block text-2xl font-bold text-white">
                {preview.cardsNewlyRedeemable}
              </span>
              <span className="text-xs text-neutral-300">
                Cards immediately become eligible for redemption
              </span>
            </div>
            <div className="border border-neutral-800 bg-neutral-900/80 p-4">
              <span className="block text-2xl font-bold text-white">
                {preview.cardsWithPartialProgress}
              </span>
              <span className="text-xs text-neutral-300">
                Cards actively accumulating stamps towards new target
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Rules Form */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Reward Threshold */}
          <div className="border border-plug-border bg-plug-surface p-5">
            <label
              htmlFor="reward-threshold"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
            >
              Reward Threshold
            </label>
            <p className="mt-1 text-xs text-neutral-400">
              Stamps required to earn a reward ({TENANT_RULE_BOUNDS.reward_threshold.min}–
              {TENANT_RULE_BOUNDS.reward_threshold.max}).
            </p>
            <input
              id="reward-threshold"
              type="number"
              min={TENANT_RULE_BOUNDS.reward_threshold.min}
              max={TENANT_RULE_BOUNDS.reward_threshold.max}
              value={rewardThreshold}
              onChange={(e) => setRewardThreshold(Number(e.target.value))}
              disabled={!isOwner}
              className="mt-3 block w-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-60"
              required
            />
          </div>

          {/* Reward Label */}
          <div className="border border-plug-border bg-plug-surface p-5">
            <label
              htmlFor="reward-label"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
            >
              Reward Label
            </label>
            <p className="mt-1 text-xs text-neutral-400">
              Customer-facing reward title (max {TENANT_RULE_BOUNDS.reward_label.maxLength} characters).
            </p>
            <input
              id="reward-label"
              type="text"
              minLength={TENANT_RULE_BOUNDS.reward_label.minLength}
              maxLength={TENANT_RULE_BOUNDS.reward_label.maxLength}
              value={rewardLabel}
              onChange={(e) => setRewardLabel(e.target.value)}
              disabled={!isOwner}
              className="mt-3 block w-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-60"
              required
            />
          </div>

          {/* Cooldown Minutes */}
          <div className="border border-plug-border bg-plug-surface p-5">
            <label
              htmlFor="cooldown-minutes"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
            >
              Cooldown Period (Minutes)
            </label>
            <p className="mt-1 text-xs text-neutral-400">
              Minimum minutes between consecutive stamps ({TENANT_RULE_BOUNDS.cooldown_minutes.min}–
              {TENANT_RULE_BOUNDS.cooldown_minutes.max}).
            </p>
            <input
              id="cooldown-minutes"
              type="number"
              min={TENANT_RULE_BOUNDS.cooldown_minutes.min}
              max={TENANT_RULE_BOUNDS.cooldown_minutes.max}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Number(e.target.value))}
              disabled={!isOwner}
              className="mt-3 block w-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-60"
              required
            />
          </div>

          {/* Daily Cap */}
          <div className="border border-plug-border bg-plug-surface p-5">
            <label
              htmlFor="daily-cap"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
            >
              Daily Cap
            </label>
            <p className="mt-1 text-xs text-neutral-400">
              Maximum stamps allowed per customer per day ({TENANT_RULE_BOUNDS.daily_cap.min}–
              {TENANT_RULE_BOUNDS.daily_cap.max}).
            </p>
            <input
              id="daily-cap"
              type="number"
              min={TENANT_RULE_BOUNDS.daily_cap.min}
              max={TENANT_RULE_BOUNDS.daily_cap.max}
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              disabled={!isOwner}
              className="mt-3 block w-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-60"
              required
            />
          </div>

          {/* Tag Throttle Seconds */}
          <div className="border border-plug-border bg-plug-surface p-5 sm:col-span-2">
            <label
              htmlFor="tag-throttle"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
            >
              Tag Anti-Burst Throttle (Seconds)
            </label>
            <p className="mt-1 text-xs text-neutral-400">
              Rate-limits burst taps on a single NFC tag ({TENANT_RULE_BOUNDS.tag_throttle_seconds.min}–
              {TENANT_RULE_BOUNDS.tag_throttle_seconds.max} seconds).
            </p>
            <input
              id="tag-throttle"
              type="number"
              min={TENANT_RULE_BOUNDS.tag_throttle_seconds.min}
              max={TENANT_RULE_BOUNDS.tag_throttle_seconds.max}
              value={tagThrottleSeconds}
              onChange={(e) => setTagThrottleSeconds(Number(e.target.value))}
              disabled={!isOwner}
              className="mt-3 block max-w-xs border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-60"
              required
            />
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-plug-border">
          <button
            type="button"
            onClick={handlePreview}
            disabled={isPreviewing}
            className="border border-neutral-600 bg-neutral-800 px-5 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
          >
            {isPreviewing ? 'Calculating Preview...' : 'Preview Impact'}
          </button>

          {isOwner && (
            <button
              type="submit"
              disabled={isSaving}
              className="border border-white bg-white px-6 py-2.5 text-sm font-semibold uppercase tracking-wider text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {isSaving ? 'Saving Changes...' : 'Save Rules'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
