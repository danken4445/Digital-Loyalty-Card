/**
 * Small, shared building blocks for the shop-owner screens so every page has the same rhythm:
 * a plain-language heading, calm cards, friendly notices and a tucked-away "Advanced" area.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-prose text-base leading-relaxed text-neutral-300">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  className = '',
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-plug-border bg-plug-surface p-5 sm:p-6 ${className}`}>
      {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
      {description && <p className="mt-1 text-sm leading-relaxed text-plug-muted">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}

const NOTICE_STYLES = {
  success: 'border-emerald-700/70 bg-emerald-950/40 text-emerald-100',
  error: 'border-rose-700/70 bg-rose-950/40 text-rose-100',
  info: 'border-sky-700/60 bg-sky-950/30 text-sky-100',
  warning: 'border-amber-600/70 bg-amber-950/30 text-amber-100',
} as const;

export function Notice({
  tone,
  children,
  title,
}: {
  tone: keyof typeof NOTICE_STYLES;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm leading-relaxed ${NOTICE_STYLES[tone]}`}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

/** Collapsed by default: settings most shops never need to touch. */
export function AdvancedSection({
  summary = 'Advanced settings',
  hint = 'Most shops never need to change these.',
  children,
}: {
  summary?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-plug-border bg-plug-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold text-white">{summary}</span>
          <span className="block text-xs text-plug-muted">{hint}</span>
        </span>
        <svg
          className="h-5 w-5 shrink-0 text-plug-muted transition-transform group-open:rotate-180"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-plug-border px-5 py-5">{children}</div>
    </details>
  );
}

/** Empty states teach the next action instead of just saying "nothing here". */
export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-plug-border p-8 text-center">
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-plug-muted">{description}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-plug-black hover:bg-neutral-200"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

/** Field styling without a width, for inputs that sit inside a sentence. */
export const inlineInputClass =
  'rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-base text-white placeholder-neutral-500 focus:border-white focus:outline-none disabled:opacity-60';

export const inputClass = `block w-full ${inlineInputClass}`;

export const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-plug-black transition-colors hover:bg-neutral-200 disabled:opacity-50';

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-neutral-600 px-5 text-sm font-semibold text-white transition-colors hover:border-white disabled:opacity-50';

/** Sub-navigation between closely related screens (e.g. My Card → Reward / Look). */
export function SubTabs({
  tabs,
  current,
}: {
  tabs: ReadonlyArray<{ name: string; href: string }>;
  current: string;
}) {
  return (
    <nav aria-label="Section" className="inline-flex rounded-full border border-plug-border bg-plug-surface p-1">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium transition-colors ${
              active ? 'bg-white text-plug-black' : 'text-plug-muted hover:text-white'
            }`}
          >
            {t.name}
          </Link>
        );
      })}
    </nav>
  );
}
