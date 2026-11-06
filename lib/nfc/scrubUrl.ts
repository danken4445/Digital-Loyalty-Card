/**
/**
 * Utility to scrub sensitive or replayable query parameters (e.g. ?t=, ?c=, ?m=)
 * from the browser history and address bar immediately on mount using `window.history.replaceState`.
 * This ensures that browser back/forward buttons and copy-pasted URLs do not replay tap parameters.
 */
export function scrubUrlSearchParams(paramNames: string[]): void {
  if (typeof window === 'undefined' || !window.location.search) {
    return;
  }
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of paramNames) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) {
      const remainingSearch = url.searchParams.toString();
      const targetPath = remainingSearch ? `${url.pathname}?${remainingSearch}` : url.pathname;
      window.history.replaceState(null, '', targetPath + url.hash);
    }
  } catch {
    // Graceful no-op in non-browser or malformed URL environments
  }
}
