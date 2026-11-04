'use client';

import React, { useId, useState } from 'react';
import type { ApiResponse, TagLeakSignal } from '@/lib/contracts';
import { groupTagsByBranch } from '@/lib/tags/grouping';
import type { TagWithBranch } from '@/app/api/staff/[slug]/tags/route';

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
}

export function ConsoleTagsManager({
  slug,
  initialTags,
  locations,
  canManage,
  leakSignals,
}: ConsoleTagsManagerProps) {
  const [tags, setTags] = useState<TagWithBranch[]>(initialTags);
  const [activeLeakSignals, setActiveLeakSignals] = useState<TagLeakSignal[]>(leakSignals ?? []);
  const [label, setLabel] = useState('');
  const [locationId, setLocationId] = useState<string>(locations[0]?.id || '');
  const [isCreating, setIsCreating] = useState(false);
  const [inFlightTagId, setInFlightTagId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const newTagLabelId = useId();
  const newTagLocationId = useId();

  const groupedTags = groupTagsByBranch(tags, locations);

  async function handleCopy(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      setFeedback({ type: 'error', message: 'Failed to copy to clipboard.' });
    }
  }

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;

    setIsCreating(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          label: label.trim() || undefined,
          locationId: locationId || undefined,
        }),
      });

      const body: ApiResponse<{ action: string; tag: TagWithBranch }> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to provision tag.',
        });
        return;
      }

      setTags((prev) => [body.data.tag, ...prev]);
      setLabel('');
      setFeedback({
        type: 'success',
        message: `Tag "${body.data.tag.id}" created and assigned to ${
          locations.find((l) => l.id === locationId)?.name || 'branch'
        }.`,
      });
    } catch {
      setFeedback({ type: 'error', message: 'Network error creating tag.' });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRotateTag(tag: TagWithBranch) {
    if (!canManage) return;
    setInFlightTagId(tag.id);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rotate',
          oldTagId: tag.id,
          newLabel: tag.label || undefined,
          locationId: tag.location_id || undefined,
        }),
      });

      const body: ApiResponse<{ action: string; tag: TagWithBranch; deactivatedTagId: string }> =
        await res.json();

      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to rotate tag.',
        });
        return;
      }

      setTags((prev) =>
        prev
          .map((t) => (t.id === tag.id ? { ...t, active: false, deactivated_at: new Date().toISOString() } : t))
          .concat(body.data.tag),
      );

      setActiveLeakSignals((prev) => prev.filter((s) => s.tagId !== tag.id));

      setFeedback({
        type: 'success',
        message: `Tag "${tag.id}" rotated to new tag "${body.data.tag.id}".`,
      });
    } catch {
      setFeedback({ type: 'error', message: 'Network error rotating tag.' });
    } finally {
      setInFlightTagId(null);
    }
  }

  async function handleRotateFlaggedTag(tagId: string, tag?: TagWithBranch) {
    if (!canManage) return;
    setInFlightTagId(tagId);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rotate',
          oldTagId: tagId,
          newLabel: tag?.label || undefined,
          locationId: tag?.location_id || undefined,
          reason: 'operator_rotated_leak_signal',
        }),
      });

      const body: ApiResponse<{ action: string; tag: TagWithBranch; deactivatedTagId: string }> =
        await res.json();

      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to rotate leaking tag.',
        });
        return;
      }

      setTags((prev) =>
        prev
          .map((t) => (t.id === tagId ? { ...t, active: false, deactivated_at: new Date().toISOString() } : t))
          .concat(body.data.tag),
      );

      setActiveLeakSignals((prev) => prev.filter((s) => s.tagId !== tagId));

      setFeedback({
        type: 'success',
        message: `Leaked tag "${tagId}" rotated to new tag "${body.data.tag.id}".`,
      });
    } catch {
      setFeedback({ type: 'error', message: 'Network error rotating tag.' });
    } finally {
      setInFlightTagId(null);
    }
  }

  async function handleDeactivateTag(tagId: string) {
    if (!canManage) return;
    setInFlightTagId(tagId);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deactivate',
          tagId,
        }),
      });

      const body: ApiResponse<{ action: string; deactivatedTagId: string }> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to deactivate tag.',
        });
        return;
      }

      setTags((prev) =>
        prev.map((t) => (t.id === tagId ? { ...t, active: false, deactivated_at: new Date().toISOString() } : t)),
      );

      setFeedback({ type: 'success', message: `Tag "${tagId}" deactivated.` });
    } catch {
      setFeedback({ type: 'error', message: 'Network error deactivating tag.' });
    } finally {
      setInFlightTagId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
          NFC Tags Management
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          Provision, burn, and rotate physical NFC tags grouped by branch location.
        </p>
      </div>

      {feedback && (
        <div
          className={`border p-4 text-xs ${
            feedback.type === 'success'
              ? 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300'
              : 'border-rose-800/80 bg-rose-950/40 text-rose-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Leak Signals Warning Banner */}
      {activeLeakSignals.length > 0 && (
        <div
          role="alert"
          className="border border-amber-600 bg-amber-950/30 p-4 text-xs text-amber-200 space-y-3"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold uppercase tracking-wider text-amber-400">
                ⚠️ NFC Tag Leak Warning
              </h3>
              <p className="mt-1 text-neutral-300">
                Abnormal activity detected on the tag(s) below. Multiple distinct customers or high rate-limit blocks within a short window indicate this tag URL may have been shared publicly. Rotate immediately.
              </p>
            </div>
          </div>
          <div className="divide-y divide-amber-900/40 border border-amber-900/60 bg-black/40">
            {activeLeakSignals.map((sig) => {
              const matchingTag = tags.find((t) => t.id === sig.tagId);
              return (
                <div key={sig.tagId} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-2">
                  <div>
                    <div className="font-mono font-bold text-white">{sig.tagId}</div>
                    <div className="text-2xs text-amber-300/80 mt-0.5">
                      {sig.distinctCustomers > 0 && (
                        <span>{sig.distinctCustomers} distinct customers in 15m</span>
                      )}
                      {sig.distinctCustomers > 0 && sig.throttleRejections > 0 && <span> • </span>}
                      {sig.throttleRejections > 0 && (
                        <span>{sig.throttleRejections} rapid-tap rejections in 1h</span>
                      )}
                      {matchingTag?.label && (
                        <span className="ml-2 text-neutral-400">({matchingTag.label})</span>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRotateFlaggedTag(sig.tagId, matchingTag)}
                      disabled={inFlightTagId === sig.tagId}
                      className="border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-amber-400 disabled:opacity-50 transition-colors self-start sm:self-auto"
                    >
                      {inFlightTagId === sig.tagId ? 'Rotating...' : 'Rotate'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Provision new tag form */}
      {canManage && (
        <div className="border border-neutral-800 bg-neutral-900/60 p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 mb-4">
            Provision New NFC Tag
          </h3>
          <form onSubmit={handleCreateTag} className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-end">
            <div>
              <label htmlFor={newTagLabelId} className="block text-xs font-medium text-neutral-300 mb-1">
                Tag Label (Optional)
              </label>
              <input
                id={newTagLabelId}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Counter Register #1"
                className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white placeholder-neutral-600 focus:border-amber-500 focus:outline-none"
                maxLength={80}
              />
            </div>

            <div>
              <label htmlFor={newTagLocationId} className="block text-xs font-medium text-neutral-300 mb-1">
                Assign Branch Location
              </label>
              <select
                id={newTagLocationId}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <button
                type="submit"
                disabled={isCreating}
                className="w-full border border-amber-500 bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
              >
                {isCreating ? 'Provisioning...' : 'Provision NFC Tag'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Grouped Tags by Branch */}
      <div className="space-y-6">
        {Object.entries(groupedTags).map(([branchName, branchTags]) => (
          <div key={branchName} className="border border-neutral-800 bg-neutral-900/40">
            <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold uppercase tracking-wider text-white">
                  {branchName}
                </span>
                <span className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[10px] font-mono text-neutral-400">
                  {branchTags.filter((t) => t.active).length} active
                </span>
              </div>
            </div>

            <div className="divide-y divide-neutral-800">
              {branchTags.map((tag) => {
                const isOperating = inFlightTagId === tag.id;
                return (
                  <div
                    key={tag.id}
                    className={`p-4 transition-colors ${tag.active ? '' : 'opacity-60 bg-neutral-950/40'}`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-amber-400">{tag.id}</span>
                          {tag.label && (
                            <span className="text-xs text-neutral-300 font-medium">({tag.label})</span>
                          )}
                          <span
                            className={`rounded px-1.5 py-0.2 text-[10px] font-mono uppercase ${
                              tag.active
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                                : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                            }`}
                          >
                            {tag.active ? 'Active' : 'Deactivated'}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-4 text-[11px] text-neutral-500">
                          <span>Created: {new Date(tag.created_at).toLocaleDateString()}</span>
                          {tag.deactivated_at && (
                            <span>Deactivated: {new Date(tag.deactivated_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>

                      {/* Printable URLs and action buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(tag.productionTapUrl, `${tag.id}-prod`)}
                          className="border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
                        >
                          {copiedKey === `${tag.id}-prod` ? 'Copied URL!' : 'Copy Tap URL'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopy(tag.localTapUrl, `${tag.id}-local`)}
                          className="border border-neutral-800 bg-black px-2.5 py-1 text-[11px] font-mono text-neutral-400 hover:text-neutral-200 transition-colors"
                        >
                          {copiedKey === `${tag.id}-local` ? 'Copied!' : 'Copy Local'}
                        </button>

                        {canManage && tag.active && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRotateTag(tag)}
                              disabled={isOperating}
                              className="border border-amber-600/70 bg-amber-950/30 px-2.5 py-1 text-[11px] font-semibold text-amber-400 hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                            >
                              {isOperating ? 'Rotating...' : 'Rotate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeactivateTag(tag.id)}
                              disabled={isOperating}
                              className="border border-rose-800/70 bg-rose-950/30 px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:bg-rose-900/50 transition-colors disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {tags.length === 0 && (
          <div className="border border-dashed border-neutral-800 p-8 text-center text-xs text-neutral-500">
            No NFC tags provisioned for this shop yet. Use the form above to provision your first tag.
          </div>
        )}
      </div>
    </div>
  );
}
