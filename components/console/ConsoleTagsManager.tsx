'use client';

import React, { useId, useState } from 'react';
import type { ApiResponse, TagLeakSignal } from '@/lib/contracts';
import { groupTagsByBranch } from '@/lib/tags/grouping';
import type { TagWithBranch } from '@/app/api/staff/[slug]/tags/route';
import { AdvancedSection, Notice, Panel, inputClass, primaryButtonClass } from './ui';

export interface LocationOption {
  id: string;
  name: string;
}

export interface ConsoleTagsManagerProps {
  slug: string;
  initialTags: TagWithBranch[];
  locations: LocationOption[];
  canManage: boolean;
  leakSignals?: TagLeakSignal[];
  /** Called after a tap card is added (the setup wizard uses it to move on). */
  onCreated?: () => void;
  /** Hide the "how to" steps and advanced guide (wizard shows its own). */
  compact?: boolean;
}

const SHOW_DEV_LINKS = process.env.NODE_ENV !== 'production';

/** The three things an owner actually does with a blank NFC card. */
export function TapCardSteps() {
  const steps = [
    {
      title: 'Add a tap card here',
      body: 'Give it a name like "Front counter". We create a special link for it.',
    },
    {
      title: 'Put the link on the card',
      body: 'Install the free NFC Tools app, choose Write → Add a record → URL, paste the link, then hold the card to your phone.',
    },
    {
      title: 'Test it',
      body: 'Tap the card with your phone. Your loyalty card should open with a new stamp.',
    },
  ];
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.title} className="rounded-xl border border-plug-border bg-black/30 p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-plug-black">
            {i + 1}
          </span>
          <p className="mt-3 font-semibold text-white">{s.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-plug-muted">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function ConsoleTagsManager({
  slug,
  initialTags,
  locations,
  canManage,
  leakSignals,
  onCreated,
  compact = false,
}: ConsoleTagsManagerProps) {
  const [tags, setTags] = useState<TagWithBranch[]>(initialTags);
  const [activeLeakSignals, setActiveLeakSignals] = useState<TagLeakSignal[]>(leakSignals ?? []);
  const [label, setLabel] = useState('');
  const [locationId, setLocationId] = useState<string>(locations[0]?.id || '');
  const [isCreating, setIsCreating] = useState(false);
  const [inFlightTagId, setInFlightTagId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showOff, setShowOff] = useState(false);

  const newTagLabelId = useId();
  const newTagLocationId = useId();

  const activeTags = tags.filter((t) => t.active);
  const offTags = tags.filter((t) => !t.active);
  const hasBranches = locations.length > 1;
  const groupedActive = groupTagsByBranch(activeTags, locations);

  async function handleCopy(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      setFeedback({ type: 'error', message: "Couldn't copy. Press and hold the link to copy it instead." });
    }
  }

  async function postTagAction(body: Record<string, unknown>) {
    const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as ApiResponse<{ action: string; tag?: TagWithBranch; deactivatedTagId?: string }>;
    return { ok: res.ok && json.ok, json };
  }

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;

    setIsCreating(true);
    setFeedback(null);
    try {
      const { ok, json } = await postTagAction({
        action: 'create',
        label: label.trim() || undefined,
        locationId: locationId || undefined,
      });
      if (!ok || !json.ok || !json.data.tag) {
        setFeedback({ type: 'error', message: !json.ok ? json.message : "The tap card wasn't added. Please try again." });
        return;
      }
      const created = json.data.tag;
      setTags((prev) => [created, ...prev]);
      setLabel('');
      setFeedback({
        type: 'success',
        message: `"${created.label || 'Tap card'}" is ready. Copy its link and write it onto the card (step 2).`,
      });
      onCreated?.();
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleReplaceLink(tag: TagWithBranch, fromWarning = false) {
    if (!canManage) return;
    const ok = window.confirm(
      `Replace the link for "${tag.label || 'this tap card'}"?\n\nThe old link stops working straight away. ` +
        'You will need to write the new link onto the card again with NFC Tools.',
    );
    if (!ok) return;

    setInFlightTagId(tag.id);
    setFeedback(null);
    try {
      const { ok: done, json } = await postTagAction({
        action: 'rotate',
        oldTagId: tag.id,
        newLabel: tag.label || undefined,
        locationId: tag.location_id || undefined,
        ...(fromWarning ? { reason: 'operator_rotated_leak_signal' } : {}),
      });
      if (!done || !json.ok || !json.data.tag) {
        setFeedback({ type: 'error', message: !json.ok ? json.message : "The link wasn't replaced. Please try again." });
        return;
      }
      const replacement = json.data.tag;
      setTags((prev) =>
        prev
          .map((t) => (t.id === tag.id ? { ...t, active: false, deactivated_at: new Date().toISOString() } : t))
          .concat(replacement),
      );
      setActiveLeakSignals((prev) => prev.filter((s) => s.tagId !== tag.id));
      setFeedback({
        type: 'success',
        message: 'New link ready. Copy it and write it onto the card again so customers can keep tapping.',
      });
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setInFlightTagId(null);
    }
  }

  async function handleTurnOff(tag: TagWithBranch) {
    if (!canManage) return;
    const ok = window.confirm(
      `Turn off "${tag.label || 'this tap card'}"?\n\nCustomers won't get stamps from it any more. This can't be undone, but you can add a new card at any time.`,
    );
    if (!ok) return;

    setInFlightTagId(tag.id);
    setFeedback(null);
    try {
      const { ok: done, json } = await postTagAction({ action: 'deactivate', tagId: tag.id });
      if (!done || !json.ok) {
        setFeedback({ type: 'error', message: !json.ok ? json.message : "The card wasn't turned off. Please try again." });
        return;
      }
      setTags((prev) =>
        prev.map((t) => (t.id === tag.id ? { ...t, active: false, deactivated_at: new Date().toISOString() } : t)),
      );
      setFeedback({ type: 'success', message: `"${tag.label || 'Tap card'}" is turned off.` });
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setInFlightTagId(null);
    }
  }

  function renderTag(tag: TagWithBranch) {
    const busy = inFlightTagId === tag.id;
    return (
      <li key={tag.id} className={`p-4 ${tag.active ? '' : 'opacity-60'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-white">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${tag.active ? 'bg-emerald-400' : 'bg-neutral-600'}`}
                aria-hidden="true"
              />
              {tag.label || 'Tap card'}
              <span className="text-xs font-normal text-plug-muted">{tag.active ? 'Working' : 'Turned off'}</span>
            </p>
            <p className="mt-1 text-xs text-plug-muted">
              Added {new Date(tag.created_at).toLocaleDateString()}
              {tag.last_tap_counter != null && ' · Extra copy protection on'}
            </p>
          </div>

          {tag.active && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(tag.productionTapUrl, `${tag.id}-prod`)}
                className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-plug-black hover:bg-neutral-200"
              >
                {copiedKey === `${tag.id}-prod` ? 'Copied ✓' : 'Copy link'}
              </button>
              {SHOW_DEV_LINKS && (
                <button
                  type="button"
                  onClick={() => handleCopy(tag.localTapUrl, `${tag.id}-local`)}
                  className="inline-flex min-h-10 items-center rounded-full border border-neutral-700 px-3 text-xs text-neutral-400 hover:text-white"
                >
                  {copiedKey === `${tag.id}-local` ? 'Copied ✓' : 'Copy local (dev)'}
                </button>
              )}
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => handleReplaceLink(tag)}
                    disabled={busy}
                    title="Use this if the card was lost or the link was shared"
                    className="inline-flex min-h-10 items-center rounded-full border border-neutral-600 px-4 text-sm font-medium text-white hover:border-white disabled:opacity-50"
                  >
                    {busy ? 'Working…' : 'Replace link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTurnOff(tag)}
                    disabled={busy}
                    className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium text-rose-300 hover:text-rose-200 disabled:opacity-50"
                  >
                    Turn off
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-6">
      {feedback && <Notice tone={feedback.type}>{feedback.message}</Notice>}

      {activeLeakSignals.length > 0 && (
        <Notice tone="warning" title="A tap card may have been copied">
          <p>
            One of your cards is being used by more people, or more often, than usual. Someone may have shared its link
            online. Replace the link, then write the new link onto the card.
          </p>
          <ul className="mt-3 space-y-2">
            {activeLeakSignals.map((sig) => {
              const matchingTag = tags.find((t) => t.id === sig.tagId);
              return (
                <li
                  key={sig.tagId}
                  className="flex flex-col gap-2 rounded-lg bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    <strong>{matchingTag?.label || 'Tap card'}</strong>
                    <span className="block text-xs opacity-80">
                      {sig.distinctCustomers > 0 && `${sig.distinctCustomers} different customers in 15 minutes`}
                      {sig.distinctCustomers > 0 && sig.throttleRejections > 0 && ' · '}
                      {sig.throttleRejections > 0 && `${sig.throttleRejections} blocked repeat taps in the last hour`}
                    </span>
                  </span>
                  {canManage && matchingTag && (
                    <button
                      type="button"
                      onClick={() => handleReplaceLink(matchingTag, true)}
                      disabled={inFlightTagId === sig.tagId}
                      className="inline-flex min-h-10 items-center self-start rounded-full bg-amber-400 px-4 text-sm font-semibold text-plug-black hover:bg-amber-300 disabled:opacity-50 sm:self-auto"
                    >
                      {inFlightTagId === sig.tagId ? 'Working…' : 'Replace link now'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Notice>
      )}

      {!compact && (
        <Panel title="How to set up a tap card" description="You need a blank NFC card or sticker (NTAG215 works best).">
          <TapCardSteps />
        </Panel>
      )}

      {canManage && (
        <Panel title="Add a tap card">
          <form onSubmit={handleCreateTag} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor={newTagLabelId} className="block text-sm text-neutral-300">
                Name (where will it sit?)
              </label>
              <input
                id={newTagLabelId}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Front counter"
                className={`${inputClass} mt-1.5`}
                maxLength={80}
              />
            </div>
            {hasBranches && (
              <div className="sm:w-56">
                <label htmlFor={newTagLocationId} className="block text-sm text-neutral-300">
                  Branch
                </label>
                <select
                  id={newTagLocationId}
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className={`${inputClass} mt-1.5`}
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="submit" disabled={isCreating} className={primaryButtonClass}>
              {isCreating ? 'Adding…' : 'Add tap card'}
            </button>
          </form>
        </Panel>
      )}

      <section aria-label="Your tap cards" className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Your tap cards</h2>
        {activeTags.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-plug-border p-8 text-center">
            <p className="font-semibold text-white">No tap cards yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-plug-muted">
              Add your first one above. Most shops start with one card at the counter.
            </p>
          </div>
        ) : (
          Object.entries(groupedActive).map(([branchName, branchTags]) => (
            <div key={branchName} className="overflow-hidden rounded-2xl border border-plug-border bg-plug-surface">
              {hasBranches && (
                <p className="border-b border-plug-border px-4 py-2 text-sm font-semibold text-neutral-300">
                  {branchName === 'Unassigned / Brand' ? 'No branch' : branchName}
                </p>
              )}
              <ul className="divide-y divide-plug-border">{branchTags.map(renderTag)}</ul>
            </div>
          ))
        )}

        {offTags.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowOff((v) => !v)}
              className="text-sm text-plug-muted underline underline-offset-4 hover:text-white"
            >
              {showOff ? 'Hide' : 'Show'} {offTags.length} turned-off card{offTags.length === 1 ? '' : 's'}
            </button>
            {showOff && (
              <ul className="mt-3 divide-y divide-plug-border overflow-hidden rounded-2xl border border-plug-border bg-plug-surface">
                {offTags.map(renderTag)}
              </ul>
            )}
          </div>
        )}
      </section>

      {!compact && (
        <AdvancedSection
          summary="Extra security (advanced)"
          hint="Lock your cards so nobody can overwrite them. Optional, but recommended."
        >
          <div className="space-y-5 text-sm leading-relaxed text-neutral-300">
            <div>
              <h3 className="font-semibold text-white">1. Stop others rewriting your card</h3>
              <p className="mt-1">
                Blank cards can be rewritten by anyone with a phone. In NFC Tools go to <strong>Other → Set password</strong>,
                choose a 4-byte password (like <code>A1B2C3D4</code>) and PACK (like <code>0000</code>), and set protection
                to <strong>Write-only</strong>. Keep the password somewhere safe.
              </p>
              <p className="mt-2 text-amber-300">
                Never use &ldquo;Lock card&rdquo;. It is permanent and you could never update the card again.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white">2. One card per staff member or station</h3>
              <p className="mt-1">
                Name cards like &ldquo;Barista – Mark&rdquo; or &ldquo;Cashier – Front&rdquo;. Activity can then spot
                if one person is giving out suspicious stamps.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white">3. Tap counter (NXP TagWriter only)</h3>
              <p className="mt-1">
                If your card supports NXP counter mirroring, add <code>?c=000000</code> to the link in NXP TagWriter and turn
                on the counter mirror. Copied links then stop working. If your card can&apos;t do this, don&apos;t worry:
                stamps are still protected by the time limits in My Card.
              </p>
              <button
                type="button"
                onClick={() => handleCopy('https://plug.coffee/t/{TAG_ID}?c=000000', 'template-copy')}
                className="mt-2 inline-flex min-h-10 items-center rounded-full border border-neutral-600 px-4 text-sm text-white hover:border-white"
              >
                {copiedKey === 'template-copy' ? 'Copied ✓' : 'Copy link template'}
              </button>
            </div>
          </div>
        </AdvancedSection>
      )}
    </div>
  );
}
