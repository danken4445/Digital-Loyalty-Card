import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files, Next.js internals, and brand images.
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|brand/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
