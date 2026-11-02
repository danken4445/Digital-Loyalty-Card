'use client';

import { useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type StaffTagActionRequest,
  type StaffTagActionResponse,
  type TagWithUrls,
} from '@/lib/contracts';
import { formatManilaDateTime } from '@/lib/rules/display';

export interface TagManagerClientProps {
  initialTags: TagWithUrls[];
}

export function TagManagerClient({ initialTags }: TagManagerClientProps) {
  const [tags, setTags] = useState<TagWithUrls[]>(initialTags);
  const [newLabel, setNewLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [inFlightTagId, setInFlightTagId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function handleCopy(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      setErrorMessage('Could not copy to clipboard. Please copy manually.');
    }
  }

  async function handleCreateTag(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsCreating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: StaffTagActionRequest = {
        action: 'create',
        label: newLabel.trim() || undefined,
      };

      const res = await fetch(ROUTES.api.staff.tags, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as ApiResponse<StaffTagActionResponse>;

      if (!res.ok || !body.ok) {
        setErrorMessage(!body.ok ? body.message : 'Failed to provision tag.');
        return;
      }

      setTags((prev) => [body.data.tag, ...prev]);
      setNewLabel('');
      setSuccessMessage(`New tag "${body.data.tag.id}" created and ready to burn.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error provisioning NFC tag.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRotateTag(tagId: string) {
    setInFlightTagId(tagId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: StaffTagActionRequest = {
        action: 'rotate',
        tagId,
      };

      const res = await fetch(ROUTES.api.staff.tags, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as ApiResponse<StaffTagActionResponse>;

      if (!res.ok || !body.ok) {
        setErrorMessage(!body.ok ? body.message : 'Failed to rotate tag.');
        return;
      }

      const deactivatedId = body.data.deactivatedTagId ?? tagId;
      const newTag = body.data.tag;

      setTags((prev) => {
        const updated = prev.map((t) =>
          t.id === deactivatedId
            ? { ...t, active: false, deactivated_at: new Date().toISOString() }
            : t,
        );
        return [newTag, ...updated];
      });

      setSuccessMessage(`Tag rotated: deactivated old tag and provisioned new tag "${newTag.id}".`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error rotating NFC tag.');
    } finally {
      setInFlightTagId(null);
    }
  }

  async function handleDeactivateTag(tagId: string) {
    setInFlightTagId(tagId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: StaffTagActionRequest = {
        action: 'deactivate',
        tagId,
      };

      const res = await fetch(ROUTES.api.staff.tags, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as ApiResponse<StaffTagActionResponse>;

      if (!res.ok || !body.ok) {
        setErrorMessage(!body.ok ? body.message : 'Failed to deactivate tag.');
        return;
      }

      const updatedTag = body.data.tag;
      setTags((prev) => prev.map((t) => (t.id === tagId ? updatedTag : t)));
      setSuccessMessage(`Tag "${tagId}" has been deactivated.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error deactivating NFC tag.');
    } finally {
      setInFlightTagId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Create Tag Form */}
      <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-white sm:p-8">
        <h2 className="text-lg font-semibold text-white">Provision NTAG215 Hardware Tag</h2>
        <p className="mt-1 text-sm text-plug-muted">
          Generates a new unguessable tag ID (e.g. <code>tcp_tag_...</code>). Write the resulting
          URL into blank NTAG215 stickers using NFC Tools or NXP TagWriter.
        </p>

        <form onSubmit={handleCreateTag} className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="new-tag-label" className="block text-sm font-medium text-neutral-200">
                Tag Label (Optional)
              </label>
              <input
                id="new-tag-label"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Front Counter Barista Card #2"
                disabled={isCreating}
                className="mt-1.5 w-full min-h-12 rounded-xl border border-plug-border bg-plug-black px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              />
            </div>

            <button
              type="submit"
              disabled={isCreating}
              aria-busy={isCreating}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-5 py-2 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black"
            >
              {isCreating ? 'Generating Tag...' : 'Generate New Random Tag'}
            </button>
          </div>
        </form>
      </div>

      {/* Alert Messages */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-2xl border border-red-500/60 bg-red-950/40 p-4 text-xs text-red-200"
        >
          <span className="font-semibold text-red-100">Error: </span>
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-white/40 bg-plug-elevated p-4 text-xs font-semibold text-white"
        >
          ✓ {successMessage}
        </div>
      )}

      {/* Tags List */}
      <section aria-label="NFC Tag Inventory" className="space-y-4">
        <div className="flex items-center justify-between border-b border-plug-border pb-3">
          <h3 className="font-display text-xl font-bold uppercase tracking-wide text-white">
            Provisioned Tags ({tags.length})
          </h3>
          <span className="font-mono text-xs text-plug-muted">
            {tags.filter((t) => t.active).length} Active / {tags.filter((t) => !t.active).length}{' '}
            Deactivated
          </span>
        </div>

        {tags.length === 0 ? (
          <div className="rounded-2xl border border-plug-border bg-plug-surface p-8 text-center text-xs text-plug-muted">
            No NFC tags provisioned yet. Use the form above to generate your first counter tag.
          </div>
        ) : (
          <div className="space-y-4">
            {tags.map((tag) => {
              const prodKey = `prod-${tag.id}`;
              const localKey = `local-${tag.id}`;
              const isTagLoading = inFlightTagId === tag.id;

              return (
                <article
                  key={tag.id}
                  className={`rounded-2xl border p-5 text-white transition-colors ${
                    tag.active
                      ? 'border-plug-border bg-plug-surface'
                      : 'border-plug-border/40 bg-plug-black opacity-75'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-black text-white">{tag.id}</span>
                        {tag.active ? (
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-plug-black">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="rounded-full border border-plug-border px-2.5 py-0.5 text-xs font-semibold text-plug-muted">
                            DEACTIVATED
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {tag.label || 'Unlabeled Tag'}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-plug-muted">
                        Created: {formatManilaDateTime(tag.created_at)} PHT
                        {tag.deactivated_at && (
                          <span className="ml-2 text-neutral-500">
                            (Deactivated: {formatManilaDateTime(tag.deactivated_at)} PHT)
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Active Actions */}
                    {tag.active && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRotateTag(tag.id)}
                          disabled={isTagLoading}
                          className="inline-flex min-h-11 items-center rounded-xl border border-white/60 bg-plug-elevated px-4 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-black disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          {isTagLoading ? 'Rotating...' : 'Rotate Tag'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeactivateTag(tag.id)}
                          disabled={isTagLoading}
                          className="inline-flex min-h-11 items-center rounded-xl border border-red-500/40 bg-red-950/40 px-4 text-sm font-semibold text-red-200 transition-colors hover:bg-red-900/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          {isTagLoading ? 'Deactivating...' : 'Deactivate Tag'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* URLs to write to NTAG215 */}
                  <div className="mt-4 space-y-2 border-t border-plug-border pt-4">
                    <p className="text-sm font-medium text-plug-muted">
                      Exact URL to write to NTAG215 in NFC Tools:
                    </p>

                    {/* Production Tap URL */}
                    <div className="flex flex-col gap-2 rounded-xl border border-plug-border bg-plug-black p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="overflow-hidden">
                        <span className="text-xs text-plug-muted block">
                          Production URL (card.thecaffeineplug.ph):
                        </span>
                        <code className="block truncate font-mono text-xs text-white">
                          {tag.productionTapUrl}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(tag.productionTapUrl, prodKey)}
                        className="shrink-0 inline-flex min-h-11 items-center justify-center rounded-xl border border-plug-border bg-plug-elevated px-4 text-sm font-semibold text-white transition-colors hover:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        {copiedKey === prodKey ? '✓ Copied' : 'Copy Production URL'}
                      </button>
                    </div>

                    {/* Local Tap URL */}
                    <div className="flex flex-col gap-2 rounded-xl border border-plug-border bg-plug-black p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="overflow-hidden">
                        <span className="text-xs text-plug-muted block">Local Dev URL:</span>
                        <code className="block truncate font-mono text-xs text-neutral-300">
                          {tag.localTapUrl}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(tag.localTapUrl, localKey)}
                        className="shrink-0 inline-flex min-h-11 items-center justify-center rounded-xl border border-plug-border bg-plug-elevated px-4 text-sm font-semibold text-plug-muted transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        {copiedKey === localKey ? '✓ Copied' : 'Copy Local URL'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
