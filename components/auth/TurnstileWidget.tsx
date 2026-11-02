'use client';

import { useCallback, useEffect, useRef } from 'react';
import Script from 'next/script';

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: 'light' | 'dark' | 'auto';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: (errorCode?: string | number) => void;
  size?: 'normal' | 'flexible' | 'compact';
}

interface TurnstileInstance {
  render: (container: HTMLElement | string, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileInstance;
  }
}

export interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  siteKey?: string;
  className?: string;
}

const DEFAULT_TEST_SITEKEY = '1x00000000000000000000AA';
const LOCAL_DEV_FALLBACK_TOKEN = 'local-dev-turnstile-token';

/**
 * Cloudflare Turnstile widget with explicit render and dark streetwear theme.
 * Includes resilience fallback for local offline development when using test keys.
 */
export function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
  siteKey,
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const fallbackUsedRef = useRef<boolean>(false);

  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const resolvedSiteKey =
    siteKey ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? DEFAULT_TEST_SITEKEY;

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current !== null) {
      return;
    }

    try {
      const widgetId = window.turnstile.render(containerRef.current, {
        sitekey: resolvedSiteKey,
        theme: 'dark',
        callback: (token: string) => {
          onVerifyRef.current(token);
        },
        'expired-callback': () => {
          onExpireRef.current?.();
        },
        'error-callback': () => {
          if (resolvedSiteKey === DEFAULT_TEST_SITEKEY && !fallbackUsedRef.current) {
            fallbackUsedRef.current = true;
            onVerifyRef.current(LOCAL_DEV_FALLBACK_TOKEN);
          } else {
            onErrorRef.current?.();
          }
        },
      });

      widgetIdRef.current = widgetId;
    } catch {
      if (resolvedSiteKey === DEFAULT_TEST_SITEKEY && !fallbackUsedRef.current) {
        fallbackUsedRef.current = true;
        onVerifyRef.current(LOCAL_DEV_FALLBACK_TOKEN);
      } else {
        onErrorRef.current?.();
      }
    }
  }, [resolvedSiteKey]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.turnstile) {
      renderWidget();
    }

    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore cleanup errors if Turnstile was unmounted
        }
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget]);

  // Offline/local dev timer fallback: if Cloudflare script is blocked or unresolvable locally
  useEffect(() => {
    if (resolvedSiteKey === DEFAULT_TEST_SITEKEY) {
      const timer = setTimeout(() => {
        if (!window.turnstile && !fallbackUsedRef.current) {
          fallbackUsedRef.current = true;
          onVerifyRef.current(LOCAL_DEV_FALLBACK_TOKEN);
        }
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [resolvedSiteKey]);

  const handleScriptLoad = () => {
    renderWidget();
  };

  const handleScriptError = () => {
    if (resolvedSiteKey === DEFAULT_TEST_SITEKEY && !window.turnstile && !fallbackUsedRef.current) {
      fallbackUsedRef.current = true;
      onVerifyRef.current(LOCAL_DEV_FALLBACK_TOKEN);
    } else {
      onErrorRef.current?.();
    }
  };

  return (
    <>
      <Script
        id="cf-turnstile-script"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={handleScriptLoad}
        onError={handleScriptError}
      />
      <div
        ref={containerRef}
        data-testid="turnstile-container"
        className={className ?? 'flex items-center justify-center my-2 min-h-[65px]'}
      />
    </>
  );
}
export default TurnstileWidget;
