'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ROUTES, type ApiResponse } from '@/lib/contracts';

export interface SeparationWarning {
  id: string;
  title: string;
  description: string;
}

export const SEPARATION_WARNINGS: readonly SeparationWarning[] = [
  {
    id: 'one-way',
    title: 'One-Way Operation',
    description: 'This promotion cannot be undone from the console. The branch permanently becomes its own independent shop.',
  },
  {
    id: 'not-retroactive',
    title: 'Not Retroactive',
    description: 'Existing stamps remain on the brand card. Customers do not lose progress, but their stamps do not transfer.',
  },
  {
    id: 'two-cards',
    title: 'Customers Hold Two Cards',
    description: 'Customers tapping at this branch will now hold a separate card for this location alongside their brand card.',
  },
  {
    id: 'independent-rules',
    title: 'Independent Rules & Branding',
    description: 'Rewards, rules, branding, and privacy notice become separate. Future changes on the brand card will not apply here.',
  },
  {
    id: 'staff-copied-once',
    title: 'Staff Copied Once',
    description: 'Current owners and managers are copied to the new shop once. Future team changes on the parent will not sync.',
  },
  {
    id: 'tags-change-shop',
    title: 'Tags Move to New Shop',
    description: 'All NFC tags assigned to this branch will now stamp the branch card. Existing physical tags continue working seamlessly.',
  },
  {
    id: 'separate-billing',
    title: 'Separate Status & Billing',
    description: 'The child shop begins with the current shop status and will be billed, evaluated, or suspended independently.',
  },
];

export const DEFAULT_FOCUS_ELEMENT = 'cancel';

export interface SeparationCheckConditions {
  branchName: string;
  typedName: string;
  childSlug: string;
  agreedCheckbox: boolean;
  previewLoaded: boolean;
  previewError: string | null;
  secondsRemaining: number;
}

export function isSeparationConfirmDisabled({
  branchName,
  typedName,
  childSlug,
  agreedCheckbox,
  previewLoaded,
  previewError,
  secondsRemaining,
}: SeparationCheckConditions): boolean {
  if (typedName.trim() !== branchName.trim()) {
    return true;
  }
  if (!childSlug || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(childSlug.trim())) {
    return true;
  }
  if (!agreedCheckbox) {
    return true;
  }
  if (!previewLoaded || previewError !== null) {
    return true;
  }
  if (secondsRemaining > 0) {
    return true;
  }
  return false;
}

export interface LocationSeparationPreview {
  tagCount?: number;
  tagsCount?: number;
  branchTags?: number;
  stampsAtBranch?: number;
  stampsCount?: number;
  branchStamps?: number;
  customersWithStampsAtBranch?: number;
  cardsWithPartialProgress?: number;
  customersAlsoStampedElsewhere?: number;
}

export interface SeparationModalProps {
  slug: string;
  locationId: string;
  locationName: string;
  onClose: () => void;
  onSuccess: (childSlug: string) => void;
}

