'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { signInWithEmailLink } from '@/lib/auth/captchaSignIn';

export interface WalletBackupModalProps {
  customerId: string;
  isAnonymous: boolean;
  email?: string | null;
  totalCards?: number;
  isOpen?: boolean;
  onClose?: () => void;
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

/**
 * Wallet-level backup component and modal for anonymous customers.
 * Initiates account linking across all cards in the customer's wallet.
 */
export function WalletBackupModal({
  customerId: _customerId,
  isAnonymous,
  email,
  totalCards = 0,
  isOpen: controlledIsOpen,
  onClose,
}: WalletBackupModalProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [mode, setMode] = useState<BackupMode>('backup');
  const [consentChecked, setConsentChecked] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isModalOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const handleClose = () => {
    setInternalIsOpen(false);
    onClose?.();
  };

  // Backed-up state
  if (!isAnonymous) {
    const linkedAccountText = email ? `Linked to ${email}` : 'Linked to Google / Email Account';

    return (
      <section
        aria-label="Wallet Backup Status"
        className="mt-6 pt-4 border-t border-plug-border flex flex-col items-center text-center w-full"
      >
        <div className="flex items-center gap-1.5 mb-2">
          <span className="bg-white text-black font-mono text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
            WALLET BACKED UP • PROTECTED
          </span>
        </div>
        <p className="text-xs font-mono font-bold uppercase tracking-wider text-white">
          {linkedAccountText}
        </p>
        <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mt-1 max-w-[280px]">
          Your loyalty cards are safely backed up across devices.
        </p>
      </section>
    );
  }

  const getCallbackUrl = (): string => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${ROUTES.authCallback}?next=${encodeURIComponent(ROUTES.wallet)}`;
  };

  const prepareMergeIntent = async (): Promise<void> => {
    try {
      await fetch(ROUTES.api.mergeIntent, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // Continue even if network error
    }
  };

  const handleGoogleBackup = async () => {
    if (!consentChecked || isSubmitting) return;

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
        const errorText = `${error.message} ${'code' in error && typeof error.code === 'string' ? error.code : ''}`;
        if (ALREADY_REGISTERED_REGEX.test(errorText)) {
          setMode('recover');
          setStatusMessage(
            'That account already has a wallet! Sign in below to merge your current cards into your existing account.',
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
          'That account already has a wallet! Sign in below to merge your current cards into your existing account.',
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
    if (!consentChecked || isSubmitting || !cleanEmail) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await prepareMergeIntent();
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser(
        { email: cleanEmail },
        { emailRedirectTo: getCallbackUrl() },
      );

      if (error) {
        const errorText = `${error.message} ${'code' in error && typeof error.code === 'string' ? error.code : ''}`;
        if (ALREADY_REGISTERED_REGEX.test(errorText)) {
          setMode('recover');
          setStatusMessage(
            'That account already has a wallet! Sign in below to merge your current cards into your existing account.',
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
          'That account already has a wallet! Sign in below to merge your current cards into your existing account.',
        );
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecover = async () => {
    const cleanEmail = emailInput.trim();
    if (!cleanEmail || isSubmitting) return;

    if (!captchaToken) {
      setErrorMessage('Please complete the verification checkbox below.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await prepareMergeIntent();
      const supabase = createSupabaseBrowserClient();
      const res = await signInWithEmailLink(supabase, {
        email: cleanEmail,
        emailRedirectTo: getCallbackUrl(),
        captchaToken,
      });

      if (res.error) {
        setErrorMessage(res.error.message);
        setWidgetKey((k) => k + 1);
        setCaptchaToken(null);
      } else {
        setStatusMessage('Recovery link sent! Check your email to merge and restore your wallet.');
        setEmailInput('');
        setWidgetKey((k) => k + 1);
        setCaptchaToken(null);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send recovery link.');
      setWidgetKey((k) => k + 1);
      setCaptchaToken(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full mt-6">
      {/* Wallet Backup Prompt Card */}
      <div className="w-full rounded-2xl border border-plug-border bg-plug-elevated/70 p-4 sm:p-5 text-left flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold uppercase tracking-wide text-white">
              Back up all your cards with Google or Email
            </h3>
            <p className="mt-1 text-xs text-neutral-300">
              Protect {totalCards > 0 ? `all ${totalCards} cards` : 'your cards'} across shops so you never lose your stamps when clearing cookies or switching phones.
            </p>
          </div>
        </div>

        <div className="mt-1 flex flex-col gap-3">
          {/* Privacy Consent Checkbox */}
          <label className="flex items-start gap-2.5 text-xs text-neutral-400 cursor-pointer select-none">
            <input
              type="checkbox"
              id="wallet-backup-consent"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-plug-border bg-plug-surface text-white focus:ring-white"
            />
            <span>
              I agree to back up my card data in accordance with the{' '}
              <Link
                href={ROUTES.privacy}
                className="text-white underline underline-offset-2 hover:text-neutral-200"
              >
                Privacy Policy
              </Link>{' '}
              (RA 10173).
            </span>
          </label>

          {/* Action Trigger / Quick Options */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleGoogleBackup}
              disabled={!consentChecked || isSubmitting}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleIcon />
              Back up with Google
            </button>
            <button
              type="button"
              onClick={() => setInternalIsOpen(true)}
              className="flex min-h-11 items-center justify-center rounded-xl border border-plug-border bg-plug-surface px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-neutral-500"
            >
              Email Options
            </button>
          </div>
        </div>

        {statusMessage && (
          <p className="text-xs font-mono text-emerald-400 mt-1">{statusMessage}</p>
        )}
        {errorMessage && (
          <p className="text-xs font-mono text-rose-400 mt-1">{errorMessage}</p>
        )}
      </div>

      {/* Modal Dialog for detailed email flow or recovery */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-backup-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-3xl border border-plug-border bg-plug-surface p-6 shadow-2xl">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close modal"
              className="absolute top-4 right-4 rounded-lg p-2 text-neutral-400 hover:text-white"
            >
              ✕
            </button>

            <h2
              id="wallet-backup-modal-title"
              className="font-display text-xl font-bold uppercase tracking-wide text-white"
            >
              {mode === 'backup'
                ? 'Back up all your cards with Google or Email'
                : 'Recover Existing Loyalty Cards'}
            </h2>

            <p className="mt-1 text-xs text-neutral-300">
              {mode === 'backup'
                ? 'Keep your loyalty stamps across all shops safe.'
                : 'Enter your email to merge and restore your existing wallet.'}
            </p>

            {/* Mode Switcher */}
            <div className="mt-4 flex rounded-xl border border-plug-border bg-plug-elevated p-1">
              <button
                type="button"
                onClick={() => setMode('backup')}
                className={`flex-1 rounded-lg py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
                  mode === 'backup'
                    ? 'bg-white text-black'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Back Up Wallet
              </button>
              <button
                type="button"
                onClick={() => setMode('recover')}
                className={`flex-1 rounded-lg py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
                  mode === 'recover'
                    ? 'bg-white text-black'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Recover Cards
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {mode === 'backup' ? (
                <>
                  {/* Privacy Consent Checkbox inside modal */}
                  <label className="flex items-start gap-2.5 text-xs text-neutral-400 cursor-pointer select-none mb-1">
                    <input
                      type="checkbox"
                      id="wallet-backup-modal-consent"
                      checked={consentChecked}
                      onChange={(e) => setConsentChecked(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-plug-border bg-plug-surface text-white focus:ring-white"
                    />
                    <span>
                      I agree to back up my card data in accordance with the{' '}
                      <Link
                        href={ROUTES.privacy}
                        className="text-white underline underline-offset-2 hover:text-neutral-200"
                      >
                        Privacy Policy
                      </Link>{' '}
                      (RA 10173).
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={handleGoogleBackup}
                    disabled={!consentChecked || isSubmitting}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <GoogleIcon />
                    Continue with Google
                  </button>

                  <div className="relative my-1 text-center">
                    <span className="font-mono text-[10px] uppercase text-neutral-500">
                      — or enter email —
                    </span>
                  </div>

                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={handleEmailBackup}
                    disabled={!consentChecked || isSubmitting || !emailInput.trim()}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send Backup Link
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="Enter your email to recover"
                    className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-white focus:outline-none"
                  />

                  <TurnstileWidget
                    key={widgetKey}
                    onVerify={(token: string) => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken(null)}
                  />

                  <button
                    type="button"
                    onClick={handleRecover}
                    disabled={isSubmitting || !emailInput.trim()}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl bg-white px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send Recovery Link
                  </button>
                </>
              )}

              {statusMessage && (
                <p className="text-xs font-mono text-emerald-400 text-center mt-2">
                  {statusMessage}
                </p>
              )}
              {errorMessage && (
                <p className="text-xs font-mono text-rose-400 text-center mt-2">
                  {errorMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
