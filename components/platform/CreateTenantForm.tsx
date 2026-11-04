'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROUTES, type ApiResponse, type PlatformCreateTenantResult } from '@/lib/contracts';

export function CreateTenantForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newName = e.target.value;
    setName(newName);
    // Auto-suggest slug if user hasn't explicitly customized slug
    const autoSlug = newName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    setSlug(autoSlug);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedSlug = slug.trim().toLowerCase();
    const slugRegex = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
    if (!slugRegex.test(trimmedSlug)) {
      setErrorMessage(
        'Slug must be 3-40 characters, using only lowercase letters, numbers, and hyphens (cannot start or end with a hyphen).',
      );
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(ROUTES.api.platform.tenants, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: trimmedSlug,
          ownerEmail: ownerEmail.trim(),
        }),
      });

      const body: ApiResponse<PlatformCreateTenantResult> = await res.json();

      if (!res.ok || !body.ok) {
        setErrorMessage(body.ok === false ? body.message : 'Failed to create tenant.');
        setSubmitting(false);
        return;
      }

      router.push(ROUTES.platform.tenant(trimmedSlug));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-sm text-rose-300"
        >
          {errorMessage}
        </div>
      )}

      <div>
        <label htmlFor="tenant-name" className="block text-sm font-semibold text-white">
          Merchant Shop Name
        </label>
        <p className="mb-2 text-xs text-plug-muted">The brand or business name displayed to customers.</p>
        <input
          id="tenant-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={handleNameChange}
          placeholder="e.g. The Caffeine Plug"
          className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-white placeholder-neutral-500 transition-colors focus:border-white focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="tenant-slug" className="block text-sm font-semibold text-white">
          Workspace Slug
        </label>
        <p className="mb-2 text-xs text-plug-muted">
          Unique URL identifier (e.g. yoursite.com/s/<strong>slug</strong>). Must be 3-40 lowercase
          alphanumeric characters and hyphens.
        </p>
        <input
          id="tenant-slug"
          type="text"
          required
          maxLength={40}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="e.g. caffeine-plug"
          className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 font-mono text-sm text-white placeholder-neutral-500 transition-colors focus:border-white focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="owner-email" className="block text-sm font-semibold text-white">
          Owner Email Address
        </label>
        <p className="mb-2 text-xs text-plug-muted">
          An initial owner membership invite will be created for this email address.
        </p>
        <input
          id="owner-email"
          type="email"
          required
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          placeholder="owner@example.com"
          className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-white placeholder-neutral-500 transition-colors focus:border-white focus:outline-none"
        />
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white bg-white px-6 py-3 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          {submitting ? 'Creating Tenant...' : 'Create Tenant Workspace'}
        </button>
      </div>
    </form>
  );
}
