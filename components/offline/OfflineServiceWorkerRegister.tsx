'use client';

import { useEffect } from 'react';

/**
 * Registers the offline PWA service worker (/sw.js) in production browsers.
 * Safely guards against SSR and automated test environments.
 */
export function OfflineServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV !== 'test'
    ) {
      const handleLoad = () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          // Registration may fail in non-HTTPS dev or restricted browser modes
        });
      };

      if (document.readyState === 'complete') {
        handleLoad();
      } else {
        window.addEventListener('load', handleLoad);
        return () => window.removeEventListener('load', handleLoad);
      }
    }
  }, []);

  return null;
}
