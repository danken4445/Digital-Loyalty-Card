'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Handles client-side auth hash fragments (#access_token=... or #error=...)
 * that Supabase GoTrue sends when implicit/verify redirects land in the browser.
 * Establishes the session cookies and reloads, or routes errors to staff/wallet.
 */
export function AuthHashHandler() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) {
      return;
    }

    const hash = window.location.hash.substring(1);
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const isRecovery = params.get('type') === 'recovery';
    const error = params.get('error') || params.get('error_description');

    if (error) {
      console.warn('Auth hash error detected:', error);
      // Clean hash from URL so it doesn't linger
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      if (window.location.pathname.startsWith('/staff')) {
        router.push(`/staff/login?error=${encodeURIComponent(error)}`);
      }
      return;
    }

    if (accessToken && refreshToken) {
      const supabase = createSupabaseBrowserClient();
      supabase.auth
        .setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        .then(({ error: sessionError }) => {
          if (!sessionError) {
            // Remove hash from address bar
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            if (isRecovery) {
              // Implicit-flow recovery links (older emails) land here with the tokens in the hash.
              router.replace(ROUTES.resetPassword);
            } else {
              router.refresh();
            }
          } else {
            console.error('Failed to set session from hash:', sessionError);
          }
        })
        .catch((err) => {
          console.error('Unexpected error setting session from hash:', err);
        });
    }
  }, [router]);

  return null;
}

