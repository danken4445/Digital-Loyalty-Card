'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  loadGoogleIdentityScript,
  signInWithGoogleIdToken,
  type GoogleCredentialResponse,
} from '@/lib/auth/google';

export const ALREADY_REGISTERED_REGEX =
  /already registered|already been registered|already linked|identity_already_exists|email_exists/i;

export interface GoogleAuthButtonProps {
  mode: 'backup' | 'recover';
  disabled?: boolean;
  isSubmitting?: boolean;
  onPrepareMerge: () => Promise<void>;
  onSuccess: () => void;
  onError: (error: string) => void;
  onAlreadyRegistered: () => void;
  fallbackOAuthUrl: string;
  className?: string;
  buttonLabel?: string;
}

export function GoogleIcon() {
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

export function GoogleAuthButton({
  mode,
  disabled = false,
  isSubmitting = false,
  onPrepareMerge,
  onSuccess,
  onError,
  onAlreadyRegistered,
  fallbackOAuthUrl,
  className,
  buttonLabel,
}: GoogleAuthButtonProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isGsiReady, setIsGsiReady] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const googleContainerRef = useRef<HTMLDivElement>(null);

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const submitting = isSubmitting || localSubmitting;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Initialize Google Identity Services when Client ID is configured
  useEffect(() => {
    if (!isMounted || !googleClientId) return;

    let isCancelled = false;

    loadGoogleIdentityScript()
      .then(() => {
        if (isCancelled || !window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: GoogleCredentialResponse) => {
            if (!response?.credential) {
              onError('Google authentication failed: missing credentials.');
              return;
            }

            setLocalSubmitting(true);
            try {
              // 1. Issue merge intent cookie while still in current anonymous session
              await onPrepareMerge();

              // 2. Sign in to Supabase with the Google ID token
              const { error } = await signInWithGoogleIdToken(response.credential);

              if (error) {
                const errorText = `${error.message} ${'code' in error && typeof error.code === 'string' ? error.code : ''}`;
                if (ALREADY_REGISTERED_REGEX.test(errorText)) {
                  onAlreadyRegistered();
                } else {
                  onError(error.message);
                }
                return;
              }

              // 3. Authenticated: navigate to callback route to merge wallets & refresh
              onSuccess();
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Google authentication failed.';
              if (ALREADY_REGISTERED_REGEX.test(msg)) {
                onAlreadyRegistered();
              } else {
                onError(msg);
              }
            } finally {
              setLocalSubmitting(false);
            }
          },
        });

        setIsGsiReady(true);
      })
      .catch(() => {
        // Fall back gracefully to standard OAuth if GSI script fails to load
        setIsGsiReady(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isMounted, googleClientId, onPrepareMerge, onSuccess, onError, onAlreadyRegistered]);

  // Render Google's official branded button when GSI is ready
  useEffect(() => {
    if (!isGsiReady || !googleContainerRef.current || !window.google?.accounts?.id) return;

    try {
      googleContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleContainerRef.current, {
        theme: 'filled_black',
        size: 'large',
        text: mode === 'backup' ? 'continue_with' : 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320,
      });
    } catch {
      // If render fails, fallback will remain active
    }
  }, [isGsiReady, mode]);

  // Fallback OAuth redirect handler
  const handleFallbackOAuth = async () => {
    if (disabled || submitting) return;

    setLocalSubmitting(true);
    try {
      await onPrepareMerge();
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: fallbackOAuthUrl,
        },
      });

      if (error) {
        const errorText = `${error.message} ${'code' in error && typeof error.code === 'string' ? error.code : ''}`;
        if (ALREADY_REGISTERED_REGEX.test(errorText)) {
          onAlreadyRegistered();
        } else {
          onError(error.message);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google connection failed.';
      if (ALREADY_REGISTERED_REGEX.test(msg)) {
        onAlreadyRegistered();
      } else {
        onError(msg);
      }
    } finally {
      setLocalSubmitting(false);
    }
  };

  // If GSI is ready and configured in the browser, render Google's official button
  if (isMounted && isGsiReady && googleClientId) {
    return (
      <div className="w-full flex flex-col items-center">
        <div
          ref={googleContainerRef}
          className={`min-h-[44px] flex justify-center w-full transition-opacity ${
            disabled || submitting ? 'opacity-40 pointer-events-none cursor-not-allowed' : ''
          }`}
        />
      </div>
    );
  }

  // Default / SSR / Fallback button
  const buttonText = submitting
    ? 'CONNECTING...'
    : buttonLabel || (mode === 'backup' ? 'BACK UP WITH GOOGLE' : 'SIGN IN WITH GOOGLE & MERGE');

  return (
    <button
      type="button"
      disabled={disabled || submitting}
      onClick={handleFallbackOAuth}
      className={
        className ||
        'w-full py-3 px-4 bg-white text-black font-display font-black text-xs tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_15px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black'
      }
    >
      <GoogleIcon />
      <span>{buttonText}</span>
    </button>
  );
}
