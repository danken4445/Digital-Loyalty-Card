'use client';

import React, { useId, useState } from 'react';
import Image from 'next/image';
import { getContrastRatio, resolveCardTheme } from '@/lib/brand/contrast';
import { FacebookGlyph, InstagramGlyph, TikTokGlyph } from '@/components/card/SocialGlyphs';
import { StampIcon, STAMP_ICON_LABELS } from '@/components/card/StampIcon';
import {
  DEFAULT_STAMP_ICON,
  STAMP_ICON_IDS,
  type ApiResponse,
  type StampIconId,
  type TenantBrand,
} from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { CustomerCardPreview } from './CustomerCardPreview';
import { AdvancedSection, Notice, Panel, inputClass, primaryButtonClass } from './ui';

export interface BrandSettingsFormProps {
  slug: string;
  tenantId: string;
  tenantName: string;
  canManage: boolean;
  initialBrand: TenantBrand;
  /** Stamps needed for the reward, from My Card → Reward. */
  rewardThreshold: number;
  rewardLabel?: string;
  /** "basics" shows only logo, colours, tagline and stamp icon (used by the setup wizard). */
  mode?: 'full' | 'basics';
  onSaved?: () => void;
  saveLabel?: string;
}

/** Ready-made colour pairs that are always readable, so owners rarely need a colour picker. */
export const COLOUR_PRESETS: ReadonlyArray<{ name: string; primary: string; accent: string }> = [
  { name: 'Classic black', primary: '#0A0A0A', accent: '#FFFFFF' },
  { name: 'Espresso', primary: '#3B2418', accent: '#F5E6D3' },
  { name: 'Matcha', primary: '#2F4F3A', accent: '#E8F0D8' },
  { name: 'Cream', primary: '#F6EFE4', accent: '#5A3A22' },
  { name: 'Ocean', primary: '#12324A', accent: '#BFE6F7' },
  { name: 'Berry', primary: '#5B1A3A', accent: '#FFD9E6' },
  { name: 'Sunset', primary: '#FF6F07', accent: '#1A1A1A' },
  { name: 'Clean white', primary: '#FFFFFF', accent: '#111111' },
];

const READABLE_RATIO = 4.5;

