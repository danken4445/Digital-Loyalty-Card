'use client';

import React, { useId, useState } from 'react';
import Image from 'next/image';
import { getContrastRatio, resolveCardTheme } from '@/lib/brand/contrast';
import type { ApiResponse, TenantBrand } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface BrandSettingsFormProps {
  slug: string;
  tenantId: string;
  tenantName: string;
  canManage: boolean;
  initialBrand: TenantBrand;
  /** Stamps needed for the reward, from the shop's Rules tab. */
  rewardThreshold: number;
  rewardLabel?: string;
}

interface ImageDropzoneProps {
  label: string;
  value: string;
  uploading: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}

/** Drag-and-drop / click-to-browse image picker. Never shows the storage URL. */
function ImageDropzone({ label, value, uploading, disabled, onFile, onClear }: ImageDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
      className={`flex items-center gap-4 border border-dashed p-4 transition-colors ${
        dragging ? 'border-amber-500 bg-amber-500/10' : 'border-neutral-700 bg-black/40'
      }`}
    >
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-neutral-700 bg-neutral-800 text-[10px] text-neutral-500">
        {value ? (
          <Image src={value} alt={`${label} preview`} fill sizes="64px" className="object-cover" unoptimized />
        ) : (
          'No image'
        )}
      </div>
      <div className="min-w-0 flex-1 text-xs text-neutral-300">
        <p>{uploading ? 'Uploading...' : 'Drag & drop an image here, or'}</p>
        <div className="mt-1.5 flex gap-2">
          <label
            htmlFor={inputId}
            className={`border border-neutral-700 bg-neutral-800 px-3 py-1.5 font-semibold uppercase tracking-wider text-neutral-200 ${
              disabled || uploading ? 'opacity-50' : 'cursor-pointer hover:bg-neutral-700'
            }`}
          >
            {value ? 'Replace' : 'Browse'}
          </label>
          {value && !disabled && (
            <button
              type="button"
              onClick={onClear}
              className="border border-neutral-700 px-3 py-1.5 font-semibold uppercase tracking-wider text-neutral-400 hover:text-white"
            >
              Remove
            </button>
          )}
        </div>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

export function BrandSettingsForm({
  slug,
  tenantId,
  tenantName,
  canManage,
  initialBrand,
  rewardThreshold,
  rewardLabel,
}: BrandSettingsFormProps) {
  const [primaryColor, setPrimaryColor] = useState(initialBrand.primaryColor || '#0A0A0A');
  const [accentColor, setAccentColor] = useState(initialBrand.accentColor || '#FFFFFF');
  const [tagline, setTagline] = useState(initialBrand.tagline || '');
  const [logoUrl, setLogoUrl] = useState(initialBrand.logoUrl || '');
  const [cardArtUrl, setCardArtUrl] = useState(initialBrand.cardArtUrl || '');

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingArt, setIsUploadingArt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const primaryColorId = useId();
  const accentColorId = useId();
  const taglineId = useId();

  // Resolve live theme and contrast ratio
  const currentBrand: TenantBrand = {
    primaryColor,
    accentColor,
    tagline: tagline.trim() || undefined,
    logoUrl: logoUrl.trim() || undefined,
    cardArtUrl: cardArtUrl.trim() || undefined,
  };

  const theme = resolveCardTheme(currentBrand);
  const totalSlots = Math.max(1, rewardThreshold);
  const previewStamped = Math.min(4, Math.max(0, totalSlots - 1));
  const initials =
    tenantName
      .split(/s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  const contrastRatio = getContrastRatio(theme.accentColor, theme.primaryColor);
  const isContrastWarning = !theme.passesAA || contrastRatio < 4.5;

  async function handleFileUpload(file: File, kind: 'logo' | 'card-art') {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      setFeedback({ type: 'error', message: 'Images must be PNG, JPEG, or WebP. SVG is not allowed.' });
      return;
    }

    if (file.size > 512 * 1024) {
      setFeedback({ type: 'error', message: 'Image file size must be 512KB or less.' });
      return;
    }

    if (kind === 'logo') setIsUploadingLogo(true);
    else setIsUploadingArt(true);
    setFeedback(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const filePath = `${tenantId}/${kind}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('tenant-brand')
        .upload(filePath, file, {
          upsert: true,
          cacheControl: '3600',
        });

      if (uploadErr) {
        setFeedback({ type: 'error', message: `Storage upload failed: ${uploadErr.message}` });
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('tenant-brand')
        .getPublicUrl(filePath);

      const uploadedUrl = publicUrlData.publicUrl;
      if (kind === 'logo') {
        setLogoUrl(uploadedUrl);
      } else {
        setCardArtUrl(uploadedUrl);
      }

      setFeedback({ type: 'success', message: `${kind === 'logo' ? 'Logo' : 'Card art'} uploaded successfully.` });
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      if (kind === 'logo') setIsUploadingLogo(false);
      else setIsUploadingArt(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;

    setIsSaving(true);
    setFeedback(null);

    try {
      const payload: TenantBrand = {
        primaryColor,
        accentColor,
        tagline: tagline.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
        cardArtUrl: cardArtUrl.trim() || undefined,
      };

      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/brand`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to save brand settings.',
        });
      } else {
        setFeedback({ type: 'success', message: 'Brand configuration saved successfully.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error saving brand settings.' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      {/* Brand editor column */}
      <div className="lg:col-span-7 space-y-6">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
            Brand & Card Customization
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Configure the colors, logo, and artwork for {tenantName}. Changes update customer wallet cards and tap screens.
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

        <form onSubmit={handleSave} className="space-y-6">
          {/* Colors */}
          <div className="border border-neutral-800 bg-neutral-900/60 p-4 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">Colors</h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={primaryColorId} className="block text-xs font-medium text-neutral-300">
                  Primary Card Color (Background)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                    className="h-9 w-10 cursor-pointer border border-neutral-700 bg-black p-0.5"
                  />
                  <input
                    id={primaryColorId}
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                    className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs font-mono text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                    placeholder="#0A0A0A"
                    maxLength={7}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={accentColorId} className="block text-xs font-medium text-neutral-300">
                  Accent Color (Ink & Details)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                    className="h-9 w-10 cursor-pointer border border-neutral-700 bg-black p-0.5"
                  />
                  <input
                    id={accentColorId}
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                    className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs font-mono text-white placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
                    placeholder="#FFFFFF"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            {/* Contrast info & alert */}
            <div className="flex items-center justify-between border-t border-neutral-800 pt-3 text-xs">
              <span className="text-neutral-400">Contrast Ratio (Accent vs Primary):</span>
              <span
                className={`font-mono font-bold ${
                  contrastRatio >= 4.5 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {contrastRatio.toFixed(2)}:1 ({contrastRatio >= 4.5 ? 'Passes WCAG AA' : 'Low Contrast'})
              </span>
            </div>

            {isContrastWarning && (
              <div className="border border-amber-800/80 bg-amber-950/40 p-3 text-xs text-amber-200">
                <span className="font-bold">Contrast Warning:</span> Accent color does not achieve WCAG AA contrast (≥ 4.5:1) against the primary background. Text on the loyalty card will fall back to high-contrast white or black for legibility.
              </div>
            )}
          </div>

          {/* Tagline */}
          <div className="border border-neutral-800 bg-neutral-900/60 p-4 space-y-2">
            <label htmlFor={taglineId} className="block text-xs font-bold uppercase tracking-wider text-neutral-300">
              Shop Tagline
            </label>
            <input
              id={taglineId}
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white placeholder-neutral-600 focus:border-amber-500 focus:outline-none"
              placeholder="e.g. Specialty coffee & artisanal toast"
              maxLength={60}
            />
            <div className="flex justify-end text-[11px] text-neutral-500">
              {tagline.length}/60 characters
            </div>
          </div>

          {/* Logo Upload */}
          <div className="border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-bold uppercase tracking-wider text-neutral-300">
                Shop Logo
              </span>
              <span className="text-[11px] text-neutral-500">PNG, JPEG, WebP (Max 512KB, No SVG)</span>
            </div>

            <ImageDropzone
              label="Logo"
              value={logoUrl}
              uploading={isUploadingLogo}
              disabled={!canManage}
              onFile={(file) => handleFileUpload(file, 'logo')}
              onClear={() => setLogoUrl('')}
            />
          </div>

          {/* Card Art Upload */}
          <div className="border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-bold uppercase tracking-wider text-neutral-300">
                Card Art / Stamp Background
              </span>
              <span className="text-[11px] text-neutral-500">PNG, JPEG, WebP (Max 512KB, No SVG)</span>
            </div>

            <ImageDropzone
              label="Card art"
              value={cardArtUrl}
              uploading={isUploadingArt}
              disabled={!canManage}
              onFile={(file) => handleFileUpload(file, 'card-art')}
              onClear={() => setCardArtUrl('')}
            />
          </div>

          {canManage && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="border border-amber-500 bg-amber-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
              >
                {isSaving ? 'Saving Brand...' : 'Save Brand Settings'}
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Live Preview column */}
      <div className="lg:col-span-5 space-y-4">
        <div>
          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-neutral-300">
            Live Card Preview
          </h3>
          <p className="text-xs text-neutral-500">Simulates real customer loyalty card appearance.</p>
        </div>

        {/* Card Mockup */}
        <div
          className="relative w-full overflow-hidden border p-5 transition-colors duration-200"
          style={{
            backgroundColor: theme.primaryColor,
            borderColor: theme.cardBorder,
            color: theme.textColor,
          }}
        >
          {theme.cardArtUrl && (
            <div
              className="absolute inset-0 opacity-15 pointer-events-none bg-cover bg-center"
              style={{ backgroundImage: `url(${theme.cardArtUrl})` }}
            />
          )}

          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden rounded border border-neutral-700 bg-neutral-800 flex items-center justify-center">
                {theme.logoUrl ? (
                  <Image
                    src={theme.logoUrl}
                    alt="Logo"
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <span className="text-xs font-bold font-mono">{initials}</span>
                )}
              </div>
              <div>
                <h4 className="font-display text-base font-bold uppercase tracking-wider">
                  {tenantName}
                </h4>
                {theme.tagline && (
                  <p className="text-xs opacity-80" style={{ color: theme.subtextColor }}>
                    {theme.tagline}
                  </p>
                )}
              </div>
            </div>

            <div
              className="border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase"
              style={{ borderColor: theme.accentColor, color: theme.accentColor }}
            >
              VIP Pass
            </div>
          </div>

          {/* Stamp Preview Grid */}
          <div className="relative z-10 mt-6 grid grid-cols-5 gap-2">
            {Array.from({ length: totalSlots }, (_, i) => i + 1).map((num) => {
              const isStamped = num <= previewStamped;
              return (
                <div
                  key={num}
                  className="flex aspect-square items-center justify-center border text-xs font-mono font-bold transition-all"
                  style={{
                    backgroundColor: isStamped ? theme.accentColor : 'transparent',
                    borderColor: theme.cardBorder,
                    color: isStamped ? theme.primaryColor : theme.subtextColor,
                  }}
                >
                  {isStamped ? '✓' : num}
                </div>
              );
            })}
          </div>

          <div className="relative z-10 mt-4 flex items-center justify-between text-[11px] pt-2 border-t" style={{ borderColor: theme.cardBorder }}>
            <span style={{ color: theme.subtextColor }}>{previewStamped} of {totalSlots} stamps earned</span>
            <span className="font-bold" style={{ color: theme.accentColor }}>{rewardLabel ? `Reward: ${rewardLabel}` : 'Reward Ready Soon'}</span>
          </div>
        </div>

        {/* Preview specifications card */}
        <div className="border border-neutral-800 bg-black p-4 text-xs space-y-2">
          <div className="font-bold uppercase tracking-wider text-neutral-400">Theme Details</div>
          <div className="grid grid-cols-2 gap-2 text-neutral-300">
            <div>Primary: <code className="font-mono text-white">{theme.primaryColor}</code></div>
            <div>Accent: <code className="font-mono text-white">{theme.accentColor}</code></div>
            <div>Text Color: <code className="font-mono text-white">{theme.textColor}</code></div>
            <div>Subtext: <code className="font-mono text-white">{theme.subtextColor}</code></div>
          </div>
        </div>
      </div>
    </div>
  );
}
