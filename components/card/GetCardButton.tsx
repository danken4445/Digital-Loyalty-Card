'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES, type ApiResponse, type ClaimStampResponse } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';

export interface GetCardButtonProps {
  mode: 'card' | 'start';
  tagId?: string | null;
}

export function GetCardButton({ mode, tagId }: GetCardButtonProps) {
  const router = useRouter();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getButtonLabel = (): string => {
    if (isLoading) {
      return mode === 'card' ? 'CREATING YOUR CARD...' : 'CLAIMING YOUR STAMP...';
    }
    return mode === 'card' ? 'GET MY CARD' : 'GET MY CARD & CLAIM STAMP';
  };

  const handleAction = async () => {
    if (!captchaToken || isLoading) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user: existingUser },
      } = await supabase.auth.getUser();

      if (!existingUser) {
        const { error: signInError } = await supabase.auth.signInAnonymously({
          options: { captchaToken },
        });

        if (signInError) {
          setErrorMessage(
            signInError.message || 'Unable to start anonymous customer session. Please try again.',
          );
          setIsLoading(false);
          return;
        }
      }

      const response = await fetch(ROUTES.api.customers, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ captchaToken }),
      });

      if (!response.ok) {
        let errorDetail = 'Failed to provision your loyalty card. Please try again.';
        try {
          const body = (await response.json()) as { message?: string };
          if (body.message) {
            errorDetail = body.message;
          }
        } catch {
          // Fall back to default error detail
        }

        setErrorMessage(errorDetail);
        setIsLoading(false);
        return;
      }

      if (mode === 'start') {
        const trimmedTag = tagId?.trim();
        if (trimmedTag && trimmedTag.length > 0) {
          try {
            const claimResponse = await fetch(ROUTES.api.claim, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ tagId: trimmedTag }),
            });

            if (claimResponse.ok) {
              const claimJson = (await claimResponse.json()) as ApiResponse<ClaimStampResponse>;
              if (claimJson.ok && claimJson.data?.redirectTo) {
                router.push(claimJson.data.redirectTo);
                router.refresh();
                return;
              }
            }
          } catch {
            // Fall back to standard card route if claim request fails
          }
        }

        router.push(ROUTES.card);
      }
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unexpected connection error occurred. Please try again.';
      setErrorMessage(message);
      setIsLoading(false);
    }
  };

  const isButtonDisabled = !captchaToken || isLoading;

  return (
    <div className="w-full flex flex-col items-center">
      {/* Cloudflare Turnstile Verification Widget */}
      <div className="w-full flex flex-col items-center justify-center my-2">
        <TurnstileWidget
          onVerify={(token) => {
            setCaptchaToken(token);
            setErrorMessage(null);
          }}
          onExpire={() => {
            setCaptchaToken(null);
          }}
          onError={() => {
            setCaptchaToken(null);
            setErrorMessage(
              'Security check verification failed. Please refresh the page and try again.',
            );
          }}
        />
      </div>

      {/* Main High-Contrast Two-Tone CTA Button */}
      <button
        type="button"
        disabled={isButtonDisabled}
        aria-disabled={isButtonDisabled}
        aria-busy={isLoading}
        onClick={handleAction}
        className="w-full py-4 px-6 bg-white text-black font-display font-black text-sm tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_20px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl"
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-black"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        <span>{getButtonLabel()}</span>
      </button>

      {/* Helper text when waiting for verification */}
      {!captchaToken && !isLoading && !errorMessage && (
        <p className="text-[10px] font-mono uppercase tracking-wider text-plug-muted text-center mt-2.5">
          Complete the security check above to activate your card
        </p>
      )}

      {/* Accessible Error Alert Banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="w-full mt-3 p-3 bg-neutral-900 border border-red-500/60 rounded-xl text-red-200 text-xs font-mono text-center flex flex-col items-center gap-1.5 shadow-lg"
        >
          <div className="flex items-center gap-1.5 text-red-400 font-bold">
            <svg
              className="w-4 h-4 shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <span>Notice</span>
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-300">{errorMessage}</p>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-[10px] uppercase font-bold text-neutral-400 hover:text-white underline underline-offset-4 mt-0.5 cursor-pointer"
          >
            Dismiss &amp; Try Again
          </button>
        </div>
      )}
    </div>
  );
}
export default GetCardButton;