export function SeparationModal({
  slug,
  locationId,
  locationName,
  onClose,
  onSuccess,
}: SeparationModalProps) {
  const [typedName, setTypedName] = useState('');
  const [childSlug, setChildSlug] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(5);
  const [preview, setPreview] = useState<LocationSeparationPreview | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdChildSlug, setCreatedChildSlug] = useState<string | null>(null);

  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus Cancel button by default
  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  // 5-second countdown timer
  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const timer = setTimeout(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [secondsRemaining]);

  // Load preview impact summary
  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      try {
        const res = await fetch(
          `/api/staff/${encodeURIComponent(slug)}/locations/separate?locationId=${encodeURIComponent(locationId)}`,
        );
        const data = (await res.json()) as ApiResponse<LocationSeparationPreview>;
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setPreviewError(!data.ok ? data.message : 'Failed to load impact preview.');
          return;
        }
        setPreview(data.data);
        setPreviewLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : 'Network error loading preview.');
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [slug, locationId]);

  // Keyboard shortcut: Escape cancels
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (
      isSeparationConfirmDisabled({
        branchName: locationName,
        typedName,
        childSlug,
        agreedCheckbox: agreed,
        previewLoaded,
        previewError,
        secondsRemaining,
      })
    ) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/locations/separate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locationId,
          confirmName: typedName.trim(),
          childSlug: childSlug.trim(),
        }),
      });

      const data = (await res.json()) as ApiResponse<{ childSlug: string }>;
      if (!res.ok || !data.ok) {
        setSubmitError(!data.ok ? data.message : 'Failed to separate branch card.');
        setIsSubmitting(false);
        return;
      }

      setCreatedChildSlug(data.data.childSlug);
      onSuccess(data.data.childSlug);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error during separation.');
      setIsSubmitting(false);
    }
  }

  const tagCount = preview?.tagCount ?? preview?.tagsCount ?? preview?.branchTags ?? 0;
  const stampsAtBranch = preview?.stampsAtBranch ?? preview?.stampsCount ?? preview?.branchStamps ?? 0;
  const customersWithStampsAtBranch = preview?.customersWithStampsAtBranch ?? 0;
  const cardsWithPartialProgress = preview?.cardsWithPartialProgress ?? 0;
  const customersAlsoStampedElsewhere = preview?.customersAlsoStampedElsewhere ?? 0;

  const isDisabled =
    isSubmitting ||
    isSeparationConfirmDisabled({
      branchName: locationName,
      typedName,
      childSlug,
      agreedCheckbox: agreed,
      previewLoaded,
      previewError,
      secondsRemaining,
    });

  if (createdChildSlug) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="separation-success-title"
      >
        <div
          className="w-full max-w-lg border border-neutral-800 bg-neutral-900 p-6 text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Branch Promoted Successfully
          </div>
          <h2 id="separation-success-title" className="font-display text-xl font-bold uppercase tracking-wider">
            {locationName} is Now an Independent Shop
          </h2>
          <p className="mt-2 text-sm text-neutral-300">
            The branch card has been created with shop slug{' '}
            <code className="rounded bg-black px-1.5 py-0.5 font-mono text-amber-400">{createdChildSlug}</code>.
            All {tagCount} physical tag(s) from this location now stamp the new card.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Link
              href={ROUTES.staff.settings(createdChildSlug)}
              className="inline-flex items-center justify-center border border-amber-500 bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-400"
            >
              Open Branch Console
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="separation-dialog-title"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-neutral-800 bg-neutral-900 p-6 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">Card Mode Switch</span>
            <h2 id="separation-dialog-title" className="font-display text-lg font-bold uppercase tracking-wider">
              Give &ldquo;{locationName}&rdquo; Its Own Card
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-lg p-1"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Impact Summary */}
        <div className="mt-4 border border-neutral-800 bg-black p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Impact Summary</h3>
          {previewError && <p className="mt-2 text-xs text-rose-400">{previewError}</p>}
          {!previewLoaded && !previewError && (
            <p className="mt-2 text-xs text-neutral-400">Loading branch activity figures...</p>
          )}
          {previewLoaded && (
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 text-xs">
              <div>
                <span className="text-neutral-500 block">Branch Tags</span>
                <span className="font-mono text-base font-bold text-white">{tagCount}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Stamps at Branch</span>
                <span className="font-mono text-base font-bold text-white">{stampsAtBranch}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Customers at Branch</span>
                <span className="font-mono text-base font-bold text-white">{customersWithStampsAtBranch}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Partial Progress Cards</span>
                <span className="font-mono text-base font-bold text-white">{cardsWithPartialProgress}</span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-neutral-500 block">Also Stamped Elsewhere</span>
                <span className="font-mono text-base font-bold text-white">{customersAlsoStampedElsewhere}</span>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-neutral-400 border-t border-neutral-800/80 pt-2">
            Customers with stamps keep them on the brand card and start a new card at this branch.
          </p>
        </div>

        {/* All 7 Warnings in Uncollapsed Blocks */}
        <div className="mt-6 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400">
            Important Warnings (Read Carefully)
          </h3>
          <div className="space-y-2">
            {SEPARATION_WARNINGS.map((w, index) => (
              <div
                key={w.id}
                className="border border-neutral-800 bg-neutral-950/70 p-3 text-xs"
              >
                <div className="font-semibold text-amber-300">
                  {index + 1}. {w.title}
                </div>
                <div className="mt-1 text-neutral-300 leading-relaxed">{w.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Confirmation Form */}
        <form onSubmit={handleConfirm} className="mt-6 space-y-4 border-t border-neutral-800 pt-4">
          <div>
            <label htmlFor="confirm-branch-name" className="block text-xs font-medium text-neutral-300">
              Type the exact branch name <span className="font-bold text-white font-mono">&ldquo;{locationName}&rdquo;</span> to confirm:
            </label>
            <input
              id="confirm-branch-name"
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="mt-1.5 w-full border border-neutral-700 bg-black px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-amber-500 focus:outline-none"
              placeholder={locationName}
            />
          </div>

          <div>
            <label htmlFor="child-shop-slug" className="block text-xs font-medium text-neutral-300">
              New child shop URL slug (e.g. <span className="font-mono text-amber-400">{slug}-branch</span>):
            </label>
            <input
              id="child-shop-slug"
              type="text"
              value={childSlug}
              onChange={(e) => setChildSlug(e.target.value.toLowerCase())}
              className="mt-1.5 w-full border border-neutral-700 bg-black px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-amber-500 focus:outline-none"
              placeholder="new-branch-slug"
            />
          </div>

          <div className="flex items-start gap-2 pt-1">
            <input
              id="separation-agreed-checkbox"
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-700 bg-black text-amber-500 focus:ring-0"
            />
            <label htmlFor="separation-agreed-checkbox" className="text-xs text-neutral-300 leading-tight">
              I understand this cannot be undone and customers will start a new card at this branch.
            </label>
          </div>

          {submitError && (
            <div className="border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300">
              {submitError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-2">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onClose}
              className="border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:bg-neutral-700 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDisabled}
              className={`border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                isDisabled
                  ? 'border-neutral-800 bg-neutral-800/50 text-neutral-500 cursor-not-allowed'
                  : 'border-rose-600 bg-rose-600 text-white hover:bg-rose-500'
              }`}
            >
              {secondsRemaining > 0
                ? `Confirm Separation (${secondsRemaining}s)`
                : isSubmitting
                  ? 'Separating Branch...'
                  : 'Confirm Branch Separation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
