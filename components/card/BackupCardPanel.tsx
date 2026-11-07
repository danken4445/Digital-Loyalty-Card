'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { signInWithEmailLink } from '@/lib/auth/captchaSignIn';

export interface BackupCardPanelProps {
  customerId: string;
  isAnonymous: boolean;
  email?: string | null;
  displayName?: string | null;
  availableStamps: number;
}

type BackupMode = 'backup' | 'recover';

const ALREADY_REGISTERED_REGEX =
  /already registered|already been registered|already linked|identity_already_exists|email_exists/i;

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export function BackupCardPanel({
  customerId: _customerId,
  isAnonymous,
  email,
  displayName,
  availableStamps: _availableStamps,
}: BackupCardPanelProps) {
  const [mode, setMode] = useState<BackupMode>('backup');
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [emailInput, setEmailInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Turnstile tokens are single-use: bump the key to remount the widget for a fresh one.
  const [widgetKey, setWidgetKey] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. BACKED-UP STATE (isAnonymous === false)
  if (!isAnonymous) {
    const linkedAccountText = displayName
      ? `${displayName}${email ? ` (${email})` : ''}`
      : email
        ? `Linked to ${email}`
        : 'Linked to Google / Email Account';

    return (
      <section
        aria-label="Card Backup Status"
        className="mt-6 pt-4 border-t border-plug-border flex flex-col items-center text-center"
      >
        <div className="flex items-center gap-1.5 mb-2">
          <span className="bg-white text-black font-mono text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
            CARD BACKED UP • PROTECTED
          </span>
        </div>
        <p className="text-xs font-mono font-bold uppercase tracking-wider text-white">
          {linkedAccountText}
        </p>
        <p className="text-[10px] font-mono uppercase tracking-wider text-plug-muted mt-1 max-w-[280px]">
          Your stamps are safely backed up across browser resets and phone upgrades.
        </p>
      </section>
    );
  }

  // Helper for origin callback URLs. Always carries a query string because the email templates
  // append `&token_hash=...` to the redirect URL.
  const getCallbackUrl = (): string => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${ROUTES.authCallback}?next=${encodeURIComponent(ROUTES.card)}`;
  };

  // Prepares the server-side signed merge intent cookie before session change
  const prepareMergeIntent = async (): Promise<void> => {
    try {
      await fetch(ROUTES.api.mergeIntent, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // Continue even if network error so OAuth or OTP is not blocked
    }
  };

  const handleGoogleBackup = async () => {
    if (!consentChecked || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      // Issue the signed merge-intent cookie first so that signing into Google (whether a new or
      // existing Google account) atomically transfers all anonymous stamps/perks in /auth/callback
      // without relying on GoTrue's optional /user/identities/authorize manual-linking endpoint.
      await prepareMergeIntent();
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getCallbackUrl(),
        },
      });

      if (error) {
        const errorText = `${error.message} ${'code' in error && typeof error.code === 'string' ? error.code : ''}`;
        if (ALREADY_REGISTERED_REGEX.test(errorText)) {
          setMode('recover');
          setStatusMessage(
            'That account already has a card! Sign in below to merge your current stamps into your existing card.',
          );
        } else {
          setErrorMessage(error.message);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect Google account.';
      if (ALREADY_REGISTERED_REGEX.test(msg)) {
        setMode('recover');
        setStatusMessage(
          'That account already has a card! Sign in below to merge your current stamps into your existing card.',
        );
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailBackup = async () => {
    const cleanEmail = emailInput.trim();
    if (!consentChecked || isSubmitting || !cleanEmail) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await prepareMergeIntent();
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser(
        { email: cleanEmail },
        {
          emailRedirectTo: getCallbackUrl(),
        },
      );

      if (error) {
        const errorText = `${error.message} ${'code' in error && typeof error.code === 'string' ? error.code : ''}`;
        if (ALREADY_REGISTERED_REGEX.test(errorText)) {
          setMode('recover');
          setStatusMessage(
            'That account already has a card! Sign in below to merge your current stamps into your existing card.',
          );
        } else {
          setErrorMessage(error.message);
        }
      } else {
        setStatusMessage('Check your email for the confirmation link!');
        setEmailInput('');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send backup email link.';
      if (ALREADY_REGISTERED_REGEX.test(msg)) {
        setMode('recover');
        setStatusMessage(
          'That account already has a card! Sign in below to merge your current stamps into your existing card.',
        );
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleRecover = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await prepareMergeIntent();
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getCallbackUrl(),
        },
      });

      if (error) {
        setErrorMessage(error.message);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Google recovery sign-in failed. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailRecover = async () => {
    const cleanEmail = emailInput.trim();
    if (isSubmitting || !cleanEmail || !captchaToken) {
      return;
    }
    const token = captchaToken;
    setCaptchaToken(null);

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await prepareMergeIntent();
      const supabase = createSupabaseBrowserClient();
      const { error } = await signInWithEmailLink(supabase, {
        email: cleanEmail,
        emailRedirectTo: getCallbackUrl(),
        captchaToken: token,
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setStatusMessage('Check your email for the confirmation link!');
        setEmailInput('');
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Recovery link request failed. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
      setWidgetKey((k) => k + 1);
    }
  };

  // 2. ANONYMOUS PASS BACKUP & RECOVERY VIEW
  return (
    <section
      aria-label="Card Backup and Recovery"
      className="mt-6 pt-5 border-t border-plug-border text-left"
    >
      {/* Mode Toggle Buttons */}
      <div className="flex rounded-xl border border-plug-border bg-plug-black p-1 mb-5">
        <button
          type="button"
          onClick={() => {
            setMode('backup');
            setErrorMessage(null);
            setStatusMessage(null);
          }}
          className={`flex-1 py-2 px-3 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${mode === 'backup' ? 'bg-white text-black shadow-sm' : 'text-plug-muted hover:text-white'
            }`}
        >
          BACK UP THIS CARD
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('recover');
            setErrorMessage(null);
            setStatusMessage(null);
          }}
          className={`flex-1 py-2 px-3 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${mode === 'recover'
              ? 'bg-white text-black shadow-sm'
              : 'text-plug-muted hover:text-white'
            }`}
        >
          RECOVER EXISTING CARD
        </button>
      </div>

      {/* Role status success feedback */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-xl border border-white/30 bg-plug-elevated p-3 text-xs font-mono text-white text-center leading-relaxed"
        >
          {statusMessage}
        </div>
      )}

      {/* Role alert error feedback */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-xl border border-red-500/60 bg-red-950/70 p-3 text-xs font-mono text-red-200 text-center flex flex-col items-center gap-1 leading-relaxed"
        >
          <span className="font-bold text-red-400 uppercase tracking-wide">Notice</span>
          <p>{errorMessage}</p>
        </div>
      )}

      {mode === 'backup' ? (
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-sm font-black uppercase tracking-wider text-white">
              BACK UP MY CARD
            </h2>
            <p className="text-xs font-mono text-plug-muted mt-1 leading-relaxed">
              Link Google or Email so your stamps survive clearing your browser or switching phones.
            </p>
          </div>

          {/* Mandatory Consent & Privacy Notice Checkbox */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-plug-elevated/60 border border-plug-border">
            <input
              id="backup-consent-checkbox"
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-plug-border bg-plug-black text-white accent-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
            <label
              htmlFor="backup-consent-checkbox"
              className="text-[11px] font-mono text-neutral-300 leading-snug cursor-pointer select-none"
            >
              I consent to linking my Google or email account to back up my loyalty card in
              accordance with the{' '}
              <Link
                href={ROUTES.privacy}
                className="underline text-white hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
              >
                Privacy Notice
              </Link>
              .
            </label>
          </div>

          {/* Action 1 — Link Google */}
          <div>
            <button
              type="button"
              disabled={!consentChecked || isSubmitting}
              onClick={handleGoogleBackup}
              className="w-full py-3 px-4 bg-white text-black font-display font-black text-xs tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_15px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <GoogleIcon />
              <span>{isSubmitting ? 'CONNECTING...' : 'BACK UP WITH GOOGLE'}</span>
            </button>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-plug-border" />
            <span className="flex-shrink mx-3 text-[10px] font-mono text-plug-muted uppercase tracking-widest">
              OR
            </span>
            <div className="flex-grow border-t border-plug-border" />
          </div>

          {/* Action 2 — Link Email */}
          <div className="space-y-2">
            <label
              htmlFor="backup-email-input"
              className="block text-xs font-mono font-bold tracking-wider text-plug-muted uppercase"
            >
              Or Back Up with Email
            </label>
            <input
              id="backup-email-input"
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full rounded-xl border border-plug-border bg-plug-black px-3.5 py-2.5 text-xs font-mono text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
            <button
              type="button"
              disabled={!consentChecked || isSubmitting || !emailInput.trim()}
              onClick={handleEmailBackup}
              className="w-full py-2.5 px-4 bg-plug-surface text-white font-mono font-bold text-xs tracking-wider uppercase border border-plug-border hover:bg-zinc-800 hover:border-zinc-500 transition-all select-none flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {isSubmitting ? 'SENDING...' : 'SEND BACKUP LINK'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-sm font-black uppercase tracking-wider text-white">
              RECOVER / MERGE CARD
            </h2>
            <p className="text-xs font-mono text-plug-muted mt-1 leading-relaxed">
              Already backed up a card? Sign in below. Any stamps on this device will automatically
              merge into your backed-up card.
            </p>
          </div>

          {/* Recover with Google */}
          <div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleGoogleRecover}
              className="w-full py-3 px-4 bg-white text-black font-display font-black text-xs tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_15px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <GoogleIcon />
              <span>{isSubmitting ? 'CONNECTING...' : 'SIGN IN WITH GOOGLE & MERGE'}</span>
            </button>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-plug-border" />
            <span className="flex-shrink mx-3 text-[10px] font-mono text-plug-muted uppercase tracking-widest">
              OR
            </span>
            <div className="flex-grow border-t border-plug-border" />
          </div>

          {/* Recover with Email */}
          <div className="space-y-2">
            <label
              htmlFor="recover-email-input"
              className="block text-xs font-mono font-bold tracking-wider text-plug-muted uppercase"
            >
              Account Email Address
            </label>
            <input
              id="recover-email-input"
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full rounded-xl border border-plug-border bg-plug-black px-3.5 py-2.5 text-xs font-mono text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
            <TurnstileWidget
              key={widgetKey}
              onVerify={(token) => setCaptchaToken(token)}
              onExpire={() => setCaptchaToken(null)}
              onError={() => {
                setCaptchaToken(null);
                setErrorMessage('Security check failed. Please refresh the page and try again.');
              }}
            />
            <button
              type="button"
              disabled={isSubmitting || !emailInput.trim() || !captchaToken}
              onClick={handleEmailRecover}
              className="w-full py-2.5 px-4 bg-plug-surface text-white font-mono font-bold text-xs tracking-wider uppercase border border-plug-border hover:bg-zinc-800 hover:border-zinc-500 transition-all select-none flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {isSubmitting ? 'SENDING...' : 'SEND RECOVERY MAGIC LINK'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default BackupCardPanel;
