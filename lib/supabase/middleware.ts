import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ROUTES } from '@/lib/contracts';

/**
 * Refreshes the user's Supabase Auth session cookie on incoming requests using `@supabase/ssr`.
 * Always calls `supabase.auth.getUser()` to revalidate the token with Supabase Auth.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({
          request,
        });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: Always use getUser() to revalidate the session token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // First-layer protection for /staff/* routes (except /staff/login).
  // Individual staff pages, route handlers, and server actions ALSO enforce getVerifiedUser() + is_staff().
  if (pathname.startsWith(ROUTES.staff.root) && pathname !== ROUTES.staff.login) {
    if (!user || user.is_anonymous) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = ROUTES.staff.login;
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl, 303);
    }

    const { data: isStaff, error: staffError } = await supabase.rpc('is_staff');
    if (staffError || !isStaff) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = ROUTES.staff.login;
      loginUrl.searchParams.set('error', 'forbidden');
      return NextResponse.redirect(loginUrl, 303);
    }
  }

  return supabaseResponse;
}
