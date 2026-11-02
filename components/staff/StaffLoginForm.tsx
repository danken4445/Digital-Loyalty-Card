'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useState } from 'react';
import { BRAND_THEME, SHOP_CONFIG } from '@/lib/config';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const supabase = createSupabaseBrowserClient();
    const cleanEmail = email.trim();

    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
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

        const emailRedirectTo = `${configuredSiteUrl}${destination}`;

        const { error } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: {
            emailRedirectTo,
          },
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
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-plug-border bg-plug-surface p-6 text-white shadow-2xl sm:p-8">
      {/* Brand Header */}
      <div className="mb-6 flex items-center gap-4">
        <Image
          src={BRAND_THEME.assets.logoCircleDark}
          alt={`${SHOP_CONFIG.name} logo`}
          width={56}
          height={56}
          priority
          className="h-14 w-14 shrink-0 rounded-full border border-plug-border"
        />
        <div>
          <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white">
            Staff Access
          </h1>
          <p className="mt-1.5 text-sm text-neutral-300">
            Sign in with your barista or owner account.
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
          className="mb-6 rounded-xl border border-white/30 bg-plug-elevated p-4 text-xs font-medium text-white"
        >
          {statusMessage}
        </div>
      )}

      {/* Mode Toggle */}
      <div className="mb-6 flex rounded-xl border border-plug-border bg-plug-black p-1">
        <button
          type="button"
          onClick={() => {
            setMode('password');
            setErrorMessage(null);
            setStatusMessage(null);
          }}
          className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            mode === 'password' ? 'bg-white text-black' : 'text-plug-muted hover:text-white'
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
            mode === 'magic-link' ? 'bg-white text-black' : 'text-plug-muted hover:text-white'
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
            placeholder="barista@thecaffeineplug.ph"
            className="mt-1.5 w-full min-h-12 rounded-xl border border-plug-border bg-plug-black px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
              className="mt-1.5 w-full min-h-12 rounded-xl border border-plug-border bg-plug-black px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="mt-2 w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-4 py-2.5 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black"
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
