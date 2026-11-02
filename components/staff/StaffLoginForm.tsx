'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
    <div className="w-full max-w-md rounded-lg border border-[#27272A] bg-[#121214] p-6 text-white shadow-2xl sm:p-8">
      {/* Brand Header */}
      <div className="mb-6 border-b border-[#27272A] pb-4">
        <p className="font-mono text-xs font-semibold tracking-widest text-[#A1A1AA] uppercase">
          Portal Authentication
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-white uppercase">
          Staff Access
        </h1>
        <p className="mt-1 text-xs text-[#A1A1AA]">
          Sign in with an active barista or owner account to access operations.
        </p>
      </div>

      {/* Initial Error or Alert */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-6 rounded border border-red-500/50 bg-red-950/40 p-4 text-xs text-red-200"
        >
          <div className="flex flex-col gap-2">
            <span className="font-bold text-red-100">{errorMessage}</span>
            {initialError === 'forbidden' && (
              <button
                type="button"
                onClick={handleSwitchAccount}
                disabled={loading}
                className="mt-1 self-start rounded border border-red-400/40 bg-red-900/60 px-3 py-1 text-xs font-semibold text-white uppercase transition-colors hover:bg-red-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
          className="mb-6 rounded border border-white/30 bg-[#1C1C1F] p-4 text-xs font-medium text-white"
        >
          {statusMessage}
        </div>
      )}

      {/* Mode Toggle */}
      <div className="mb-6 flex rounded border border-[#27272A] bg-[#0A0A0A] p-1">
        <button
          type="button"
          onClick={() => {
            setMode('password');
            setErrorMessage(null);
            setStatusMessage(null);
          }}
          className={`flex-1 rounded py-1.5 text-xs font-bold tracking-wider uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            mode === 'password' ? 'bg-white text-black' : 'text-[#A1A1AA] hover:text-white'
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
          className={`flex-1 rounded py-1.5 text-xs font-bold tracking-wider uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            mode === 'magic-link' ? 'bg-white text-black' : 'text-[#A1A1AA] hover:text-white'
          }`}
        >
          Magic Link
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="staff-login-email"
            className="block text-xs font-bold tracking-wider text-[#A1A1AA] uppercase"
          >
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
            className="mt-1.5 w-full rounded border border-[#27272A] bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
        </div>

        {mode === 'password' && (
          <div>
            <label
              htmlFor="staff-login-password"
              className="block text-xs font-bold tracking-wider text-[#A1A1AA] uppercase"
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
              className="mt-1.5 w-full rounded border border-[#27272A] bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="mt-2 w-full rounded border border-white bg-white px-4 py-2.5 text-xs font-black tracking-widest text-black uppercase transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
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
