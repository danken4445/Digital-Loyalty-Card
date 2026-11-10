import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
  clientId?: string;
}

export interface GoogleIdentityInitializeOptions {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void | Promise<void>;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  context?: 'signin' | 'signup' | 'use';
}

export interface GoogleButtonRenderOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number | string;
  locale?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: GoogleIdentityInitializeOptions) => void;
          renderButton: (parent: HTMLElement, options: GoogleButtonRenderOptions) => void;
          prompt: (momentListener?: (notification: unknown) => void) => void;
          cancel: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

/**
 * Dynamically loads the Google Identity Services client script if not already loaded.
 */
export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`,
    );
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', (err) => reject(err), { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => {
      googleScriptPromise = null;
      reject(err);
    };
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

/**
 * Signs in to Supabase using a Google ID token (JWT) obtained from Google Identity Services.
 */
export async function signInWithGoogleIdToken(idToken: string) {
  const supabase = createSupabaseBrowserClient();
  return await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
}

