'use client';

import Image from 'next/image';
import { useId, useState } from 'react';
import { StampGrid } from '@/components/card/StampGrid';
import { resolveCardTheme } from '@/lib/brand/contrast';
import { BRAND_THEME, SHOP_CONFIG } from '@/lib/config';
import { TENANT_ONE_ID, type TenantBrand } from '@/lib/contracts';
import { calculateStampProgress } from '@/lib/rules/display';

export interface CustomerCardPreviewProps {
  tenantId: string;
  tenantName: string;
  /** The unsaved brand values currently in the editor. */
  brand: TenantBrand;
  rewardThreshold: number;
  rewardLabel?: string;
}

type PreviewView = 'card' | 'first-visit';

const VIEWS: ReadonlyArray<{ id: PreviewView; label: string }> = [
  { id: 'card', label: 'My card' },
  { id: 'first-visit', label: 'First visit' },
];

/**
 * Live, customer's-eye preview of the /card page (it redirects to the shop page at /s/[slug]).
 * Mirrors that page's markup with sample customer data, driven by the unsaved brand values, and
 * renders the real StampGrid so the stamps look exactly as customers see them.
 */
export function CustomerCardPreview({
  tenantId,
  tenantName,
  brand,
  rewardThreshold,
  rewardLabel,
}: CustomerCardPreviewProps) {
  const [view, setView] = useState<PreviewView>('card');
  const [stampOverride, setStampOverride] = useState<number | null>(null);
  const sliderId = useId();

  const isOriginalShop = tenantId === TENANT_ONE_ID;
  const theme = resolveCardTheme(brand);
  const tagline = theme.tagline ?? (isOriginalShop ? SHOP_CONFIG.tagline : null);
  const label = rewardLabel?.trim() || 'Free Coffee';
  const threshold = Math.max(1, rewardThreshold);

  const stamps = Math.min(threshold, stampOverride ?? Math.min(4, threshold - 1));
  const progress = calculateStampProgress(stamps, threshold);
  const logoSrc = theme.logoUrl ?? BRAND_THEME.assets.logoCircleDark;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Customer screen" className="flex gap-1 border border-neutral-800 bg-black p-1">
        {VIEWS.map((option) => {
          const selected = view === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setView(option.id)}
              className={`flex-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                selected ? 'bg-amber-500 text-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Phone frame: scrolls internally so the whole customer page can be inspected */}
      <div className="mx-auto w-full max-w-[390px] rounded-[2.25rem] border-[6px] border-neutral-800 bg-black shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
        <div
          data-testid="customer-card-preview"
          className="bg-topo-pattern bg-street-grid max-h-[640px] overflow-y-auto rounded-[1.75rem] px-3 py-5"
        >
          {view === 'first-visit' ? (
            <section
              aria-label="Preview: first visit screen"
              className="flex w-full flex-col items-center rounded-3xl border px-5 pb-6 pt-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.8)]"
              style={{
                backgroundColor: theme.primaryColor,
                borderColor: theme.cardBorder,
              }}
            >
              <div
                className="relative mb-2 h-20 w-20 shrink-0 rounded-full border p-1"
                style={{ backgroundColor: theme.surfaceBg, borderColor: theme.cardBorder }}
              >
                <Image
                  src={logoSrc}
                  alt={`${tenantName} logo`}
                  width={72}
                  height={72}
                  unoptimized
                  className="rounded-full object-contain"
                />
              </div>

              <h2
                className="mt-4 font-display text-4xl font-bold uppercase leading-[0.95] tracking-wide"
                style={{ color: theme.textColor }}
              >
                Get a loyalty card at {tenantName}
              </h2>

              <div className="mt-3 space-y-1.5">
                <p className="text-base leading-snug" style={{ color: theme.subtextColor }}>
                  No app download. No form. Instant digital stamp card.
                </p>
                <p className="text-base leading-snug" style={{ color: theme.subtextColor }}>
                  Collect {threshold} stamps, get {label}.
                </p>
              </div>

              <div className="mt-6 w-full">
                <span className="flex w-full items-center justify-center rounded-xl border-2 border-white bg-white px-6 py-4 font-display text-sm font-black uppercase tracking-widest text-black shadow-[0_0_20px_rgba(255,255,255,0.15)]">
                  Get my card
                </span>
              </div>
            </section>
          ) : (
            <section
              aria-label="Preview: active loyalty card"
              className="relative w-full rounded-3xl border p-5 shadow-[0_24px_60px_rgba(0,0,0,0.8)]"
              style={{
                backgroundColor: theme.primaryColor,
                borderColor: theme.cardBorder,
              }}
            >
              <header className="flex items-center gap-4">
                <div
                  className="relative h-16 w-16 shrink-0 rounded-full border p-0.5"
                  style={{ backgroundColor: theme.surfaceBg, borderColor: theme.cardBorder }}
                >
                  <Image
                    src={logoSrc}
                    alt={`${tenantName} logo`}
                    width={60}
                    height={60}
                    unoptimized
                    className="rounded-full object-contain"
                  />
                </div>

                <div className="min-w-0">
                  <h2
                    className="font-display text-3xl font-bold uppercase leading-none tracking-wide"
                    style={{ color: theme.textColor }}
                  >
                    Loyalty card
                  </h2>
                  {tagline && (
                    <p
                      className="mt-1.5 text-sm lowercase first-letter:uppercase"
                      style={{ color: theme.subtextColor }}
                    >
                      {tagline}
                    </p>
                  )}
                  <p className="mt-1 text-xs font-medium" style={{ color: theme.subtextColor }}>
                    Member Since Jan 2026
                  </p>
                </div>
              </header>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-plug-black">
                  ACTIVE WALLET
                </span>
                <span className="rounded-full border border-plug-border px-2.5 py-1 text-[11px] font-semibold text-neutral-300">
                  BACKED UP PASS
                </span>
              </div>

              <div className="mt-5 border-t pt-5" style={{ borderColor: theme.cardBorder }}>
                <StampGrid
                  availableStamps={stamps}
                  rewardThreshold={threshold}
                  rewardLabel={label}
                  milestoneStep={isOriginalShop ? undefined : null}
                  stampIcon={theme.stampIcon}
                />
              </div>

              {progress.isRewardReady && (
                <div className="mt-4 rounded-2xl border border-white/30 p-4 text-center text-xs text-white">
                  <span className="mb-1 block font-semibold uppercase tracking-wider">Reward ready</span>
                  The redeem QR code appears here for the customer to show staff.
                </div>
              )}

              <div className="mt-6 border-t pt-4" style={{ borderColor: theme.cardBorder }}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-plug-muted">Card</dt>
                  <dd className="text-right font-semibold tabular-nums text-white">Card #A1B2C3D4</dd>
                  <dt className="text-plug-muted">Member Since</dt>
                  <dd className="text-right tabular-nums text-neutral-300">Jan 2026</dd>
                  <dt className="text-plug-muted">Cards Completed</dt>
                  <dd className="text-right font-semibold tabular-nums text-white">0 cards</dd>
                  <dt className="text-plug-muted">Last stamp</dt>
                  <dd className="text-right text-neutral-300">Today</dd>
                </dl>
              </div>
            </section>
          )}

          <p className="pt-4 text-center font-mono text-[10px] uppercase tracking-widest text-plug-muted">
            {tenantName} &copy; 2026
          </p>
        </div>
      </div>

      {view === 'card' && (
        <div className="mx-auto flex w-full max-w-[390px] items-center gap-3 text-xs text-neutral-400">
          <label htmlFor={sliderId} className="shrink-0 font-medium">
            Sample stamps
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={threshold}
            step={1}
            value={stamps}
            onChange={(e) => setStampOverride(Number(e.target.value))}
            className="min-w-0 flex-1 accent-amber-500"
          />
          <span className="w-10 shrink-0 text-right font-mono text-neutral-200">
            {stamps}/{threshold}
          </span>
        </div>
      )}

      {brand.cardArtUrl?.trim() && (
        <p className="mx-auto max-w-[390px] text-[11px] leading-snug text-neutral-500">
          Card art is saved with your brand but customers don&apos;t see it on this screen yet.
        </p>
      )}
    </div>
  );
}
