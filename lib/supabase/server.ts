import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { getPublicEnv } from '@/lib/config';

/**
 * Creates a cookie-backed Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses Next.js 15 async `cookies()` API.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component where setting cookies is a no-op because
            // middleware is responsible for refreshing the session cookie.
          }
        },
      },
    },
  );
}

/**
 * Authoritatively validates the current session against Supabase Auth via `auth.getUser()`.
 * NEVER use `getSession()` for server-side authorization decisions.
 */
export async function getVerifiedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}