/** Black or white, whichever reads better on the background. */
export function readableAccentFor(background: string): string {
  return getContrastRatio('#FFFFFF', background) >= getContrastRatio('#111111', background)
    ? '#FFFFFF'
    : '#111111';
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
      className={`flex items-center gap-4 rounded-xl border border-dashed p-4 transition-colors ${
        dragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-neutral-700 bg-black/30'
      }`}
    >
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800 text-xs text-neutral-500">
        {value ? (
          <Image src={value} alt={`${label} preview`} fill sizes="64px" className="object-cover" unoptimized />
        ) : (
          'None'
        )}
      </div>
      <div className="min-w-0 flex-1 text-sm text-neutral-300">
        <p>{uploading ? 'Uploading…' : 'Drop a picture here, or'}</p>
        <div className="mt-2 flex gap-2">
          <label
            htmlFor={inputId}
            className={`inline-flex min-h-10 items-center rounded-full border border-neutral-600 px-4 font-semibold text-white ${
              disabled || uploading ? 'opacity-50' : 'cursor-pointer hover:border-white'
            }`}
          >
            {value ? 'Change picture' : 'Choose a picture'}
          </label>
          {value && !disabled && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-10 items-center rounded-full px-3 font-medium text-neutral-400 hover:text-white"
            >
              Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-plug-muted">PNG, JPG or WebP, up to 512 KB.</p>
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

function SocialChannel({
  id,
  icon,
  name,
  enabled,
  onToggle,
  url,
  onUrl,
  placeholder,
  disabled,
}: {
  id: string;
  icon: React.ReactNode;
  name: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  url: string;
  onUrl: (v: string) => void;
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-plug-border bg-black/30 p-3">
      <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}
          Show {name} on my card
        </span>
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-5 w-5 accent-emerald-500"
        />
      </label>
      {enabled && (
        <input
          type="text"
          aria-label={`${name} link or handle`}
          value={url}
          disabled={disabled}
          onChange={(e) => onUrl(e.target.value)}
          placeholder={placeholder}
          maxLength={255}
          className={`${inputClass} mt-3 text-sm`}
        />
      )}
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
  mode = 'full',
  onSaved,
  saveLabel = 'Save changes',
}: BrandSettingsFormProps) {
  const [primaryColor, setPrimaryColor] = useState(initialBrand.primaryColor || '#0A0A0A');
  const [accentColor, setAccentColor] = useState(initialBrand.accentColor || '#FFFFFF');
  const [tagline, setTagline] = useState(initialBrand.tagline || '');
  const [logoUrl, setLogoUrl] = useState(initialBrand.logoUrl || '');
  const [cardArtUrl, setCardArtUrl] = useState(initialBrand.cardArtUrl || '');
  const [stampIcon, setStampIcon] = useState<StampIconId>(initialBrand.stampIcon ?? DEFAULT_STAMP_ICON);

  const initialSocial = initialBrand.socialLinks ?? {};
  const [socialRewardEnabled, setSocialRewardEnabled] = useState<boolean>(
    initialBrand.socialRewardEnabled ?? true,
  );
  const [socialReward, setSocialReward] = useState<string>(initialBrand.socialReward || 'Free upsize');
  const [instagramEnabled, setInstagramEnabled] = useState<boolean>(initialSocial.instagram?.enabled ?? true);
  const [instagramUrl, setInstagramUrl] = useState<string>(initialSocial.instagram?.url ?? '');
  const [facebookEnabled, setFacebookEnabled] = useState<boolean>(initialSocial.facebook?.enabled ?? false);
  const [facebookUrl, setFacebookUrl] = useState<string>(initialSocial.facebook?.url ?? '');
  const [tiktokEnabled, setTiktokEnabled] = useState<boolean>(initialSocial.tiktok?.enabled ?? false);
  const [tiktokUrl, setTiktokUrl] = useState<string>(initialSocial.tiktok?.url ?? '');

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingArt, setIsUploadingArt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const primaryColorId = useId();
  const accentColorId = useId();
  const taglineId = useId();
  const socialRewardEnabledId = useId();
  const socialRewardId = useId();
  const instagramEnabledId = useId();
  const facebookEnabledId = useId();
  const tiktokEnabledId = useId();

  const currentBrand: TenantBrand = {
    primaryColor,
    accentColor,
    tagline: tagline.trim() || undefined,
    logoUrl: logoUrl.trim() || undefined,
    cardArtUrl: cardArtUrl.trim() || undefined,
    stampIcon,
    socialReward: socialReward.trim() || undefined,
    socialRewardEnabled,
    socialLinks: {
      instagram: { enabled: instagramEnabled, url: instagramUrl.trim() },
      facebook: { enabled: facebookEnabled, url: facebookUrl.trim() },
      tiktok: { enabled: tiktokEnabled, url: tiktokUrl.trim() },
    },
  };

  const theme = resolveCardTheme(currentBrand);
  const isHardToRead = !theme.passesAA || getContrastRatio(theme.accentColor, theme.primaryColor) < READABLE_RATIO;
  const activePreset = COLOUR_PRESETS.find(
    (p) => p.primary === primaryColor.toUpperCase() && p.accent === accentColor.toUpperCase(),
  );

  async function handleFileUpload(file: File, kind: 'logo' | 'card-art') {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      setFeedback({ type: 'error', message: 'Please use a PNG, JPG or WebP picture.' });
      return;
    }

    if (file.size > 512 * 1024) {
      setFeedback({
        type: 'error',
        message: 'That picture is too big. Please use one under 512 KB (try a smaller or compressed version).',
      });
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
        .upload(filePath, file, { upsert: true, cacheControl: '3600' });

      if (uploadErr) {
        setFeedback({ type: 'error', message: "The picture didn't upload. Please try again." });
        return;
      }

      const { data: publicUrlData } = supabase.storage.from('tenant-brand').getPublicUrl(filePath);
      if (kind === 'logo') setLogoUrl(publicUrlData.publicUrl);
      else setCardArtUrl(publicUrlData.publicUrl);

      setFeedback({
        type: 'success',
        message: `${kind === 'logo' ? 'Logo' : 'Background picture'} added. Remember to save.`,
      });
    } catch {
      setFeedback({ type: 'error', message: "The picture didn't upload. Please try again." });
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
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/brand`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentBrand),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : "Your changes weren't saved. Please try again.",
        });
      } else {
        setFeedback({ type: 'success', message: 'Saved. Your card is updated on customers’ phones.' });
        onSaved?.();
      }
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        {!canManage && <Notice tone="info">Only owners and managers can change how the card looks.</Notice>}
        {feedback && <Notice tone={feedback.type}>{feedback.message}</Notice>}

        <form onSubmit={handleSave} className="space-y-6">
          <Panel title="Logo" description="Usually a square picture of your logo works best.">
            <ImageDropzone
              label="Logo"
              value={logoUrl}
              uploading={isUploadingLogo}
              disabled={!canManage}
              onFile={(file) => handleFileUpload(file, 'logo')}
              onClear={() => setLogoUrl('')}
            />
          </Panel>

          <Panel title="Colours" description="Pick a style. You can fine-tune it below.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Colour style">
              {COLOUR_PRESETS.map((p) => {
                const selected = activePreset?.name === p.name;
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!canManage}
                    onClick={() => {
                      setPrimaryColor(p.primary);
                      setAccentColor(p.accent);
                    }}
                    className={`flex min-h-14 min-w-0 flex-col items-start gap-1.5 rounded-xl border p-2 text-left text-sm sm:flex-row sm:items-center sm:gap-2 transition-colors disabled:opacity-50 ${
                      selected ? 'border-white bg-white/10 text-white' : 'border-plug-border text-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-xs font-bold"
                      style={{ backgroundColor: p.primary, color: p.accent }}
                      aria-hidden="true"
                    >
                      Aa
                    </span>
                    <span className="min-w-0 leading-tight">{p.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <label htmlFor={primaryColorId} className="flex items-center gap-3 text-sm text-neutral-300">
                <input
                  id={primaryColorId}
                  type="color"
                  value={primaryColor}
                  disabled={!canManage}
                  onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                  className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-neutral-700 bg-black p-0.5"
                />
                Background
              </label>
              <label htmlFor={accentColorId} className="flex items-center gap-3 text-sm text-neutral-300">
                <input
                  id={accentColorId}
                  type="color"
                  value={accentColor}
                  disabled={!canManage}
                  onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                  className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-neutral-700 bg-black p-0.5"
                />
                Text &amp; stamps
              </label>
            </div>

            {isHardToRead && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-600/60 bg-amber-950/30 p-3 text-sm text-amber-100">
                <span>These two colours are hard to read together. We&apos;ll keep the card readable for you.</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setAccentColor(readableAccentFor(primaryColor))}
                    className="inline-flex min-h-10 items-center rounded-full bg-amber-400 px-4 font-semibold text-plug-black hover:bg-amber-300"
                  >
                    Fix it for me
                  </button>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Short line under your name" description="Optional. For example: Specialty coffee & toast.">
            <input
              id={taglineId}
              type="text"
              aria-label="Short line under your name"
              value={tagline}
              disabled={!canManage}
              onChange={(e) => setTagline(e.target.value)}
              className={inputClass}
              placeholder="Specialty coffee & toast"
              maxLength={60}
            />
            <p className="mt-1 text-right text-xs text-plug-muted">{tagline.length}/60</p>
          </Panel>

          <Panel title="Stamp picture" description="The little picture that fills each stamp spot.">
            <fieldset>
              <legend className="sr-only">Stamp picture</legend>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {STAMP_ICON_IDS.map((id) => {
                  const selected = stampIcon === id;
                  return (
                    <label
                      key={id}
                      title={STAMP_ICON_LABELS[id]}
                      className={`flex aspect-square items-center justify-center rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-white ${
                        selected
                          ? 'border-white bg-white/10 text-white'
                          : 'border-plug-border text-neutral-400 hover:text-white'
                      } ${canManage ? 'cursor-pointer' : 'opacity-50'}`}
                    >
                      <input
                        type="radio"
                        name="stamp-icon"
                        value={id}
                        checked={selected}
                        disabled={!canManage}
                        onChange={() => setStampIcon(id)}
                        className="sr-only"
                      />
                      <StampIcon icon={id} className="h-6 w-6" />
                      <span className="sr-only">{STAMP_ICON_LABELS[id]}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </Panel>

          {mode === 'full' && (
            <>
              <AdvancedSection
                summary="Follow-us bonus (optional)"
                hint="Show your social pages and give a one-time treat to customers who follow you."
              >
                <div className="space-y-4">
                  <label htmlFor={socialRewardEnabledId} className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">Give a treat for following us</span>
                    <input
                      id={socialRewardEnabledId}
                      type="checkbox"
                      checked={socialRewardEnabled}
                      disabled={!canManage}
                      onChange={(e) => setSocialRewardEnabled(e.target.checked)}
                      className="h-5 w-5 accent-emerald-500"
                    />
                  </label>

                  {socialRewardEnabled && (
                    <div>
                      <label htmlFor={socialRewardId} className="block text-sm text-neutral-300">
                        What do they get?
                      </label>
                      <input
                        id={socialRewardId}
                        type="text"
                        value={socialReward}
                        disabled={!canManage}
                        onChange={(e) => setSocialReward(e.target.value)}
                        placeholder="Free upsize"
                        maxLength={80}
                        className={`${inputClass} mt-1.5`}
                      />
                      <p className="mt-1.5 text-xs text-plug-muted">
                        The card says &ldquo;Follow us, get {socialReward.toLowerCase() || 'your treat'}&rdquo;. Your staff
                        checks they followed before giving it.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <SocialChannel
                      id={instagramEnabledId}
                      icon={<InstagramGlyph className="h-4 w-4 text-pink-400" />}
                      name="Instagram"
                      enabled={instagramEnabled}
                      onToggle={setInstagramEnabled}
                      url={instagramUrl}
                      onUrl={setInstagramUrl}
                      placeholder="@yourshop"
                      disabled={!canManage}
                    />
                    <SocialChannel
                      id={facebookEnabledId}
                      icon={<FacebookGlyph className="h-4 w-4 text-blue-400" />}
                      name="Facebook"
                      enabled={facebookEnabled}
                      onToggle={setFacebookEnabled}
                      url={facebookUrl}
                      onUrl={setFacebookUrl}
                      placeholder="facebook.com/yourshop"
                      disabled={!canManage}
                    />
                    <SocialChannel
                      id={tiktokEnabledId}
                      icon={<TikTokGlyph className="h-4 w-4 text-cyan-400" />}
                      name="TikTok"
                      enabled={tiktokEnabled}
                      onToggle={setTiktokEnabled}
                      url={tiktokUrl}
                      onUrl={setTiktokUrl}
                      placeholder="@yourshop"
                      disabled={!canManage}
                    />
                  </div>
                </div>
              </AdvancedSection>

              <AdvancedSection
                summary="Background picture (optional)"
                hint="A photo or pattern behind the stamps. Leave empty for a clean card."
              >
                <ImageDropzone
                  label="Background picture"
                  value={cardArtUrl}
                  uploading={isUploadingArt}
                  disabled={!canManage}
                  onFile={(file) => handleFileUpload(file, 'card-art')}
                  onClear={() => setCardArtUrl('')}
                />
              </AdvancedSection>
            </>
          )}

          {canManage && (
            <div className="flex justify-end">
              <button type="submit" disabled={isSaving || isUploadingLogo || isUploadingArt} className={primaryButtonClass}>
                {isSaving ? 'Saving…' : saveLabel}
              </button>
            </div>
          )}
        </form>
      </div>

      <div className="space-y-3 lg:sticky lg:top-32 lg:col-span-5 lg:self-start">
        <div>
          <h2 className="text-base font-semibold text-white">What customers see</h2>
          <p className="text-sm text-plug-muted">Updates as you make changes.</p>
        </div>
        <CustomerCardPreview
          tenantId={tenantId}
          tenantName={tenantName}
          brand={currentBrand}
          rewardThreshold={rewardThreshold}
          rewardLabel={rewardLabel}
        />
      </div>
    </div>
  );
}
