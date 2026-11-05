'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Image from 'next/image';
import { PLATFORM_CONFIG } from '@/lib/config';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export const MIN_PASSWORD_LENGTH = 8;

export interface ResetPasswordFormProps {
  email: string;
}

export function ResetPasswordForm({ email }: ResetPasswordFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      router.push(ROUTES.staff.root);
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update the password.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'mt-1.5 w-full min-h-12 rounded-xl border border-white/15 bg-odyssey-navy px-3 py-2 text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-odyssey-deep p-6 text-white shadow-2xl sm:p-8">
      <Image
        src={PLATFORM_CONFIG.assets.monogramReverse}
        alt={`${PLATFORM_CONFIG.shortName} logo`}
        width={92}
        height={45}
        priority
        className="mb-5 h-auto w-[92px]"
      />
      <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white">
        Set New Password
      </h1>
      <p className="mt-1.5 text-sm text-neutral-300">
        {email ? `Choose a new password for ${email}.` : 'Choose a new password for your account.'}
      </p>

      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-6 rounded-xl border border-red-500/50 bg-red-950/40 p-4 text-xs font-bold text-red-100"
        >
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="reset-password-new"
            className="block text-sm font-medium text-neutral-200"
          >
            New password
          </label>
          <input
            id="reset-password-new"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="reset-password-confirm"
            className="block text-sm font-medium text-neutral-200"
          >
            Confirm new password
          </label>
          <input
            id="reset-password-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="mt-2 w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-odyssey-orange bg-odyssey-orange px-4 py-2.5 text-sm font-bold text-odyssey-navy transition-transform active:scale-[0.99] hover:bg-[#ff8530] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-odyssey-deep"
        >
          {loading ? 'Saving...' : 'Save New Password'}
        </button>
      </form>
    </div>
  );
}
