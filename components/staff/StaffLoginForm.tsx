'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { OdysseyLogo } from '@/components/brand/OdysseyLogo';
import { COLORS } from '@/lib/brand/odyssey/brandTokens';
import { colourwayForBackground } from '@/lib/brand/odyssey/contrast';
import { PLATFORM_CONFIG } from '@/lib/config';

/** The card surface is Odyssey Navy, so the bible's reversed colourway applies. */
const CARD_LOGO = colourwayForBackground(COLORS.navy).colourway;
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import {
  requestPasswordReset,
  signInStaffWithPassword,
  signInWithEmailLink,
} from '@/lib/auth/captchaSignIn';

export interface StaffLoginFormProps {
  nextPath?: string;
  initialError?: string;
}

type AuthMode = 'password' | 'magic-link';

export function StaffLoginForm({ nextPath, initialError }: StaffLoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Turnstile tokens are single-use: bump the key to remount the widget for a fresh one.
  const [widgetKey, setWidgetKey] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialError === 'forbidden'
      ? 'Access denied: This account does not have active staff permissions.'
      : initialError
        ? `Authentication error: ${initialError}`
        : null,
  );

  const destination = nextPath || ROUTES.staff.root;

  async function handleSwitchAccount() {
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      setStatusMessage('Signed out. Please sign in with an authorized staff account.');
    } catch {
      setErrorMessage('Failed to sign out current session. Please clear browser cookies.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Enter your email above first, then request a reset link.');
      return;
    }
    if (!captchaToken) {
      setErrorMessage('Complete the security check below, then request a reset link.');
      return;
    }
    const token = captchaToken;
    setCaptchaToken(null);
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const configuredSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(
        /\/+$/,
        '',
      );
      const { error } = await requestPasswordReset(supabase, {
        email: cleanEmail,
        redirectTo: `${configuredSiteUrl}${ROUTES.authCallback}?next=${encodeURIComponent(ROUTES.resetPassword)}`,
        captchaToken: token,
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      // Same message whether or not the account exists, so this cannot be used to probe emails.
      setStatusMessage(
        `If ${cleanEmail} has an account, a password reset link is on its way. Check your inbox.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not send the reset link.');
    } finally {
      setLoading(false);
      setWidgetKey((k) => k + 1);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!captchaToken) {
      return;
    }
    const token = captchaToken;
    setCaptchaToken(null);
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const supabase = createSupabaseBrowserClient();
    const cleanEmail = email.trim();

    try {
      if (mode === 'password') {
        const { error } = await signInStaffWithPassword(supabase, {
          email: cleanEmail,
          password,
          captchaToken: token,
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        router.push(destination);
        router.refresh();
      } else {
        const configuredSiteUrl = (
          process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
        ).replace(/\/+$/, '');

        const emailRedirectTo =
          destination && destination !== ROUTES.staff.root
            ? `${configuredSiteUrl}${ROUTES.authCallback}?next=${encodeURIComponent(destination)}`
            : `${configuredSiteUrl}${ROUTES.authCallback}?next=${encodeURIComponent(ROUTES.staff.root)}`;

        const { error } = await signInWithEmailLink(supabase, {
          email: cleanEmail,
          emailRedirectTo,
          captchaToken: token,
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        setStatusMessage(
          `Magic sign-in link sent to ${cleanEmail}. Check your inbox to complete staff sign-in.`,
        );
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred during sign-in.',
      );
    } finally {
      setLoading(false);
      // The token was consumed by this attempt (success or failure); request a new one.
      setWidgetKey((k) => k + 1);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-odyssey-navy p-6 font-odyssey-body text-white shadow-2xl sm:p-8">
      {/* Brand Header */}
      <div className="mb-6 flex items-center gap-4">
        <OdysseyLogo
          layout="monogram"
          colourway={CARD_LOGO}
          height={45}
          accessibilityLabel={`${PLATFORM_CONFIG.shortName} logo`}
          className="shrink-0"
        />
        <div>
          <h1 className="font-odyssey-heading text-3xl font-bold leading-tight tracking-tight text-white">
            Staff Access
          </h1>
          <p className="mt-1.5 text-sm text-neutral-300">
            Sign in with your shop or platform account.
          </p>
        </div>
      </div>

      {/* Initial Error or Alert */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-6 rounded-xl border border-red-500/50 bg-red-950/40 p-4 text-xs text-red-200"
        >
          <div className="flex flex-col gap-2">
            <span className="font-bold text-red-100">{errorMessage}</span>
            {initialError === 'forbidden' && (
              <button
                type="button"
                onClick={handleSwitchAccount}
                disabled={loading}
                className="mt-1 self-start inline-flex min-h-11 items-center rounded-xl border border-red-400/40 bg-red-900/60 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Sign Out & Switch Account
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status Message */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 rounded-xl border border-white/30 bg-odyssey-deep p-4 text-xs font-medium text-white"
        >
          {statusMessage}
        </div>
      )}

      {/* Live Demo Account for Business Owners */}
      <div className="mb-6 rounded-2xl border border-odyssey-orange/30 bg-odyssey-orange/10 p-4 font-odyssey-body text-xs text-neutral-200">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-odyssey-orange px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-odyssey-navy">
            Live Demo
          </span>
          <span className="text-[11px] font-medium text-neutral-300">Business Owner Access</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-200">
          Want to explore the Owner Dashboard, Retention Analytics &amp; Counter Tools?
        </p>
        <div className="mt-2.5 space-y-1 rounded-xl border border-white/10 bg-odyssey-deep/90 p-3 font-mono text-[11px]">
          <div className="flex justify-between">
            <span className="text-neutral-400">Email:</span>
            <span className="font-semibold text-white">demo@odysseyloyalty.com</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Password:</span>
            <span className="font-semibold text-white">DemoOwner2026!</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEmail('demo@odysseyloyalty.com');
            setPassword('DemoOwner2026!');
            setMode('password');
            setErrorMessage(null);
            setStatusMessage('Demo credentials filled. Complete the security check below and sign in.');
          }}
          className="mt-3 w-full inline-flex min-h-10 items-center justify-center rounded-xl border border-odyssey-orange/50 bg-odyssey-orange/20 px-3 py-2 text-xs font-bold text-white transition hover:bg-odyssey-orange hover:text-odyssey-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Auto-fill Demo Credentials
        </button>
      </div>

      {/* Mode Toggle */}
      <div className="mb-6 flex rounded-xl border border-white/10 bg-odyssey-deep p-1">
        <button
          type="button"
          onClick={() => {
            setMode('password');
            setErrorMessage(null);
            setStatusMessage(null);
          }}
          className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            mode === 'password' ? 'bg-odyssey-warm text-odyssey-navy' : 'text-neutral-300 hover:text-white'
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('magic-link');
            setErrorMessage(null);
            setStatusMessage(null);
          }}
          className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            mode === 'magic-link' ? 'bg-odyssey-warm text-odyssey-navy' : 'text-neutral-300 hover:text-white'
          }`}
        >
          Magic Link
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="staff-login-email" className="block text-sm font-medium text-neutral-200">
            Staff Email Address
          </label>
          <input
            id="staff-login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@yourshop.com"
            className="mt-1.5 w-full min-h-12 rounded-xl border border-white/15 bg-odyssey-deep px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
        </div>

        {mode === 'password' && (
          <div>
            <label
              htmlFor="staff-login-password"
              className="block text-sm font-medium text-neutral-200"
            >
              Password
            </label>
            <input
              id="staff-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••••••"
              className="mt-1.5 w-full min-h-12 rounded-xl border border-white/15 bg-odyssey-deep px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-neutral-300 underline underline-offset-2 hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Forgot password?
            </button>
          </div>
        )}

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
          type="submit"
          disabled={loading || !captchaToken}
          aria-busy={loading}
          className="mt-2 w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-odyssey-orange bg-odyssey-orange px-4 py-2.5 text-sm font-bold text-odyssey-navy transition-transform active:scale-[0.99] hover:bg-[#ff8530] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-odyssey-navy"
        >
          {loading
            ? 'Authenticating...'
            : mode === 'password'
              ? 'Sign In with Password'
              : 'Send Magic Link'}
        </button>
      </form>
    </div>
  );
}
