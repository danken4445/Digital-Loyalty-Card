'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function PlatformMfaPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') ?? ROUTES.platform.root;

  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'challenge' | 'enroll'>('challenge');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);

  // Enroll details
  const [qrCodeUri, setQrCodeUri] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);

  // Form input
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initMfa() {
      setLoading(true);
      setErrorMessage(null);

      try {
        const supabase = createSupabaseBrowserClient();
        const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();

        if (listError) {
          if (!cancelled) setErrorMessage(listError.message);
          return;
        }

        const verifiedTotp = factors?.totp?.find((f) => f.status === 'verified');

        if (verifiedTotp) {
          // Existing verified factor -> Challenge flow
          if (cancelled) return;
          setMode('challenge');
          setFactorId(verifiedTotp.id);

          const { data: challengeData, error: challengeError } =
            await supabase.auth.mfa.challenge({
              factorId: verifiedTotp.id,
            });

          if (challengeError) {
            if (!cancelled) setErrorMessage(challengeError.message);
            return;
          }

          if (!cancelled) {
            setChallengeId(challengeData.id);
          }
        } else {
          // No verified factor -> Enroll flow
          if (cancelled) return;
          setMode('enroll');

          const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
            factorType: 'totp',
            issuer: 'DigitalLoyalty',
          });

          if (enrollError) {
            if (!cancelled) setErrorMessage(enrollError.message);
            return;
          }

          if (!cancelled && enrollData) {
            setFactorId(enrollData.id);
            setQrCodeUri(enrollData.totp.qr_code);
            setTotpSecret(enrollData.totp.secret);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to initialize MFA.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initMfa();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const cleanCode = code.trim().replace(/\s+/g, '');
    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      setErrorMessage('Please enter a 6-digit numeric authenticator code.');
      return;
    }

    if (!factorId) {
      setErrorMessage('Missing authenticator factor.');
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      let activeChallengeId = challengeId;

      // In enroll mode or if challenge expired, create a challenge
      if (!activeChallengeId) {
        const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId,
        });

        if (challengeError) {
          setErrorMessage(challengeError.message);
          setSubmitting(false);
          return;
        }

        activeChallengeId = challengeData.id;
        setChallengeId(activeChallengeId);
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: activeChallengeId,
        code: cleanCode,
      });

      if (verifyError) {
        setErrorMessage(verifyError.message);
        setChallengeId(null); // Reset challenge so next submit creates a fresh challenge
        setSubmitting(false);
        return;
      }

      // Elevated to AAL2 -> navigate to destination
      router.push(nextUrl);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Verification failed.');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-plug-border bg-plug-surface p-12 text-center text-sm text-plug-muted">
        Initializing multi-factor authentication security...
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 sm:p-8">
      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-sm text-rose-300"
        >
          {errorMessage}
        </div>
      )}

      {mode === 'enroll' ? (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              Enroll TOTP Authenticator
            </h2>
            <p className="mt-1 text-sm text-plug-muted">
              Platform administration requires Multi-Factor Authentication (AAL2). Scan the QR code
              below with Google Authenticator, 1Password, or Authy.
            </p>
          </div>

          {qrCodeUri && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-plug-border bg-plug-elevated p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCodeUri}
                alt="TOTP Enrollment QR Code"
                className="h-48 w-48 rounded-lg bg-white p-2"
              />
              {totpSecret && (
                <div className="mt-4 text-center">
                  <p className="text-xs text-plug-muted">Or enter secret key manually:</p>
                  <code className="mt-1 inline-block rounded border border-plug-border bg-plug-black px-3 py-1 font-mono text-xs text-neutral-200">
                    {totpSecret}
                  </code>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="totp-code" className="block text-sm font-semibold text-white">
                Enter 6-digit Code from Authenticator
              </label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="mt-2 w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-center font-mono text-2xl tracking-widest text-white placeholder-neutral-600 transition-colors focus:border-white focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || code.trim().length !== 6}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white bg-white px-6 py-3 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : 'Complete MFA Enrollment & Sign In'}
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              Two-Factor Challenge
            </h2>
            <p className="mt-1 text-sm text-plug-muted">
              Enter the 6-digit verification code generated by your authenticator app to access the
              platform console.
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="challenge-code" className="block text-sm font-semibold text-white">
                Authentication Code
              </label>
              <input
                id="challenge-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="mt-2 w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-center font-mono text-2xl tracking-widest text-white placeholder-neutral-600 transition-colors focus:border-white focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || code.trim().length !== 6}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white bg-white px-6 py-3 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : 'Verify Code'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
