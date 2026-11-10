import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_IDENTITY_SCRIPT_URL,
  loadGoogleIdentityScript,
  signInWithGoogleIdToken,
} from '@/lib/auth/google';
import {
  GoogleAuthButton,
  ALREADY_REGISTERED_REGEX,
} from '@/components/auth/GoogleAuthButton';

const mockSignInWithOAuth = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithIdToken = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      signInWithIdToken: mockSignInWithIdToken,
    },
  })),
}));

describe('Google Auth Integration (Customized Domain & GIS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. lib/auth/google.ts', () => {
    it('loadGoogleIdentityScript resolves in Node/SSR environment without throwing', async () => {
      await expect(loadGoogleIdentityScript()).resolves.toBeUndefined();
    });

    it('signInWithGoogleIdToken passes provider="google" and the credential token to Supabase', async () => {
      mockSignInWithIdToken.mockResolvedValueOnce({
        data: { session: { access_token: 'fake-jwt' }, user: { id: 'u-1' } },
        error: null,
      });

      const res = await signInWithGoogleIdToken('test-google-id-token');
      expect(mockSignInWithIdToken).toHaveBeenCalledWith({
        provider: 'google',
        token: 'test-google-id-token',
      });
      expect(res.data?.user?.id).toBe('u-1');
    });

    it('identifies already registered errors with ALREADY_REGISTERED_REGEX', () => {
      expect(ALREADY_REGISTERED_REGEX.test('User already registered')).toBe(true);
      expect(ALREADY_REGISTERED_REGEX.test('identity_already_exists')).toBe(true);
      expect(ALREADY_REGISTERED_REGEX.test('email_exists')).toBe(true);
      expect(ALREADY_REGISTERED_REGEX.test('Invalid credentials')).toBe(false);
    });
  });

  describe('2. GoogleAuthButton (Static Markup & SSR)', () => {
    it('renders BACK UP WITH GOOGLE in backup mode by default', () => {
      const html = renderToStaticMarkup(
        React.createElement(GoogleAuthButton, {
          mode: 'backup',
          disabled: false,
          isSubmitting: false,
          onPrepareMerge: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
          onAlreadyRegistered: vi.fn(),
          fallbackOAuthUrl: 'http://localhost:3000/auth/callback',
        }),
      );

      expect(html).toContain('BACK UP WITH GOOGLE');
      expect(html).toContain('<button');
    });

    it('renders SIGN IN WITH GOOGLE & MERGE in recover mode by default', () => {
      const html = renderToStaticMarkup(
        React.createElement(GoogleAuthButton, {
          mode: 'recover',
          disabled: false,
          isSubmitting: false,
          onPrepareMerge: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
          onAlreadyRegistered: vi.fn(),
          fallbackOAuthUrl: 'http://localhost:3000/auth/callback',
        }),
      );

      expect(html).toContain('SIGN IN WITH GOOGLE &amp; MERGE');
    });

    it('honors a custom buttonLabel prop', () => {
      const html = renderToStaticMarkup(
        React.createElement(GoogleAuthButton, {
          mode: 'backup',
          buttonLabel: 'Continue with Google',
          disabled: false,
          isSubmitting: false,
          onPrepareMerge: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
          onAlreadyRegistered: vi.fn(),
          fallbackOAuthUrl: 'http://localhost:3000/auth/callback',
        }),
      );

      expect(html).toContain('Continue with Google');
      expect(html).not.toContain('BACK UP WITH GOOGLE');
    });

    it('renders CONNECTING... when isSubmitting is true', () => {
      const html = renderToStaticMarkup(
        React.createElement(GoogleAuthButton, {
          mode: 'backup',
          disabled: true,
          isSubmitting: true,
          onPrepareMerge: vi.fn(),
          onSuccess: vi.fn(),
          onError: vi.fn(),
          onAlreadyRegistered: vi.fn(),
          fallbackOAuthUrl: 'http://localhost:3000/auth/callback',
        }),
      );

      expect(html).toContain('CONNECTING...');
    });
  });
});
